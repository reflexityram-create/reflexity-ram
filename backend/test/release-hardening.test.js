const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const serverSource = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
const renderSource = fs.readFileSync(path.join(root, 'backend/render.yaml'), 'utf8');
const authSource = fs.readFileSync(path.join(root, 'backend/src/routes/auth.js'), 'utf8');
const stockSource = fs.readFileSync(path.join(root, 'backend/src/utils/stock.js'), 'utf8');

test('production CORS is restricted to the verified Reflexity origins', () => {
  assert.match(serverSource, /https:\/\/reflexityram\.com/);
  assert.match(serverSource, /https:\/\/www\.reflexityram\.com/);
  assert.match(serverSource, /https:\/\/reflexity-ram-3rn\.pages\.dev/);
  assert.doesNotMatch(serverSource, /reflexity-ram2\.pages\.dev|reflexity-ram\.pages\.dev|reflexityram\.pages\.dev/);
  assert.match(serverSource, /filter\(\(origin\) => ownedProductionOrigins\.includes\(origin\)\)/);
  assert.match(serverSource, /new Error\('Request origin not allowed'\)/);
  assert.match(serverSource, /error\.status = 403/);
  assert.match(serverSource, /error\.publicMessage = 'Request origin not allowed'/);
  assert.doesNotMatch(serverSource, /CORS: origin '\$\{origin\}' not allowed/);
});

test('the HTTP seed route cannot be enabled in production', () => {
  assert.match(serverSource, /process\.env\.NODE_ENV !== 'production' && process\.env\.SEED_SECRET/);
  assert.match(serverSource, /npm run seed/);
});

test('all application model indexes are awaited before listening', () => {
  assert.match(serverSource, /const startupModels = \[/);
  assert.match(serverSource, /connect\(process\.env\.MONGODB_URI, \{ autoIndex: false \}\)/);
  assert.match(serverSource, /await Promise\.all\(startupModels\.map\(\(model\) => model\.init\(\)\)\)/);
  assert.match(serverSource, /await ensureCartOwnershipIndexes\(\)/);
  assert.match(serverSource, /const paymentProviderOrderIndexFields = new Set\(\[/);
  assert.match(serverSource, /'stripePaymentIntentId',[\s\S]*?'stripeCheckoutSessionId'/);
  assert.match(serverSource, /model\.schema\.indexes\(\)\.filter\(\(\[keys\]\) =>/);
  assert.match(serverSource, /model\.ensureIndexes\(\{[\s\S]*?toCreate: startupIndexDeclarations\(model\)/);
  assert.match(serverSource, /startupModels\.length/);
});

test('shared abuse controls and request parsers have bounded production behavior', () => {
  assert.match(serverSource, /new MongoRateLimitStore\(\{ prefix: 'global' \}\)/);
  assert.match(serverSource, /new MongoRateLimitStore\(\{ prefix: 'auth' \}\)/);
  assert.match(serverSource, /'x-order-email'/);
  assert.match(serverSource, /express\.json\(\{ limit: '1mb' \}\)/);
  assert.match(serverSource, /express\.urlencoded\(\{ extended: true, limit: '1mb' \}\)/);
});

test('platform liveness probes bypass customer rate limiting', () => {
  const corsMiddleware = serverSource.indexOf('cors({');
  const rootHealth = serverSource.indexOf("app.get('/health', healthHandler)");
  const apiHealth = serverSource.indexOf("app.get('/api/health', healthHandler)");
  const globalLimiter = serverSource.indexOf('app.use(globalLimiter)');
  const productRoutes = serverSource.indexOf("app.use('/api/products', productRoutes)");
  assert.ok(corsMiddleware >= 0 && rootHealth >= 0 && apiHealth >= 0 && globalLimiter >= 0 && productRoutes >= 0);
  assert.ok(corsMiddleware < rootHealth, 'CORS must still reject untrusted Origins before health responses');
  assert.ok(rootHealth < globalLimiter);
  assert.ok(apiHealth < globalLimiter);
  assert.ok(globalLimiter < productRoutes, 'customer API routes must remain rate limited');
  assert.match(serverSource, /liveness probes[\s\S]*?customer traffic[\s\S]*?HTTP 429/i);
});

test('OAuth fragments carry no duplicated profile data and cancellation uses an exact claim', () => {
  assert.match(authSource, /\/auth\/callback#token=\$\{token\}/);
  assert.doesNotMatch(authSource, /userData|&user=/);
  assert.match(stockSource, /const filter = cancellationClaimFilter\(orderId, expected\)/);
  assert.match(stockSource, /Order\.findOneAndUpdate\(\s*filter/);
  assert.doesNotMatch(stockSource, /Order\.findByIdAndUpdate\(\s*filter/);
});

test('password changes revoke prior sessions and return only a newly versioned session', () => {
  assert.match(authSource, /user\.authVersion = \(user\.authVersion \|\| 0\) \+ 1/);
  assert.match(authSource, /const token = generateAccessToken\(user\._id, user\.authVersion\)/);
  assert.match(authSource, /res\.json\(\{ message: 'Password changed successfully', token \}\)/);
});

test('Render blueprint is rooted at the backend and has an explicit health probe', () => {
  assert.match(renderSource, /rootDir:\s+backend/);
  assert.match(renderSource, /buildCommand:\s+npm ci/);
  assert.match(renderSource, /startCommand:\s+node src\/server\.js/);
  assert.match(renderSource, /healthCheckPath:\s+\/api\/health/);
  assert.doesNotMatch(renderSource, /key:\s+SEED_SECRET/);
});

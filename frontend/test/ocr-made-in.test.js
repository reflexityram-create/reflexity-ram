import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const here = new URL('..', import.meta.url).pathname;

test('only /ocr/ gets a policy with WebAssembly, and that block comes last so it replaces the site-wide one', async () => {
  const headers = await read('../public/_headers');
  const sitewide = headers.match(/^ {2}Content-Security-Policy: (.*)$/m)[1];
  assert.doesNotMatch(sitewide, /wasm-unsafe-eval|unsafe-eval/, 'the storefront policy stays as strict as before');
  const block = headers.slice(headers.lastIndexOf('\n/ocr/*\n'));
  assert.match(block, /^\n\/ocr\/\*\n {2}! Content-Security-Policy\n {2}Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'\n/);
  assert.equal(headers.trimEnd().split('\n').pop().trim().startsWith('Cache-Control'), true, '/ocr/ is the last rule');
  assert.equal((headers.match(/^\/ocr\/\*$/gm) || []).length, 1);
});

test('the OCR files are static, copied from the lockfile versions at dev and build time, and not committed', async () => {
  const [routes, pkg, gitignore, script] = await Promise.all([
    read('../public/_routes.json'), read('../package.json'), read('../../.gitignore'), read('../scripts/copy-ocr-assets.mjs'),
  ]);
  assert.ok(JSON.parse(routes).exclude.includes('/ocr/*'));
  const scripts = JSON.parse(pkg).scripts;
  assert.equal(scripts.prebuild, 'node scripts/copy-ocr-assets.mjs');
  assert.equal(scripts.predev, 'node scripts/copy-ocr-assets.mjs');
  for (const name of ['worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js', 'eng.traineddata.gz']) {
    assert.match(script, new RegExp(name.replace(/\./g, '\\.')));
    assert.match(gitignore.replace(/\*/g, '.*'), new RegExp(name.replace(/\./g, '\\.').replace('tesseract-core-simd-lstm\\.wasm\\.js', 'tesseract-core-.*\\.wasm\\.js').replace('tesseract-core-lstm\\.wasm\\.js', 'tesseract-core-.*\\.wasm\\.js')));
  }
});

test('the copy script puts the engine, both cores and the English data under public/ocr', async () => {
  execFileSync(process.execPath, ['scripts/copy-ocr-assets.mjs'], { cwd: here, stdio: 'pipe' });
  for (const [name, minBytes] of [['worker.min.js', 50_000], ['tesseract-core-simd-lstm.wasm.js', 1_000_000], ['tesseract-core-lstm.wasm.js', 1_000_000], ['eng.traineddata.gz', 1_000_000]]) {
    const { size } = await stat(new URL(`../public/ocr/${name}`, import.meta.url));
    assert.ok(size > minBytes, `${name} is ${size} bytes`);
  }
});

test('the /ocr/ self-test worker reports whether WebAssembly can be compiled', async () => {
  const probe = await read('../public/ocr/csp-probe.js');
  const posted = [];
  const sandbox = vm.createContext({ WebAssembly, Uint8Array, postMessage: (m) => posted.push(m) });
  new vm.Script(probe).runInContext(sandbox);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(posted, ['wasm ok']);
  const blocked = vm.createContext({
    WebAssembly: { compile: () => Promise.reject(new Error('CompileError: Refused to compile')) },
    Uint8Array,
    postMessage: (m) => posted.push(m),
  });
  new vm.Script(probe).runInContext(blocked);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(posted[1], /^wasm blocked: .*Refused to compile/);
});

test('the label reader runs the engine from our own origin and never from a CDN', async () => {
  const reader = await read('../src/lib/readLabel.js');
  assert.match(reader, /await import\("tesseract\.js"\)/, 'the engine is a lazy chunk, not in the main bundle');
  assert.doesNotMatch(reader, /^import .*tesseract/m);
  assert.doesNotMatch(reader, /jsdelivr|unpkg|cdnjs|https?:\/\//);
  assert.match(reader, /workerPath: `\$\{OCR_PATH\}\/worker\.min\.js`/);
  assert.match(reader, /corePath: OCR_PATH/);
  assert.match(reader, /langPath: OCR_PATH/);
  assert.match(reader, /workerBlobURL: false/);
  assert.match(reader, /finally \{\s*await worker\.terminate\(\);/);
});

test('the admin product form reads photos as they are chosen and only fills an empty "Made in"', async () => {
  const admin = await read('../src/pages/admin/Products.jsx');
  assert.match(admin, /onFiles=\{readPhotos\}/);
  assert.match(admin, /onFiles\?\.\(Array\.from\(files\)\)/);
  assert.match(admin, /setForm\(f => \(f\.countryOfOrigin \? f : \{ \.\.\.f, countryOfOrigin: result\.code \}\)\)/);
  assert.match(admin, /<MadeInNote note=\{madeInNote\}/);
  assert.match(admin, /data-testid="made-in-note"/);
  assert.match(admin, /data-testid="made-in-read-photos"/);
  // a hint or a conflict never fills the field
  assert.doesNotMatch(admin, /status === 'hint'[^\n]*countryOfOrigin: /);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// The owner asked for one Products page: retail products and wholesale lots
// together, with no separate "Wholesale lots" entry or explainer banner.
test('retail products and wholesale lots share one admin Products page', async () => {
  const [app, layout, retail, wholesale] = await Promise.all([
    read('../src/App.jsx'),
    read('../src/components/AppLayout.jsx'),
    read('../src/pages/admin/Products.jsx'),
    read('../src/pages/admin/WholesaleAdmin.jsx'),
  ]);

  assert.doesNotMatch(app, /const AdminWholesale = lazy/);
  assert.match(app, /path="\/admin\/wholesale" element=\{<Navigate to="\/admin\/products#wholesale" replace \/>\}/);
  assert.match(layout, /\{ to: '\/admin\/products', label: 'Products', icon: Package \}/);
  assert.doesNotMatch(layout, /label: 'Retail products'|label: 'Wholesale lots'|to: '\/admin\/wholesale'/);
  assert.match(retail, /import \{ WholesaleLotsSection \} from '@\/pages\/admin\/WholesaleAdmin'/);
  assert.match(retail, /<h1 className="text-2xl font-bold tracking-tight">Products<\/h1>/);
  assert.match(retail, /<WholesaleLotsSection \/>/);
  assert.match(wholesale, /export function WholesaleLotsSection\(\)/);
  assert.doesNotMatch(wholesale, /<AppLayout|ProductWorkspaceNav/);
  assert.match(wholesale, /className="wholesale-admin p-5 sm:p-8" id="wholesale"/);
  await assert.rejects(read('../src/components/ProductWorkspaceNav.jsx'), { code: 'ENOENT' });
});

test('the lot editor opens from its own links, apart from the retail editor', async () => {
  const [retail, publicPage, admin] = await Promise.all([
    read('../src/pages/admin/Products.jsx'),
    read('../src/pages/Wholesale.jsx'),
    read('../src/pages/admin/WholesaleAdmin.jsx'),
  ]);

  // Both editors live on one page, so they must not share ?new / ?edit.
  assert.match(retail, /searchParams\.get\('new'\) === '1'/);
  assert.match(admin, /searchParams\.get\('newLot'\) === '1'/);
  assert.match(admin, /searchParams\.get\('editLot'\)/);
  assert.match(admin, /setSearchParams\(\{ newLot: '1' \}\)/);
  assert.match(admin, /setSearchParams\(\{ editLot: lot\.id \}\)/);
  assert.doesNotMatch(admin, /searchParams\.get\('(new|edit)'\)/);
  assert.match(publicPage, /user\?\.role === "admin" \? \(/);
  assert.match(publicPage, /to="\/admin\/products#wholesale"/);
  assert.match(publicPage, /to="\/admin\/products\?newLot=1#wholesale"/);
  assert.match(admin, /setEditorLot\(\{ \.\.\.EMPTY_LOT \}\)/);
  assert.match(admin, /\{editorLot &&[\s\S]*?<LotEditor[\s\S]*?initialLot=\{editorLot\}/);
  assert.match(admin, /onClick=\{openNew\}[\s\S]*?Add wholesale listing/);
  assert.equal((admin.match(/function LotEditor\(/g) || []).length, 1);
});

test('the technical workspace sees every status and uses revisioned soft transitions', async () => {
  const [admin, api] = await Promise.all([
    read('../src/pages/admin/WholesaleAdmin.jsx'),
    read('../src/lib/api.js'),
  ]);

  assert.match(admin, /All wholesale listings/);
  assert.match(admin, /Draft, live, and archived records stay visible here/);
  assert.match(admin, /value="draft">Drafts/);
  assert.match(admin, /value="published">Published/);
  assert.match(admin, /value="archived">Archived/);
  assert.match(admin, /publishWholesaleLot\(lot\.id, lot\.version\)/);
  assert.match(admin, /unpublishWholesaleLot\(lot\.id, lot\.version\)/);
  assert.match(admin, /archiveWholesaleLot\(lot\.id, lot\.version\)/);
  assert.match(admin, /restoreWholesaleLot\(lot\.id, lot\.version\)/);
  assert.match(admin, /error\?\.response\?\.status === 409/);
  assert.match(admin, /while \(true\)[\s\S]*?page, limit: 100[\s\S]*?page >= pages/);
  assert.match(admin, /if \(!editRequested\) \{[\s\S]*?setEditorLot\(null\)/);
  assert.match(admin, /typeof item === 'string' \? item : item\?\.message/);
  assert.match(admin, /const GENERATIONS = \['DDR3', 'DDR4', 'DDR5'\]/);
  assert.match(admin, /const CONDITIONS = \['New',[\s\S]*?'Server Pull — Tested',[\s\S]*?'Used'\]/);
  assert.match(admin, /import \{ createPortal \} from 'react-dom'/);
  assert.match(admin, /const appRoot = document\.getElementById\('root'\)[\s\S]*?appRoot\.setAttribute\('inert', ''\)[\s\S]*?appRoot\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(admin, /if \(rootWasInert\) appRoot\.setAttribute\('inert', ''\)[\s\S]*?else appRoot\.removeAttribute\('inert'\)[\s\S]*?previousRootAriaHidden === null\) appRoot\.removeAttribute\('aria-hidden'\)/);
  assert.match(admin, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?\[data-wholesale-editor-trigger\][\s\S]*?target\.focus\(\)/);
  assert.equal((admin.match(/data-wholesale-editor-trigger/g) || []).length, 3, 'selector plus both admin Add buttons');
  assert.match(admin, /return createPortal\([\s\S]*?className="wholesale-admin fixed inset-0 z-50 flex justify-end"[\s\S]*?role="dialog"[\s\S]*?document\.body,/);
  assert.match(admin, /aria-live="assertive"[\s\S]*?role="alert">\{editorError\}/);
  assert.match(admin, /aria-live="polite"[\s\S]*?role="status">\{editorStatus\}/);
  assert.match(admin, /onError=\{announceError\}[\s\S]*?onStatus=\{announceStatus\}/);
  assert.match(admin, /const accepted = await onUpload\(uploaded\);[\s\S]*?accepted !== false[\s\S]*?onStatus/);
  assert.match(admin, /if \(!aliveRef\.current\) \{[\s\S]*?deleteAsset\(uploaded\.publicId\);[\s\S]*?return false;[\s\S]*?return true;/);
  const editor = admin.slice(admin.indexOf('function LotEditor('), admin.indexOf('export function WholesaleLotsSection'));
  assert.equal((editor.match(/toast\.error\(/g) || []).length, 1, 'only announceError may own an editor error toast');
  assert.equal((editor.match(/toast\.success\(/g) || []).length, 1, 'only announceStatus may own an editor success toast');
  assert.doesNotMatch(admin, /<div className="wholesale-admin"><LotEditor/);
  assert.doesNotMatch(admin, /inert=\{editorLot \? true : undefined\}/);
  assert.match(admin, /requestCloseRef[\s\S]*?event\.key !== 'Tab'/);
  assert.match(admin, /sessionUploadsRef[\s\S]*?deleteWholesaleImage/);
  assert.match(admin, /aliveRef\.current = true[\s\S]*?aliveRef\.current = false[\s\S]*?if \(!aliveRef\.current\)[\s\S]*?deleteAsset\(uploaded\.publicId\)/);
  assert.match(api, /archiveWholesaleLot: \(id, version\) => api\.delete\(`\/admin\/wholesale\/\$\{id\}`/);
  assert.doesNotMatch(admin, /deleteProduct|productsApi|stockQuantity|stripePrice|cartApi|checkoutApi/);
  assert.doesNotMatch(admin, /DEMO-|\bseed(?:ed|ing)?\b|example lot/i);
});

test('wholesale media and CRUD use their own API surface', async () => {
  const api = await read('../src/lib/api.js');

  assert.match(api, /wholesaleApi = \{[\s\S]*?publicApi\.get\('\/wholesale'/);
  assert.match(api, /listWholesaleLots: \(params\) => api\.get\('\/admin\/wholesale'/);
  assert.match(api, /createWholesaleLot: \(data\) => api\.post\('\/admin\/wholesale'/);
  assert.match(api, /updateWholesaleLot: \(id, data\) => api\.patch\(`\/admin\/wholesale\/\$\{id\}`/);
  assert.match(api, /uploadWholesaleImage:[\s\S]*?api\.post\('\/upload\/wholesale'/);
  assert.match(api, /deleteWholesaleImage:[\s\S]*?api\.delete\(`\/upload\/wholesale/);
});

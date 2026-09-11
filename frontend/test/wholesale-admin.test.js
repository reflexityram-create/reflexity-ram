import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("catalog inventory and wholesale lots remain separate, responsive, administrator-only workspaces", async () => {
  const [app, layout, workspaceNav, workspaceCss, inventory, wholesale] = await Promise.all([
    read("../src/App.jsx"), read("../src/components/AppLayout.jsx"), read("../src/components/ProductWorkspaceNav.jsx"),
    read("../src/components/ProductWorkspaceNav.css"), read("../src/pages/admin/Products.jsx"), read("../src/pages/admin/WholesaleAdmin.jsx"),
  ]);
  assert.match(app, /const AdminWholesale = lazy\(\(\) => import\("@\/pages\/admin\/WholesaleAdmin"\)\)/);
  assert.match(app, /path="\/admin\/wholesale" element=\{<AdminWholesale \/>\}/);
  assert.match(layout, /Navigate to="\/admin\/sign-in"/);
  assert.match(workspaceNav, /label: 'Catalog inventory'/);
  assert.match(workspaceNav, /label: 'Wholesale lots'/);
  assert.match(workspaceNav, /to: '\/admin\/products'/);
  assert.match(workspaceNav, /to: '\/admin\/wholesale'/);
  assert.match(workspaceNav, /Catalog and wholesale lots, clearly separated/);
  assert.match(workspaceNav, /Published records support quote-led inventory inquiries/);
  assert.doesNotMatch(workspaceNav, /text-white|border-white|bg-white/);
  assert.match(workspaceCss, /color: var\(--fg-strong\)/);
  assert.match(workspaceCss, /background: var\(--bg-elev\)/);
  assert.match(workspaceCss, /@media \(max-width: 580px\)[\s\S]*grid-template-columns: 1fr/);
  assert.match(inventory, /<ProductWorkspaceNav showWholesaleActions \/>/);
  assert.match(wholesale, /<ProductWorkspaceNav \/>/);
  assert.match(wholesale, /<AppLayout requireAdmin>/);
});

test("all creation and edit paths converge on the protected wholesale editor", async () => {
  const [workspaceNav, inventory, admin] = await Promise.all([
    read("../src/components/ProductWorkspaceNav.jsx"), read("../src/pages/admin/Products.jsx"), read("../src/pages/admin/WholesaleAdmin.jsx"),
  ]);
  assert.match(inventory, /<ProductWorkspaceNav showWholesaleActions \/>/);
  assert.match(workspaceNav, /showWholesaleActions/);
  assert.match(workspaceNav, /to="\/admin\/wholesale"[\s\S]*Manage all/);
  assert.match(workspaceNav, /to="\/admin\/wholesale\?new=1"[\s\S]*Add wholesale listing/);
  assert.match(admin, /searchParams\.get\('new'\) === '1'/);
  assert.match(admin, /searchParams\.get\('edit'\)/);
  assert.match(admin, /setEditorLot\(\{ \.\.\.EMPTY_LOT \}\)/);
  assert.match(admin, /\{editorLot &&[\s\S]*<LotEditor[\s\S]*initialLot=\{editorLot\}/);
  assert.match(admin, /data-wholesale-editor-trigger[\s\S]*onClick=\{openNew\}/);
  assert.equal((admin.match(/function LotEditor\(/g) || []).length, 1);
});

test("revisioned lot transitions, pagination, upload cleanup, and modal accessibility cannot regress", async () => {
  const [admin, api] = await Promise.all([read("../src/pages/admin/WholesaleAdmin.jsx"), read("../src/lib/api.js")]);
  assert.match(admin, /All wholesale listings/);
  assert.match(admin, /Draft, live, and archived records stay visible here/);
  for (const status of ["draft", "published", "archived"]) assert.match(admin, new RegExp(`value="${status}">`));
  for (const action of ["publish", "unpublish", "archive", "restore"]) assert.match(admin, new RegExp(`${action}WholesaleLot\\(lot\\.id, lot\\.version\\)`));
  assert.match(admin, /error\?\.response\?\.status === 409/);
  assert.match(admin, /while \(true\)[\s\S]*page, limit: 100[\s\S]*page >= pages/);
  assert.match(admin, /if \(!editRequested\) \{[\s\S]*setEditorLot\(null\)/);
  assert.match(admin, /typeof item === 'string' \? item : item\?\.message/);
  assert.match(admin, /const GENERATIONS = \['DDR3', 'DDR4', 'DDR5'\]/);
  assert.match(admin, /const CONDITIONS = \['New',[\s\S]*'Server Pull — Tested',[\s\S]*'Used'\]/);
  assert.match(admin, /import \{ createPortal \} from 'react-dom'/);
  assert.match(admin, /appRoot\.setAttribute\('inert', ''\)[\s\S]*appRoot\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(admin, /if \(rootWasInert\) appRoot\.setAttribute\('inert', ''\)[\s\S]*else appRoot\.removeAttribute\('inert'\)/);
  assert.match(admin, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*\[data-wholesale-editor-trigger\][\s\S]*target\.focus\(\)/);
  assert.match(admin, /role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(admin, /aria-live="assertive"[\s\S]*role="alert">\{editorError\}/);
  assert.match(admin, /aria-live="polite"[\s\S]*role="status">\{editorStatus\}/);
  assert.match(admin, /const accepted = await onUpload\(uploaded\);[\s\S]*accepted !== false[\s\S]*onStatus/);
  assert.match(admin, /if \(!aliveRef\.current\) \{[\s\S]*deleteAsset\(uploaded\.publicId\)[\s\S]*return false/);
  assert.match(admin, /sessionUploadsRef[\s\S]*deleteWholesaleImage/);
  assert.doesNotMatch(admin, /cartApi|checkoutApi|stripePrice/i);
  assert.match(api, /archiveWholesaleLot: \(id, version\) => api\.delete\(`\/admin\/wholesale\/\$\{id\}`/);
});

test("wholesale media and CRUD use their own authenticated API boundary", async () => {
  const api = await read("../src/lib/api.js");
  assert.match(api, /wholesaleApi = \{[\s\S]*publicApi\.get\('\/wholesale'/);
  assert.match(api, /listWholesaleLots: \(params\) => api\.get\('\/admin\/wholesale'/);
  assert.match(api, /createWholesaleLot: \(data\) => api\.post\('\/admin\/wholesale'/);
  assert.match(api, /updateWholesaleLot: \(id, data\) => api\.patch\(`\/admin\/wholesale\/\$\{id\}`/);
  assert.match(api, /uploadWholesaleImage:[\s\S]*api\.post\('\/upload\/wholesale'/);
  assert.match(api, /deleteWholesaleImage:[\s\S]*api\.delete\(`\/upload\/wholesale/);
});

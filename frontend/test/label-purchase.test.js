// The admin label panel spends money on one click, so its rules are tested without a browser (src/lib/labelPurchase.js)
// and the few facts about the component that must never change are pinned as source checks: where the purchase can start,
// what it sends, and that nothing starts it by itself.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  accessWarning, arrivalNote, detailsOf, explainPurchaseError, initialChoice, labelStage, money, panelVisible, priceOf, purchaseRequest, signatureNote, withRequote,
} from "../src/lib/labelPurchase.js";

const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
const ep = { serviceCode: "DOM.EP", serviceName: "Expedited Parcel", due: 19.16, preTax: 18.25, tax: 0.91, transitDays: 3, guaranteed: true, expectedDeliveryDate: "2026-10-14",
  withSignature: { serviceCode: "DOM.EP", serviceName: "Expedited Parcel", due: 21.26, transitDays: 3, guaranteed: true, expectedDeliveryDate: "2026-10-14" } };
const pc = { serviceCode: "DOM.PC", serviceName: "Priority", due: 57.69, withSignature: null };
const pcIncluded = { ...pc, withSignature: { serviceCode: "DOM.PC", due: 57.69 } };
const payload = { options: [ep, pc], recommended: { serviceCode: "DOM.EP", signature: false } };
const eligible = { canQuote: true, canBuy: true, code: null };

test("the panel shows the right screen for every state the server can report", () => {
  assert.equal(labelStage({ label: { status: "created" }, labelEligibility: { canQuote: false, canBuy: false, code: "already-labelled" } }), "bought");
  assert.equal(labelStage({ label: { status: "unknown" }, labelEligibility: { canQuote: false, code: "unknown-outcome" } }), "unfinished");
  assert.equal(labelStage({ label: { status: "creating" }, labelEligibility: { canQuote: false, code: "unknown-outcome" } }), "unfinished", "a claim that never reported back is checked, not waited for");
  assert.equal(labelStage({ label: { status: "creating" }, labelEligibility: { canQuote: false, code: "in-progress" } }), "running");
  assert.equal(labelStage({ labelEligibility: eligible }), "ready");
  assert.equal(labelStage({ label: { status: "failed", error: { message: "x" } }, labelEligibility: eligible }), "ready", "a refused attempt can be tried again");
  assert.equal(labelStage({ labelEligibility: { canQuote: true, canBuy: false, switchedOff: true } }), "switched-off");
  assert.equal(labelStage({ labelEligibility: { canQuote: false, code: "outside-canada" } }), "unavailable");
  assert.equal(labelStage({}), "unavailable");
  assert.equal(labelStage(null), "unavailable");
});

test("the panel says nothing about orders it cannot help with, and explains the ones it can", () => {
  for (const code of ["not-eligible", "not-found", "already-labelled"]) {
    assert.equal(panelVisible({ labelEligibility: { canQuote: false, code } }), false, code);
  }
  for (const code of ["outside-canada", "bad-address", "odd-parcel", "not-configured", "has-tracking"]) {
    assert.equal(panelVisible({ labelEligibility: { canQuote: false, code } }), true, code);
  }
  assert.equal(panelVisible({ labelEligibility: eligible }), true);
  assert.equal(panelVisible({ label: { status: "created" } }), true);
  assert.equal(panelVisible({ label: { status: "unknown" } }), true);
});

test("the picker starts on what the buyer paid for, with the signature only when it is offered", () => {
  assert.deepEqual(initialChoice(payload), { serviceCode: "DOM.EP", signature: false });
  assert.deepEqual(initialChoice({ ...payload, recommended: { serviceCode: "DOM.EP", signature: true } }), { serviceCode: "DOM.EP", signature: true });
  assert.deepEqual(initialChoice({ ...payload, recommended: { serviceCode: "DOM.PC", signature: true } }), { serviceCode: "DOM.PC", signature: false }, "no signature price, no signature");
  assert.deepEqual(initialChoice({ ...payload, recommended: { serviceCode: "DOM.XX" } }), { serviceCode: "DOM.EP", signature: false });
  assert.deepEqual(initialChoice({ options: [] }), { serviceCode: null, signature: false });
  assert.deepEqual(initialChoice(null), { serviceCode: null, signature: false });
});

test("a purchase request is exactly the option and price on screen, flagged as approved", () => {
  assert.deepEqual(purchaseRequest(ep, false), { serviceCode: "DOM.EP", signature: false, approvedDue: 19.16, approve: true });
  assert.deepEqual(purchaseRequest(ep, true), { serviceCode: "DOM.EP", signature: true, approvedDue: 21.26, approve: true });
  assert.equal(purchaseRequest(pc, true), null, "no signature price: nothing to approve");
  assert.equal(purchaseRequest(null, false), null);
  assert.equal(purchaseRequest({ ...ep, due: 0 }, false), null);
  assert.equal(purchaseRequest({ ...ep, due: NaN }, false), null);
  assert.equal(priceOf(ep, true), 21.26);
  assert.equal(priceOf(ep, false), 19.16);
  assert.equal(priceOf(pc, true), null);
  assert.equal(detailsOf(ep, true).due, 21.26);
  assert.equal(money(19.1), "$19.10");
  assert.equal(money(undefined), "$0.00");
});

test("arrival notes read like a sentence and survive missing data", () => {
  const note = arrivalNote(ep);
  assert.match(note, /^3 days · guaranteed · arrives /);
  assert.equal(arrivalNote({ transitDays: 1, guaranteed: false }), "1 day");
  assert.equal(arrivalNote({ expectedDeliveryDate: "not a date" }), "");
  assert.equal(arrivalNote(null), "");
});

test("a changed price replaces the one on screen, for the variant that was bought", () => {
  const plain = withRequote(payload, { serviceCode: "DOM.EP", due: 20.01, serviceName: "Expedited Parcel" }, false);
  assert.equal(plain.options[0].due, 20.01);
  assert.equal(plain.options[0].withSignature.due, 21.26, "the other variant is left alone");
  assert.equal(plain.options[1].due, 57.69);
  const signed = withRequote(payload, { serviceCode: "DOM.EP", due: 22.5 }, true);
  assert.deepEqual([signed.options[0].due, signed.options[0].withSignature.due], [19.16, 22.5]);
  assert.equal(withRequote(null, { serviceCode: "DOM.EP" }, false), null);
  assert.equal(withRequote(payload, null, false), payload);
  assert.equal(payload.options[0].due, 19.16, "the original is not mutated");
});

test("errors from a purchase either ask again, or send the screen back to the truth", () => {
  const changed = explainPurchaseError({ response: { status: 409, data: { error: "The price changed from $19.16 to $20.01.", code: "price-changed", quote: { serviceCode: "DOM.EP", due: 20.01 } } } });
  assert.deepEqual([changed.reload, changed.priceChanged.due], [false, 20.01]);
  assert.match(changed.message, /price changed/);

  const noAnswer = explainPurchaseError({ code: "ECONNABORTED", message: "timeout of 100000ms exceeded" });
  assert.equal(noAnswer.reload, true, "no answer means the outcome is unknown: read the order again");
  assert.match(noAnswer.message, /not known whether the label was bought/);

  const unclear = explainPurchaseError({ response: { status: 502, data: { error: "Canada Post did not give a clear answer.", code: "unknown-outcome" } } });
  assert.deepEqual([unclear.reload, unclear.priceChanged, unclear.message], [true, null, "Canada Post did not give a clear answer."]);

  for (const status of [400, 401, 403]) {
    const untouched = explainPurchaseError({ response: { status, data: { error: "nope" } } });
    assert.equal(untouched.reload, false, `${status}: nothing happened on the server`);
  }
  assert.equal(explainPurchaseError({ response: { status: 500, data: {} } }).message, "The purchase did not go through.");
  assert.equal(explainPurchaseError({ response: { status: 409, data: { code: "price-changed" } } }).priceChanged, null, "without a quote there is nothing to show");
});

test("the purchase starts from one place only: the confirm button of the last step", async () => {
  const source = await read("components/admin/LabelPanel.jsx");
  assert.equal(source.match(/adminApi\.buyLabel\(/g)?.length, 1, "one call site");
  const handler = source.slice(source.indexOf("const confirmPurchase"), source.indexOf("const checkWithCanadaPost"));
  assert.match(handler, /adminApi\.buyLabel\(orderId, request\)/);
  assert.match(handler, /const request = purchaseRequest\(option, choice\.signature\);\s*if \(!request \|\| step !== 'confirming' \|\| purchasing\.current\) return;/);
  assert.match(source, /onClick=\{confirmPurchase\}/);
  assert.equal(source.match(/confirmPurchase/g)?.length, 2, "defined, and used by the button, nowhere else");
  // never from an effect, never from a render
  for (const effect of source.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) || []) assert.doesNotMatch(effect, /buyLabel|confirmPurchase/);
  assert.doesNotMatch(source, /autoBuy|setTimeout\([^)]*confirmPurchase/);
  // the button names the price it will charge
  assert.match(source, /`Charge \$\{money\(due\)\} and create label`/);
  // choosing and reviewing are separate from buying
  assert.match(source, /onClick=\{\(\) => \{ setStep\('confirming'\); setNotice\(null\); \}\}/);
});

test("prices are only asked for when the admin asks, and checking a purchase never buys", async () => {
  const source = await read("components/admin/LabelPanel.jsx");
  assert.equal(source.match(/adminApi\.getLabelOptions\(/g)?.length, 1);
  assert.match(source, /onClick=\{loadOptions\}/);
  const checker = source.slice(source.indexOf("const checkWithCanadaPost"), source.indexOf("const openPdf"));
  assert.match(checker, /adminApi\.checkLabel\(orderId\)/);
  assert.doesNotMatch(checker, /buyLabel/);
});

test("the order screen mounts the panel before the Snap Ship panel and reloads the order after any change", async () => {
  const source = await read("pages/admin/Orders.jsx");
  assert.match(source, /<LabelPanel order=\{order\} onChanged=\{\(\) => reloadOrder\(\)\} \/>/);
  assert.ok(source.indexOf("<LabelPanel") < source.indexOf("<ShippingPreparationPanel"));
  assert.match(source, /o\.label\?\.status === 'created' && \['pending', 'processing'\]\.includes\(o\.status\)/);
});

test("the purchase call waits longer than the server can take, and the read-only calls are GETs", async () => {
  const source = await read("lib/api.js");
  const timeout = (name) => Number(source.match(new RegExp(`${name}: [^\\n]*timeout: (\\d+)`))?.[1]);
  assert.ok(timeout("buyLabel") >= 90000, "token 20 s + price 20 s + Canada Post 45 s fits inside it");
  assert.ok(timeout("checkLabel") >= 90000);
  assert.match(source, /getLabelOptions: \(id, config = \{\}\) => api\.get\(`\/admin\/orders\/\$\{id\}\/label\/options`/);
  assert.match(source, /buyLabel: \(id, request\) => api\.post\(`\/admin\/orders\/\$\{id\}\/label`, request/);
  assert.match(source, /getLabelPdf: \(id\) => api\.get\(`\/admin\/orders\/\$\{id\}\/label\/pdf`, \{ responseType: 'blob'/);
  // axios turns a null body into the JSON text "null", which the server's strict JSON parser answers with a 400 (found in the browser test)
  assert.match(source, /checkLabel: \(id\) => api\.post\(`\/admin\/orders\/\$\{id\}\/label\/reconcile`, \{\}, \{/);
  assert.doesNotMatch(source, /label\/reconcile`, null/);
});

test("text colours in the panel have a dark-on-light and a light-on-dark version", async () => {
  const source = await read("components/admin/LabelPanel.jsx");
  assert.doesNotMatch(source, /(?<!dark:)\btext-(amber|red)-(200|300)\b/, "no bare pale text");
  assert.match(source, /text-amber-700 dark:text-amber-300/);
  assert.match(source, /text-red-700 dark:text-red-300/);
});

test("the chosen service is tinted in a way both themes can read, found when white text vanished on a cream row in dark mode", async () => {
  const source = await read("components/admin/LabelPanel.jsx");
  assert.match(source, /border-\[#8a5a00\] bg-\[#8a5a00\]\/10 dark:border-\[#ffcf24\] dark:bg-\[#ffcf24\]\/10/);
  assert.doesNotMatch(source, /--brand-yellow-tint/, "that variable is a light cream in dark mode");
});

test("once a label is bought the Snap Ship panel stops offering to buy one", async () => {
  const [orders, panel] = await Promise.all([read("pages/admin/Orders.jsx"), read("components/admin/ShippingPreparationPanel.jsx")]);
  assert.match(orders, /<ShippingPreparationPanel preparation=\{order\.shippingPreparation\} labelBought=\{order\.label\?\.status === 'created'\} \/>/);
  assert.match(panel, /\{!labelBought && \(\s*<a className="btn-ghost[^>]*href=\{preparation\.links\?\.snapShip\}/);
  assert.match(panel, /A label has already been bought for this order/);
});

test("the signature note says what it adds: a price, nothing extra, or not offered", () => {
  assert.equal(signatureNote(ep), "+$2.10");
  assert.equal(signatureNote(pcIncluded), "included", "Priority already includes the signature");
  assert.equal(signatureNote(pc), "");
  assert.equal(signatureNote(null), "");
});

test("the screen warns when Canada Post will not let this site create labels, and stays quiet when it can't tell", async () => {
  assert.match(accessWarning({ access: { ok: false, message: "Canada Post refused a test read (HTTP 401)." } }), /HTTP 401/);
  assert.match(accessWarning({ access: { ok: false } }), /not letting this site create labels/);
  assert.equal(accessWarning({ access: { ok: true, message: null } }), "");
  assert.equal(accessWarning({ access: { ok: null, message: "could not be checked" } }), "", "an unknown is not shown as a problem");
  assert.equal(accessWarning({}), "");
  assert.equal(accessWarning(null), "");
  const source = await read("components/admin/LabelPanel.jsx");
  assert.match(source, /\{accessWarning\(payload\) && \(\s*<p[^>]*data-testid="label-access-warning"/);
});

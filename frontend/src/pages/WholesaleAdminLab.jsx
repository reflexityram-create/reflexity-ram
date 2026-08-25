import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Boxes,
  Eye,
  FilePenLine,
  PackageCheck,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useSEO } from "@/lib/seo";
import {
  removeWholesaleDemoLot,
  sanitizeWholesaleDemoLot,
  upsertWholesaleDemoLot,
  validateWholesaleDemoLot,
} from "@/lib/wholesaleDemoStore";
import { useWholesaleDemoLots } from "@/lib/useWholesaleDemoLots";
import "@/pages/wholesale-admin-lab.css";

const EMPTY_FORM = Object.freeze({
  id: "",
  title: "",
  brand: "",
  mpn: "",
  generation: "DDR4",
  formFactor: "RDIMM",
  capacityLabel: "32GB",
  speedLabel: "3200 MT/s",
  rank: "2Rx4",
  condition: "Server Pull — Tested",
  testStatus: "MemTest verified",
  warranty: "90 Days",
  quantityAvailable: 20,
  minimumOrderQuantity: 4,
  orderIncrement: 2,
  shipFrom: "Toronto, Canada",
  imageUrl: "",
  notes: "",
  status: "draft",
  postedAt: "",
  updatedAt: "",
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function lotIdFor(mpn) {
  const slug = String(mpn || "special-lot")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "special-lot";
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) || Date.now().toString(36);
  return `demo-lot-${slug}-${suffix}`;
}

function Field({ id, label, hint, wide = false, children }) {
  return (
    <div className={`wla-field${wide ? " is-wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

function LotRow({ lot, onEdit, onRemove, onToggle }) {
  const isPublished = lot.status === "published";
  return (
    <article className="wla-lot-row">
      <div className="wla-lot-icon"><Boxes aria-hidden="true" size={25} /></div>
      <div className="wla-lot-main">
        <div className="wla-lot-status-line">
          <span className={`wla-status is-${lot.status}`}>{isPublished ? "Published" : "Draft"}</span>
          <span>LOCAL DEMO</span>
        </div>
        <h3>{lot.title || "Untitled special lot"}</h3>
        <p>{lot.mpn || "MPN pending"}</p>
      </div>
      <dl className="wla-lot-terms">
        <div><dt>Available</dt><dd>{lot.quantityAvailable}</dd></div>
        <div><dt>MOQ</dt><dd>{lot.minimumOrderQuantity}</dd></div>
        <div><dt>Increment</dt><dd>{lot.orderIncrement}</dd></div>
      </dl>
      <div className="wla-lot-actions">
        <button onClick={() => onEdit(lot)} type="button"><Pencil aria-hidden="true" size={14} /> Edit</button>
        <button onClick={() => onToggle(lot)} type="button">
          {isPublished ? <FilePenLine aria-hidden="true" size={14} /> : <PackageCheck aria-hidden="true" size={14} />}
          {isPublished ? "Unpublish" : "Publish"}
        </button>
        <button className="is-danger" onClick={() => onRemove(lot)} type="button"><Trash2 aria-hidden="true" size={14} /> Remove</button>
      </div>
    </article>
  );
}

export default function WholesaleAdminLab() {
  useSEO({
    title: "Wholesale Stock Studio | Reflexity local preview",
    description: "Browser-local wholesale lot publishing preview for Reflexity.",
  });
  const { error: storageError, lots, restoreExamples: restoreDemoExamples, saveLots } = useWholesaleDemoLots();
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM }));
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("Select a lot to edit it, or create a new special lot.");

  const summary = useMemo(() => ({
    drafts: lots.filter((lot) => lot.status === "draft").length,
    published: lots.filter((lot) => lot.status === "published").length,
    units: lots.filter((lot) => lot.status === "published")
      .reduce((sum, lot) => sum + Number(lot.quantityAvailable || 0), 0),
  }), [lots]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  function startNew() {
    setForm({ ...EMPTY_FORM });
    setFormError("");
    setNotice("New lots start as drafts. Publish only after the details are verified.");
  }

  function editLot(lot) {
    setForm({ ...lot });
    setFormError("");
    setNotice(`Editing ${lot.mpn || lot.id}.`);
    document.getElementById("wla-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function saveForm(status) {
    const next = sanitizeWholesaleDemoLot({
      ...form,
      id: form.id || lotIdFor(form.mpn),
      status,
      postedAt: status === "published" ? (form.postedAt || today()) : form.postedAt,
      updatedAt: today(),
    });
    const errors = validateWholesaleDemoLot(next, { forPublish: status === "published" });
    if (errors.length) {
      setFormError(errors.join(" "));
      return;
    }
    if (!saveLots(upsertWholesaleDemoLot(lots, next))) return;
    setForm(next);
    setFormError("");
    setNotice(status === "published" ? "Published to the local customer preview." : "Draft saved in this browser.");
  }

  function toggleLot(lot) {
    const status = lot.status === "published" ? "draft" : "published";
    const next = sanitizeWholesaleDemoLot({
      ...lot,
      status,
      postedAt: status === "published" ? (lot.postedAt || today()) : lot.postedAt,
      updatedAt: today(),
    });
    const errors = validateWholesaleDemoLot(next, { forPublish: status === "published" });
    if (errors.length) {
      editLot(lot);
      setFormError(errors.join(" "));
      return;
    }
    if (saveLots(upsertWholesaleDemoLot(lots, next))) {
      setNotice(status === "published" ? `${lot.mpn} is now visible in the customer preview.` : `${lot.mpn} is now a private draft.`);
      if (form.id === lot.id) setForm(next);
    }
  }

  function removeLot(lot) {
    if (!saveLots(removeWholesaleDemoLot(lots, lot.id))) return;
    if (form.id === lot.id) setForm({ ...EMPTY_FORM });
    setFormError("");
    setNotice(`${lot.mpn || "That lot"} was removed from this local demo.`);
  }

  function restoreExamples() {
    if (!restoreDemoExamples()) return;
    setForm({ ...EMPTY_FORM });
    setFormError("");
    setNotice("The three example lots were restored. Your custom demo lots were kept.");
  }

  return (
    <div className="wla-shell">
      <Header />
      <main className="wla-page">
        <section className="wla-hero">
          <div className="wla-grid" aria-hidden="true" />
          <div className="wla-wrap">
            <div className="wla-local-flag"><ShieldCheck aria-hidden="true" size={14} /> LOCAL ADMIN STUDIO · BROWSER-LOCAL ONLY</div>
            <div className="wla-hero-row">
              <div>
                <p>REFLEXITY WHOLESALE</p>
                <h1>Wholesale Stock <em>Studio.</em></h1>
                <span>Create special lots here, keep unfinished work private, and publish only to the local customer preview.</span>
              </div>
              <div className="wla-hero-actions">
                <button className="wla-secondary" onClick={startNew} type="button"><Plus aria-hidden="true" size={16} /> New special lot</button>
                <Link className="wla-primary" rel="noopener noreferrer" target="_blank" to="/wholesale-lab"><Eye aria-hidden="true" size={16} /> Open customer preview <ArrowRight aria-hidden="true" size={15} /></Link>
              </div>
            </div>
            <div className="wla-summary" aria-label="Local wholesale stock summary">
              <div><FilePenLine aria-hidden="true" size={18} /><span>Drafts</span><strong>{summary.drafts}</strong></div>
              <div><PackageCheck aria-hidden="true" size={18} /><span>Published lots</span><strong>{summary.published}</strong></div>
              <div><Boxes aria-hidden="true" size={18} /><span>Published units</span><strong>{summary.units}</strong></div>
            </div>
          </div>
        </section>

        <section className="wla-workspace">
          <div className="wla-wrap wla-workspace-grid">
            <div className="wla-inventory">
              <div className="wla-section-head">
                <div><p>LOCAL INVENTORY</p><h2>Special lots</h2></div>
                <button onClick={restoreExamples} type="button"><RotateCcw aria-hidden="true" size={14} /> Restore demo examples</button>
              </div>
              <div className="wla-safety-note">Demo-only records. No retail products, prices, customer orders, or production data are connected.</div>
              {storageError && <div className="wla-error" role="alert">{storageError}</div>}
              <div className="wla-lot-list">
                {lots.length ? lots.map((lot) => (
                  <LotRow key={lot.id} lot={lot} onEdit={editLot} onRemove={removeLot} onToggle={toggleLot} />
                )) : (
                  <div className="wla-no-lots"><Boxes aria-hidden="true" size={28} /><strong>No local lots</strong><span>Create one or restore the examples.</span></div>
                )}
              </div>
            </div>

            <aside className="wla-editor" id="wla-editor" aria-labelledby="wla-editor-title">
              <div className="wla-editor-top">
                <div><p>{form.id ? "EDIT LOCAL LOT" : "NEW LOCAL LOT"}</p><h2 id="wla-editor-title">{form.id ? "Update the listing" : "Post special stock"}</h2></div>
                <span className={`wla-status is-${form.status}`}>{form.status === "published" ? "Published" : "Draft"}</span>
              </div>
              <p className="wla-editor-note" aria-live="polite">{notice}</p>
              <form onSubmit={(event) => { event.preventDefault(); saveForm("draft"); }}>
                <div className="wla-form-section">
                  <h3>Identity</h3>
                  <div className="wla-form-grid">
                    <Field id="wla-title" label="Customer-facing title" wide>
                      <input id="wla-title" onChange={(event) => setField("title", event.target.value)} placeholder="Example OEM 32GB DDR4 ECC RDIMM" required value={form.title} />
                    </Field>
                    <Field id="wla-brand" label="Brand">
                      <input id="wla-brand" onChange={(event) => setField("brand", event.target.value)} placeholder="Example OEM" value={form.brand} />
                    </Field>
                    <Field id="wla-mpn" label="MPN or SKU">
                      <input id="wla-mpn" onChange={(event) => setField("mpn", event.target.value)} placeholder="DEMO-RDIMM-32-3200" required value={form.mpn} />
                    </Field>
                  </div>
                </div>

                <div className="wla-form-section">
                  <h3>Memory specification</h3>
                  <div className="wla-form-grid is-three">
                    <Field id="wla-generation" label="Generation"><select id="wla-generation" onChange={(event) => setField("generation", event.target.value)} value={form.generation}><option>DDR4</option><option>DDR5</option></select></Field>
                    <Field id="wla-form-factor" label="Form factor"><select id="wla-form-factor" onChange={(event) => setField("formFactor", event.target.value)} value={form.formFactor}><option>RDIMM</option><option>LRDIMM</option><option>UDIMM</option><option>SO-DIMM</option></select></Field>
                    <Field id="wla-capacity" label="Capacity"><input id="wla-capacity" onChange={(event) => setField("capacityLabel", event.target.value)} placeholder="32GB" value={form.capacityLabel} /></Field>
                    <Field id="wla-speed" label="Speed"><input id="wla-speed" onChange={(event) => setField("speedLabel", event.target.value)} placeholder="3200 MT/s" value={form.speedLabel} /></Field>
                    <Field id="wla-rank" label="Rank"><input id="wla-rank" onChange={(event) => setField("rank", event.target.value)} placeholder="2Rx4" value={form.rank} /></Field>
                    <Field id="wla-condition" label="Condition"><input id="wla-condition" onChange={(event) => setField("condition", event.target.value)} value={form.condition} /></Field>
                  </div>
                </div>

                <div className="wla-form-section">
                  <h3>Availability &amp; assurance</h3>
                  <div className="wla-form-grid is-three">
                    <Field id="wla-quantity" label="Available units"><input id="wla-quantity" min="1" onChange={(event) => setField("quantityAvailable", event.target.value)} type="number" value={form.quantityAvailable} /></Field>
                    <Field id="wla-moq" label="Minimum order"><input id="wla-moq" min="1" onChange={(event) => setField("minimumOrderQuantity", event.target.value)} type="number" value={form.minimumOrderQuantity} /></Field>
                    <Field id="wla-increment" label="Order increment"><input id="wla-increment" min="1" onChange={(event) => setField("orderIncrement", event.target.value)} type="number" value={form.orderIncrement} /></Field>
                    <Field id="wla-testing" label="Testing status"><input id="wla-testing" onChange={(event) => setField("testStatus", event.target.value)} value={form.testStatus} /></Field>
                    <Field id="wla-warranty" label="Warranty"><input id="wla-warranty" onChange={(event) => setField("warranty", event.target.value)} value={form.warranty} /></Field>
                    <Field id="wla-ship-from" label="Ships from"><input id="wla-ship-from" onChange={(event) => setField("shipFrom", event.target.value)} value={form.shipFrom} /></Field>
                    <Field id="wla-notes" label="Customer note" wide><textarea id="wla-notes" onChange={(event) => setField("notes", event.target.value)} placeholder="Condition, matching, or delivery notes shown with this lot." rows="3" value={form.notes} /></Field>
                  </div>
                </div>

                {formError && <div className="wla-form-error" role="alert">{formError}</div>}
                <div className="wla-editor-actions">
                  <button className="wla-secondary" onClick={startNew} type="button">Clear</button>
                  <button className="wla-secondary" type="submit"><Save aria-hidden="true" size={15} /> Save draft</button>
                  <button className="wla-primary" onClick={() => saveForm("published")} type="button"><PackageCheck aria-hidden="true" size={15} /> Publish to preview</button>
                </div>
              </form>
            </aside>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

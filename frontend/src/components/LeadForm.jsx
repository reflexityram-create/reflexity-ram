import { cloneElement, useMemo, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { leadsApi } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { createLeadRequestId } from "@/lib/leadRequest";
export { buildLeadPrefill } from "@/lib/leadPrefill";

const INTENTS = [
  ["buy", "Request inventory / bulk pricing"],
  ["sell", "Sell hardware to Reflexity"],
  ["general", "General business inquiry"],
];

const emptyForm = {
  intent: "general", name: "", company: "", email: "", phone: "", productType: "",
  manufacturer: "", partNumber: "", specification: "", quantity: "", condition: "",
  location: "", notes: "", website: "", sourceType: "", sourceId: "", sourceCode: "", sku: "", itemTitle: "",
};

function initialValues(search) {
  const params = new URLSearchParams(search);
  const intent = params.get("intent");
  return {
    ...emptyForm,
    intent: ["buy", "sell", "general"].includes(intent) ? intent : "general",
    productType: params.get("productType") || "",
    partNumber: params.get("partNumber") || "",
    specification: params.get("specification") || "",
    quantity: params.get("quantity") || "",
    sourceType: params.get("sourceType") || "",
    sourceId: params.get("sourceId") || "",
    sourceCode: params.get("sourceCode") || "",
    sku: params.get("sku") || "",
    itemTitle: params.get("itemTitle") || "",
  };
}

export default function LeadForm({ defaultIntent, heading = "Start a conversation" }) {
  const [form, setForm] = useState(() => ({ ...initialValues(window.location.search), ...(defaultIntent ? { intent: defaultIntent } : {}) }));
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(null);
  const quantityError = useMemo(() => form.quantity && (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) < 1), [form.quantity]);

  const update = (event) => {
    setRequestId(null);
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (quantityError) { setError("Quantity must be a positive whole number."); return; }
    const activeRequestId = requestId || createLeadRequestId();
    if (!requestId) setRequestId(activeRequestId);
    setStatus("sending"); setError("");
    try {
      await leadsApi.create({ ...form, requestId: activeRequestId, quantity: form.quantity ? Number(form.quantity) : undefined });
      setStatus("success");
      trackEvent("generate_lead", { lead_type: form.intent, product_type: form.productType || "unspecified" });
    } catch (requestError) {
      setStatus("idle");
      setError(requestError?.response?.data?.error || "We could not send this inquiry. Please email reflexityram@gmail.com.");
    }
  };

  if (status === "success") return <div className="lead-success" role="status" data-testid="lead-form-success"><CheckCircle2 size={28} /><div><h2>Inquiry received.</h2><p>Reflexity has your requirements. This is an inquiry, not an accepted order.</p></div></div>;

  return <form className="lead-form" onSubmit={submit} data-testid="lead-form">
    <div className="lead-form-heading"><p className="mono">QUOTE DESK</p><h2>{heading}</h2><span>Tell us what you need or what you have available.</span></div>
    <div className="lead-grid">
      <Field label="Inquiry type" required><select name="intent" value={form.intent} onChange={update}>{INTENTS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
      <Field label="Product type" required><input name="productType" value={form.productType} onChange={update} required placeholder="Server RAM, SSDs, CPUs…" /></Field>
      <Field label="Name" required><input name="name" value={form.name} onChange={update} required autoComplete="name" /></Field>
      <Field label="Company"><input name="company" value={form.company} onChange={update} autoComplete="organization" /></Field>
      <Field label="Business email" required><input name="email" type="email" value={form.email} onChange={update} required autoComplete="email" /></Field>
      <Field label="Phone"><input name="phone" type="tel" value={form.phone} onChange={update} autoComplete="tel" /></Field>
      <Field label="Manufacturer"><input name="manufacturer" value={form.manufacturer} onChange={update} placeholder="Samsung, Micron, HPE…" /></Field>
      <Field label="Part number"><input name="partNumber" value={form.partNumber} onChange={update} placeholder="Exact MPN if known" /></Field>
      <Field label="Capacity / specification"><input name="specification" value={form.specification} onChange={update} placeholder="32GB DDR4 ECC RDIMM" /></Field>
      <Field label="Quantity"><input name="quantity" type="number" min="1" step="1" value={form.quantity} onChange={update} aria-invalid={quantityError || undefined} /></Field>
      <Field label="Condition"><input name="condition" value={form.condition} onChange={update} placeholder="Tested, used, new…" /></Field>
      <Field label="Location"><input name="location" value={form.location} onChange={update} placeholder="City, province/state, country" /></Field>
    </div>
    <Field label="Notes"><textarea name="notes" value={form.notes} onChange={update} rows="5" placeholder="Timeline, preferred quantities, related part numbers, or other requirements." /></Field>
    <div className="lead-honeypot" aria-hidden="true"><label htmlFor="website">Website</label><input id="website" name="website" tabIndex="-1" autoComplete="off" value={form.website} onChange={update} /></div>
    {error && <p className="lead-error" role="alert">{error}</p>}
    <button className="btn-primary" disabled={status === "sending"} type="submit"><Send size={15} />{status === "sending" ? "Sending inquiry…" : form.intent === "sell" ? "Send hardware details" : form.intent === "buy" ? "Send purchase requirements" : "Send inquiry"}</button>
  </form>;
}

function Field({ label, required = false, children }) {
  const id = `lead-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return <div className="lead-field"><label htmlFor={id}>{label}{required && <b aria-hidden="true"> *</b>}</label>{cloneElement(children, { id: children.props.id || id })}</div>;
}

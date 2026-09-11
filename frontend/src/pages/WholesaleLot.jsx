import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Cpu, Loader2, Minus, Plus } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { buildLeadPrefill } from "@/components/LeadForm";
import { wholesaleApi } from "@/lib/api";
import { DETAIL_IMAGE_WIDTHS, imageSrcSet, imageUrl } from "@/lib/imageUrl";
import { normalizeWholesaleQuantity } from "@/lib/wholesaleLots";
import { useSEO } from "@/lib/seo";

export function LotUnavailable({ loading = false }) { return <div className="container-tight catalog-status" role="status"><h1>{loading ? "Loading wholesale lot…" : "Lot unavailable"}</h1><p>{loading ? "Checking posted inventory." : "This wholesale lot is not currently posted."}</p><Link to="/wholesale">Back to wholesale</Link></div>; }

export function WholesaleLotDetail({ lot, backTo = "/wholesale" }) {
  const maximum = normalizeWholesaleQuantity(lot, lot.quantityAvailable); const [quantity, setQuantity] = useState(1);
  const specification = [lot.capacityLabel, lot.generation, lot.formFactor, lot.speedLabel, lot.rank].filter(Boolean).join(" ");
  const quote = buildLeadPrefill({ intent: "buy", productType: "RAM", sourceType: "wholesale-lot", sourceId: lot.id, sourceCode: lot.lotCode || "", sku: lot.sku || "", itemTitle: lot.title || "", partNumber: lot.mpn || "", specification, quantity });
  const rows = [["Part number", lot.mpn], ["Lot", lot.lotCode], ["Generation", lot.generation], ["Form factor", lot.formFactor], ["Capacity", lot.capacityLabel], ["Speed", lot.speedLabel], ["Condition", lot.condition], ["Testing", lot.testStatus], ["Available", lot.quantityAvailable ? `${lot.quantityAvailable}+ units` : "Confirm by quote"]].filter(([, value]) => value);
  return <section className="container-tight inventory-detail"><Link className="back-link" to={backTo}><ChevronLeft size={15} />Back to wholesale</Link><div className="inventory-detail-grid"><div className="inventory-image detail-image">{lot.imageUrl ? <img src={imageUrl(lot.imageUrl, { width: 1200 })} srcSet={imageSrcSet(lot.imageUrl, DETAIL_IMAGE_WIDTHS)} sizes="(min-width: 1024px) 52vw, 100vw" alt={lot.imageAlt || lot.title} width="1200" height="960" loading="eager" fetchPriority="high" /> : <Cpu size={48} />}</div><div><p className="mono">{lot.mpn || lot.lotCode || "WHOLESALE LOT"}</p><h1>{lot.title}</h1><p className="detail-summary">{lot.notes || "Select the quantity you require, then submit the lot request through the quote desk."}</p><dl className="spec-table">{rows.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><div className="quantity-request"><label htmlFor="wholesale-quantity">Request quantity</label><div><button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(normalizeWholesaleQuantity(lot, quantity - 1))} disabled={quantity <= 1}><Minus size={15} /></button><input id="wholesale-quantity" type="number" min="1" max={maximum} value={quantity} onChange={(event) => setQuantity(normalizeWholesaleQuantity(lot, event.target.value))} /><button type="button" aria-label="Increase quantity" onClick={() => setQuantity(normalizeWholesaleQuantity(lot, quantity + 1))} disabled={quantity >= maximum}><Plus size={15} /></button></div></div><Link className="btn-primary" to={quote}>Request {quantity} {quantity === 1 ? "unit" : "units"}</Link><p className="detail-note">Quantity is an inquiry only. Availability and all lot-specific commercial terms are confirmed in the quote.</p></div></div></section>;
}

export default function WholesaleLot() {
  const { lotId } = useParams(); const [state, setState] = useState({ lot: null, loading: true });
  useSEO({ title: state.lot ? `${state.lot.title} | Wholesale inventory` : "Wholesale inventory" });
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setState({ lot: null, loading: true });
    wholesaleApi.getById(lotId, { signal: controller.signal })
      .then(({ data }) => {
        if (!active) return;
        setState({ lot: data?.lot || null, loading: false });
      })
      .catch((error) => {
        if (!active) return;
        if (error?.code !== "ERR_CANCELED" && error?.name !== "AbortError") setState({ lot: null, loading: false });
      })
      .finally(() => { if (!active) return; setState((current) => current.loading ? { ...current, loading: false } : current); });
    return () => { active = false; controller.abort(); };
  }, [lotId]);
  return <><Header /><main className="page">{state.loading ? <LotUnavailable loading /> : state.lot ? <WholesaleLotDetail key={state.lot.id} lot={state.lot} /> : <LotUnavailable />}</main><Footer /></>;
}

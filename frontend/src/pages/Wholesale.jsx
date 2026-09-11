import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Cpu, Loader2 } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { buildLeadPrefill } from "@/components/LeadForm";
import { wholesaleApi } from "@/lib/api";
import { publishedWholesaleLots } from "@/lib/wholesaleLots";
import { imageSrcSet, imageUrl } from "@/lib/imageUrl";
import { useSEO } from "@/lib/seo";

const BUYERS = ["IT asset resellers", "Computer refurbishers", "Repair businesses", "MSPs", "Data-centre and server operators", "System integrators", "Electronics recyclers"];

export function WholesaleMarket({ postedLots = [], stockLoading = false, stockError = null, detailBasePath = "/wholesale" }) {
  return <section className="wholesale-market"><div className="buyer-copy"><p className="mono">REFLEXITY / WHOLESALE BUYERS</p><h1>Bulk hardware for organizations that work in exact parts.</h1><p>Use posted lots as a starting point, or send the specifications you need. We support quote-led, lot-based buying conversations for ongoing supply relationships.</p><div className="buyer-tags">{BUYERS.map((buyer) => <span key={buyer}>{buyer}</span>)}</div><Link className="btn-primary" to="/contact?intent=buy&productType=RAM">Send purchase requirements</Link></div><div className="lot-ledger"><div className="lot-ledger-head"><span>POSTED LOTS</span><span>AVAILABILITY</span></div>{stockLoading ? <p className="catalog-status"><Loader2 className="animate-spin" />Loading posted lots…</p> : stockError ? <p className="catalog-status" role="alert">{stockError}</p> : postedLots.length ? postedLots.map((lot) => <Link className="lot-row" key={lot.id} to={`${detailBasePath}/${encodeURIComponent(lot.id)}`}><span className="mono">{lot.mpn || lot.lotCode || "LOT"}</span><strong>{lot.title}</strong><em>{lot.quantityAvailable ? `${lot.quantityAvailable}+ available` : "Confirm availability"}</em><ArrowUpRight size={16} /></Link>) : <p className="catalog-status">No lots are posted right now. <Link to="/contact?intent=buy&productType=RAM">Send an exact requirement</Link>.</p>}</div></section>;
}

export default function Wholesale() {
  const [state, setState] = useState({ lots: [], loading: true, error: null });
  useSEO({ title: "Wholesale Buyers", description: "Bulk RAM, ECC server memory, storage, CPUs, and IT hardware inquiries for resellers, refurbishers, MSPs, and operators." });
  useEffect(() => { const controller = new AbortController(); wholesaleApi.list({ signal: controller.signal }).then(({ data }) => setState({ lots: publishedWholesaleLots(data?.lots || []).filter((lot) => lot.visibility === "public"), loading: false, error: null })).catch((error) => { if (error?.code !== "ERR_CANCELED") setState({ lots: [], loading: false, error: "Posted inventory is unavailable right now. Please send the part number and quantity you need." }); }); return () => controller.abort(); }, []);
  return <><Header /><main className="page"><div className="container-tight"><WholesaleMarket postedLots={state.lots} stockLoading={state.loading} stockError={state.error} /><section className="wholesale-categories"><div><Cpu size={22} /><h2>Memory categories</h2><p>Server RAM, ECC RDIMM, LRDIMM, desktop memory, laptop SODIMM, DDR3, DDR4, and DDR5.</p></div><div><Cpu size={22} /><h2>Related hardware</h2><p>CPUs, SSDs, storage, servers, components, and available IT hardware when appropriate.</p></div><div><Cpu size={22} /><h2>Commercial approach</h2><p>Quantity, condition, shipping, payment, returns, and warranty terms are confirmed for each quote or lot.</p></div></section></div></main><Footer /></>;
}

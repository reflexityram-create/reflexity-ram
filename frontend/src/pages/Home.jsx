import { Link } from "react-router-dom";
import { ArrowUpRight, Boxes, Search, Upload } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useSEO } from "@/lib/seo";

const rails = [
  ["01", "Inventory", "Posted RAM and hardware lots with part-number detail."],
  ["02", "Requirements", "Tell us the exact specification and total quantity you need."],
  ["03", "Supply", "Offer available hardware and send your acquisition list."],
];

export default function Home() {
  useSEO({ title: "Wholesale Memory & IT Hardware", description: "Reflexity supplies and buys bulk RAM, server memory, and computer hardware for resellers, refurbishers, businesses, and IT operators." });
  return <><Header /><main className="page home-page"><section className="container-tight hero-ledger"><div className="hero-copy"><p className="mono">REFLEXITY / TORONTO, ONTARIO</p><h1>Wholesale memory <span>&amp; IT hardware.</span></h1><p>Bulk RAM, server memory, and computer hardware for resellers, refurbishers, businesses, and IT operators.</p><div className="hero-actions"><Link className="btn-secondary" to="/inventory"><Boxes size={16} />View inventory</Link><Link className="btn-primary" to="/contact?intent=buy&productType=RAM"><Search size={16} />Request a quote</Link><Link className="text-link" to="/sell-to-us"><Upload size={15} />Sell us hardware</Link></div></div><div className="ledger-panel" aria-label="Wholesale inventory workflow"><div className="ledger-head"><span>LOT LEDGER</span><span>LIVE INQUIRY</span></div><div className="ledger-row"><b>SERVER</b><span>ECC RDIMM / LRDIMM</span><i>QUOTE</i></div><div className="ledger-row"><b>DESKTOP</b><span>DDR3 / DDR4 / DDR5</span><i>QUOTE</i></div><div className="ledger-row"><b>LAPTOP</b><span>SODIMM / bulk lots</span><i>QUOTE</i></div><div className="ledger-row"><b>HARDWARE</b><span>CPUs / storage / components</span><i>INQUIRE</i></div><div className="ledger-foot">Part number + quantity → availability conversation</div></div></section><section className="container-tight home-rails"><div className="section-heading"><p className="mono">HOW REFLEXITY WORKS</p><h2>A quote-led hardware partner—not a consumer checkout.</h2></div><div className="rail-grid">{rails.map(([number, title, text]) => <article key={number}><span className="mono">{number}</span><h3>{title}</h3><p>{text}</p><ArrowUpRight size={17} /></article>)}</div></section><section className="container-tight home-split"><div><p className="mono">FOR BUYERS</p><h2>Build repeat supply around the parts you actually need.</h2><p>Share the memory generation, form factor, capacity, part number, and quantity. We will use the inquiry to discuss posted or available inventory.</p><Link to="/wholesale">Wholesale buyer information</Link></div><div><p className="mono">FOR SELLERS</p><h2>Have a meaningful hardware lot?</h2><p>Send the key details: product type, manufacturer, part number, quantity, condition, and location. A concise list is enough to start.</p><Link to="/sell-to-us">Sell to Reflexity</Link></div></section></main><Footer /></>;
}

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useSEO } from "@/lib/seo";

export default function About() {
  useSEO({ title: "About Reflexity", description: "Reflexity is a Toronto, Ontario-based wholesale source for bulk computer memory and IT hardware inquiries." });
  return <><Header /><main className="page"><section className="container-tight about-page"><p className="mono">TORONTO, ONTARIO / CANADA</p><h1>Memory supply is a part-number business.</h1><p>Reflexity focuses on bulk RAM, server memory, and related IT hardware for organizations that need clear specifications, lot-level availability, and a direct quote process.</p><div className="about-rail"><span>BUY</span><span>SELL</span><span>SOURCE</span><span>QUOTE</span></div><p>We work from product and lot information—not impulse checkout. If you are sourcing inventory or have hardware to sell, use the quote desk with the parts and quantities involved.</p></section></main><Footer /></>;
}

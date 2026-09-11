import Header from "@/components/Header";
import Footer from "@/components/Footer";
import LeadForm from "@/components/LeadForm";
import { useSEO } from "@/lib/seo";

const TYPES = ["Server RAM and ECC memory", "Desktop and laptop memory", "CPUs and server components", "SSDs and storage", "Servers and related IT hardware"];

export default function SellToUs() {
  useSEO({ title: "Sell Bulk Hardware", description: "Offer Reflexity bulk server memory, RAM, CPUs, storage, and related IT hardware." });
  return <><Header /><main className="page"><section className="container-tight sell-page"><div className="page-intro"><p className="mono">REFLEXITY / ACQUISITIONS</p><h1>Turn excess hardware into a clear bulk conversation.</h1><p>We are interested in meaningful quantities of memory and related IT hardware. Send an inventory summary or the key line items—part number, quantity, condition, and location.</p><ul className="sell-list">{TYPES.map((type) => <li key={type}>{type}</li>)}</ul></div><LeadForm defaultIntent="sell" heading="Tell us about your hardware" /></section></main><Footer /></>;
}

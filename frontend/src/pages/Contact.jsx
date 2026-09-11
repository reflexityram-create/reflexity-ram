import Header from "@/components/Header";
import Footer from "@/components/Footer";
import LeadForm from "@/components/LeadForm";
import { useSEO } from "@/lib/seo";

export default function Contact() {
  useSEO({ title: "Request a Quote", description: "Send Reflexity your bulk RAM or IT hardware requirements, exact part numbers, and quantities." });
  return <><Header /><main className="page"><section className="container-tight contact-page"><div className="page-intro"><p className="mono">REFLEXITY / QUOTE DESK</p><h1>Request availability and bulk pricing.</h1><p>Share the exact part number, specification, and quantity. Catalog listings and quote submissions are inquiries; they do not create an accepted purchase agreement.</p></div><LeadForm /></section></main><Footer /></>;
}

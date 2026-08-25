import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useSEO } from "@/lib/seo";
import { buildWholesaleEmailUrl } from "@/lib/wholesaleLots";
import "@/pages/wholesale-concepts.css";

const WHOLESALE_GMAIL_URL = buildWholesaleEmailUrl();

export default function Wholesale() {
  useSEO({
    title: "Wholesale DDR4 & DDR5 RAM | Reflexity",
    description:
      "Contact Reflexity's Toronto wholesale desk to buy, sell, or source exact-SKU DDR4 and DDR5 RAM.",
  });

  return (
    <div className="wholesale-simple-shell">
      <Header />
      <main className="wholesale-simple">
        <section className="ws-one-screen">
          <div className="ws-glow" />
          <div className="ws-grid-lines" />
          <div className="ws-container ws-one-grid">
            <div className="ws-pitch">
              <div className="ws-eyebrow"><span /> REFLEXITY WHOLESALE</div>
              <h1>Bulk RAM.<br /><em>One direct contact.</em></h1>
              <p>
                Reflexity buys, sells and sources DDR4 and DDR5 memory for
                resellers, computer shops and IT teams.
              </p>
              <div className="ws-quick-facts">
                <span>Exact-SKU sourcing</span>
                <i />
                <span>Toronto, Canada</span>
                <i />
                <span>Domestic & international</span>
              </div>
              <div className="ws-trust"><ShieldCheck aria-hidden="true" size={15} /> Inventory source and responsibility are identified in each quote.</div>
              <p className="ws-retail-link">Need only one or two sticks? <Link to="/shop">Shop retail stock.</Link></p>
            </div>

            <aside className="ws-coming" aria-labelledby="wholesale-desk-title">
              <div className="ws-coming-top">
                <span>BUYING IN VOLUME?</span>
                <div>DIRECT CONTACT</div>
              </div>
              <div className="ws-coming-icon"><Mail aria-hidden="true" size={27} /></div>
              <h2 id="wholesale-desk-title">Tell us the SKU and quantity.</h2>
              <p>We do wholesale on server pulls — tell us the SKU and quantity.</p>
              <div className="ws-coming-list">
                <span><CheckCircle2 aria-hidden="true" size={16} /> Part number and exact specification</span>
                <span><CheckCircle2 aria-hidden="true" size={16} /> Quantity and condition preference</span>
                <span><CheckCircle2 aria-hidden="true" size={16} /> Destination and required date</span>
              </div>
              <a
                className="ws-contact-link"
                href={WHOLESALE_GMAIL_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get bulk pricing <ArrowRight aria-hidden="true" size={16} />
              </a>
            </aside>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

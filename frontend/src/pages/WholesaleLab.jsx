import { Link } from "react-router-dom";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Mail,
  MapPin,
  PackageOpen,
  Server,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useSEO } from "@/lib/seo";
import { WHOLESALE_LOTS } from "@/data/wholesaleLots";
import { buildWholesaleEmailUrl, publishedWholesaleLots } from "@/lib/wholesaleLots";
import "@/pages/wholesale-lab.css";

const PUBLISHED_LOTS = publishedWholesaleLots(WHOLESALE_LOTS);
const WHOLESALE_CONTACT_URL = buildWholesaleEmailUrl();

function WholesaleLotCard({ lot }) {
  const minimum = Math.max(1, Number(lot.minimumOrderQuantity) || 1);
  return (
    <article className="wlp-lot">
      <div className="wlp-lot-media">
        {lot.imageUrl ? (
          <img alt={lot.title} src={lot.imageUrl} />
        ) : (
          <Boxes aria-hidden="true" size={42} />
        )}
        <span>{lot.condition}</span>
      </div>
      <div className="wlp-lot-body">
        <div className="wlp-lot-kicker"><span>{lot.formFactor}</span><span>{lot.testStatus}</span></div>
        <h3>{lot.title}</h3>
        <p className="wlp-lot-mpn">{lot.mpn}</p>
        <dl>
          <div><dt>Specification</dt><dd>{[lot.capacityLabel, lot.generation, lot.speedLabel, lot.rank].filter(Boolean).join(" · ")}</dd></div>
          <div><dt>Available</dt><dd>{lot.quantityAvailable} units</dd></div>
          <div><dt>Minimum</dt><dd>{minimum} units</dd></div>
          <div><dt>Ships from</dt><dd>{lot.shipFrom}</dd></div>
        </dl>
        <a
          className="wlp-lot-quote"
          href={buildWholesaleEmailUrl([{ lot, quantity: minimum }])}
          rel="noopener noreferrer"
          target="_blank"
        >
          Request this lot <ArrowRight aria-hidden="true" size={16} />
        </a>
      </div>
    </article>
  );
}

export default function WholesaleLab() {
  useSEO({
    title: "Wholesale RAM stock | Reflexity local preview",
    description: "Manually posted wholesale-only memory lots and direct bulk sourcing from Reflexity.",
  });

  return (
    <div className="wlp-shell">
      <Header />
      <main className="wlp-page">
        <section className="wlp-hero">
          <div className="wlp-grid" aria-hidden="true" />
          <div className="wlp-glow" aria-hidden="true" />
          <div className="wlp-wrap wlp-hero-grid">
            <div className="wlp-copy">
              <p className="wlp-eyebrow"><span /> REFLEXITY WHOLESALE</p>
              <h1>Special stock.<br /><em>Posted separately.</em></h1>
              <p className="wlp-lede">
                Wholesale inventory is separate from the regular shop. Reflexity
                manually posts verified server pulls, bulk lots, and one-off stock
                here when it becomes available.
              </p>
              <div className="wlp-facts" aria-label="Wholesale service details">
                <span><ShieldCheck aria-hidden="true" size={16} /> Manually verified</span>
                <span><Server aria-hidden="true" size={16} /> Quote-only lots</span>
                <span><MapPin aria-hidden="true" size={16} /> Toronto, Canada</span>
              </div>
              <p className="wlp-retail-link">
                Looking for regular stock? <Link to="/shop">Shop retail RAM</Link>.
              </p>
            </div>

            <aside className="wlp-volume" aria-labelledby="wlp-volume-title">
              <div className="wlp-volume-top"><span>BUYING IN VOLUME?</span><i>DIRECT CONTACT</i></div>
              <div className="wlp-volume-icon"><Mail aria-hidden="true" size={25} /></div>
              <h2 id="wlp-volume-title">Tell us the SKU and quantity.</h2>
              <p>We do wholesale on server pulls — tell us the SKU and quantity.</p>
              <div className="wlp-volume-list">
                <span><CheckCircle2 aria-hidden="true" size={16} /> Part number and exact specification</span>
                <span><CheckCircle2 aria-hidden="true" size={16} /> Quantity and condition preference</span>
                <span><CheckCircle2 aria-hidden="true" size={16} /> Destination and required date</span>
              </div>
              <a className="wlp-primary" href={WHOLESALE_CONTACT_URL} rel="noopener noreferrer" target="_blank">
                Get bulk pricing <ArrowRight aria-hidden="true" size={16} />
              </a>
            </aside>
          </div>
        </section>

        <section className="wlp-stock" aria-labelledby="wlp-stock-title">
          <div className="wlp-wrap">
            <div className="wlp-stock-head">
              <div>
                <p className="wlp-section-label">POSTED WHOLESALE STOCK</p>
                <h2 id="wlp-stock-title">Special lots</h2>
              </div>
              <div className="wlp-stock-count"><strong>{PUBLISHED_LOTS.length}</strong><span>live lot{PUBLISHED_LOTS.length === 1 ? "" : "s"}</span></div>
            </div>
            <p className="wlp-stock-note">
              Only wholesale lots posted manually by Reflexity appear here.
              Products from the regular shop never show in this section.
            </p>

            {PUBLISHED_LOTS.length ? (
              <div className="wlp-lots">
                {PUBLISHED_LOTS.map((lot) => <WholesaleLotCard key={lot.id} lot={lot} />)}
              </div>
            ) : (
              <div className="wlp-empty">
                <div className="wlp-empty-icon"><PackageOpen aria-hidden="true" size={31} /></div>
                <div>
                  <p>NO LIVE WHOLESALE LOTS</p>
                  <h3>No wholesale stock is posted right now.</h3>
                  <span>
                    New server pulls and special lots will appear here only after
                    Reflexity verifies and publishes them manually.
                  </span>
                </div>
                <a href={WHOLESALE_CONTACT_URL} rel="noopener noreferrer" target="_blank">
                  Tell us what you need <ArrowRight aria-hidden="true" size={16} />
                </a>
              </div>
            )}
          </div>
        </section>

        <section className="wlp-contact" aria-labelledby="wlp-contact-title">
          <div className="wlp-wrap wlp-contact-card">
            <div>
              <p>DON&apos;T SEE WHAT YOU NEED?</p>
              <h2 id="wlp-contact-title">Send the requirement.</h2>
              <span>
                Include the MPN or SKU, specification, quantity, destination, and
                deadline. We&apos;ll reply by email with availability and quote details.
              </span>
            </div>
            <div className="wlp-contact-actions">
              <a className="wlp-primary" href={WHOLESALE_CONTACT_URL} rel="noopener noreferrer" target="_blank">
                <Mail aria-hidden="true" size={16} /> Contact us
              </a>
              <Link className="wlp-secondary" to="/liquidators">
                <ShoppingBag aria-hidden="true" size={16} /> Sell stock to Reflexity
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

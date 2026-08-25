import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Mail,
  PackageOpen,
  ShoppingBag,
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useSEO } from "@/lib/seo";
import { publishedWholesaleDemoLots } from "@/lib/wholesaleDemoStore";
import { buildWholesaleEmailUrl } from "@/lib/wholesaleLots";
import { useWholesaleDemoLots } from "@/lib/useWholesaleDemoLots";
import "@/pages/wholesale-lab.css";

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
        <i>LOCAL DEMO</i>
        <span>{lot.condition}</span>
      </div>
      <div className="wlp-lot-body">
        <div className="wlp-lot-kicker"><span>{lot.formFactor}</span><span>{lot.testStatus}</span></div>
        <h2>{lot.title}</h2>
        <p className="wlp-lot-mpn">{lot.mpn}</p>
        <dl>
          <div><dt>Specification</dt><dd>{[lot.capacityLabel, lot.generation, lot.speedLabel, lot.rank].filter(Boolean).join(" · ")}</dd></div>
          <div><dt>Available</dt><dd>{lot.quantityAvailable} units</dd></div>
          <div><dt>Minimum</dt><dd>{minimum} units</dd></div>
          <div><dt>Warranty</dt><dd>{lot.warranty}</dd></div>
          <div><dt>Ships from</dt><dd>{lot.shipFrom}</dd></div>
        </dl>
        {lot.notes && <p className="wlp-lot-note">{lot.notes}</p>}
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
  const { error: demoError, lots } = useWholesaleDemoLots();
  const publishedLots = publishedWholesaleDemoLots(lots);

  return (
    <div className="wlp-shell">
      <Header />
      <main className="wlp-page">
        <section className="wlp-stock" aria-labelledby="wlp-stock-title">
          <div className="wlp-wrap">
            <div className="wlp-stock-head">
              <div>
                <p className="wlp-section-label">CUSTOMER PREVIEW</p>
                <h1 id="wlp-stock-title">Posted wholesale stock</h1>
              </div>
              <div className="wlp-stock-count"><strong>{publishedLots.length}</strong><span>live lot{publishedLots.length === 1 ? "" : "s"}</span></div>
            </div>
            <p className="wlp-stock-note">
              Only example lots published from the Stock Studio appear here.
              Regular shop products never enter this preview.
            </p>

            {demoError ? (
              <div className="wlp-empty is-error">
                <div className="wlp-empty-icon"><AlertTriangle aria-hidden="true" size={31} /></div>
                <div>
                  <p>LOCAL DEMO DATA UNAVAILABLE</p>
                  <h2>The customer preview is safely empty.</h2>
                  <span>{demoError}</span>
                </div>
              </div>
            ) : publishedLots.length ? (
              <div className="wlp-lots">
                {publishedLots.map((lot) => <WholesaleLotCard key={lot.id} lot={lot} />)}
              </div>
            ) : (
              <div className="wlp-empty">
                <div className="wlp-empty-icon"><PackageOpen aria-hidden="true" size={31} /></div>
                <div>
                  <p>NO LIVE WHOLESALE LOTS</p>
                  <h2>No wholesale stock is posted right now.</h2>
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

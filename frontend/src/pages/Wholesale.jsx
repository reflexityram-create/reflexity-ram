import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Loader2,
  Mail,
  PackageOpen,
  Plus,
  Settings2,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { wholesaleApi } from "@/lib/api";
import useAuthStore from "@/lib/authStore";
import { useSEO } from "@/lib/seo";
import { buildWholesaleEmailUrl, publishedWholesaleLots } from "@/lib/wholesaleLots";
import { formatStorePrice, STORE_CURRENCY_CODE } from "@/lib/currency";
import "@/pages/wholesale-concepts.css";

const WHOLESALE_GMAIL_URL = buildWholesaleEmailUrl();

function WholesaleLotCard({ badgeLabel, detailBasePath = "/wholesale", index = 0, lot }) {
  const isEcc = /\bECC\b/i.test(`${lot.title} ${lot.notes || ""}`);
  return (
    <Link
      aria-label={`View wholesale lot ${lot.title}`}
      className="glass card-hover rounded-xl overflow-hidden flex flex-col fade-up"
      data-testid={`wholesale-card-${lot.id}`}
      style={{ animationDelay: `${(index % 8) * 0.04}s` }}
      to={`${detailBasePath}/${encodeURIComponent(lot.id)}`}
    >
      <div className="relative aspect-[5/4] bg-gradient-to-b from-white/[0.03] to-transparent overflow-hidden">
        {lot.imageUrl ? (
          <img
            alt={lot.imageAlt || lot.title}
            className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform"
            decoding="async"
            fetchPriority={index < 3 ? "high" : "auto"}
            loading={index < 6 ? "eager" : "lazy"}
            src={lot.imageUrl}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><Cpu aria-hidden="true" className="text-neutral-700" size={36} /></div>
        )}
        <div className="absolute top-3 left-3 flex gap-1.5">
          <span className="pill text-[10px] py-1 px-2">{lot.generation}</span>
          <span className="pill text-[10px] py-1 px-2">{lot.formFactor}</span>
          {(lot.badgeLabel || badgeLabel) && <span className="pill pill-amber text-[10px] py-1 px-2">{lot.badgeLabel || badgeLabel}</span>}
        </div>
        <div className="absolute top-3 right-3">
          <span className="pill pill-accent text-[10px] py-1 px-2"><span className="dot dot-green" />{lot.quantityAvailable} available</span>
        </div>
        <div className="absolute bottom-3 left-3">
          <span className="pill text-[10px] py-1 px-2 bg-black/50 backdrop-blur-sm">🇨🇦 🇺🇸 CA &amp; US</span>
        </div>
      </div>
      <div className="p-5 flex flex-col flex-1">
        <div className="mono text-[10px] text-neutral-500 tracking-widest mb-2">{lot.mpn}</div>
        <h3 className="text-[15px] font-semibold tracking-tight text-white leading-snug mb-2">{lot.title}</h3>
        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className="pill text-[10px] py-0.5">{lot.capacityLabel}</span>
          <span className="pill text-[10px] py-0.5">{lot.speedLabel}</span>
          {lot.rank && <span className="pill text-[10px] py-0.5">{lot.rank}</span>}
          {isEcc && <span className="pill pill-accent text-[10px] py-0.5">ECC</span>}
        </div>
        <div className="mt-auto flex items-end gap-3">
          <div className="text-2xl font-bold tracking-tight">
            {lot.unitPriceCad ? formatStorePrice(lot.unitPriceCad) : "Request quote"}
            {lot.unitPriceCad && <span className="text-[10px] font-medium text-neutral-500"> {STORE_CURRENCY_CODE}</span>}
          </div>
          <div className="ml-auto mb-1 mono text-[10px] text-emerald-300 inline-flex items-center gap-1">View details <ArrowRight aria-hidden="true" size={13} /></div>
        </div>
      </div>
    </Link>
  );
}

function WholesaleInventory({
  lots,
  stockError,
  inventoryEyebrow,
  inventoryNote,
  errorEyebrow,
  errorTitle,
  badgeLabel,
  detailBasePath,
  adminControls,
  stockLoading,
}) {
  return (
    <section className="ws-inventory" aria-labelledby="wholesale-stock-title">
      <div className="ws-inventory-head">
        <div>
          <p>{inventoryEyebrow}</p>
          <h2 id="wholesale-stock-title">Posted wholesale stock</h2>
        </div>
        <div className="ws-inventory-tools">
          {adminControls}
          <div className="ws-stock-count"><strong>{lots.length}</strong><span>live lot{lots.length === 1 ? "" : "s"}</span></div>
        </div>
      </div>

      {inventoryNote && !stockError && <p className="ws-preview-note">{inventoryNote}</p>}

      {stockLoading ? (
        <div className="ws-empty is-loading" role="status">
          <div className="ws-empty-icon"><Loader2 aria-hidden="true" className="animate-spin" size={28} /></div>
          <div>
            <p>CHECKING LIVE INVENTORY</p>
            <h3>Loading posted stock.</h3>
            <span>Only published wholesale lots will appear here.</span>
          </div>
        </div>
      ) : stockError ? (
        <div className="ws-empty is-error" role="status">
          <div className="ws-empty-icon"><AlertTriangle aria-hidden="true" size={28} /></div>
          <div>
            <p>{errorEyebrow}</p>
            <h3>{errorTitle}</h3>
            <span>{stockError}</span>
          </div>
        </div>
      ) : lots.length ? (
        <div className="grid sm:grid-cols-2 gap-4 mt-6" data-testid="wholesale-grid">
          {lots.map((lot, index) => <WholesaleLotCard badgeLabel={badgeLabel} detailBasePath={detailBasePath} index={index} key={lot.id} lot={lot} />)}
        </div>
      ) : (
        <div className="ws-empty">
          <div className="ws-empty-icon"><PackageOpen aria-hidden="true" size={28} /></div>
          <div>
            <p>NO LIVE WHOLESALE LOTS</p>
            <h3>No stock is posted right now.</h3>
            <span>Send the exact requirement to the sourcing desk beside this inventory.</span>
          </div>
        </div>
      )}
    </section>
  );
}

export function WholesaleMarket({
  postedLots = [],
  stockError = null,
  badgeLabel = null,
  detailBasePath = "/wholesale",
  inventoryEyebrow = "AVAILABLE NOW",
  inventoryNote = null,
  errorEyebrow = "STOCK DATA UNAVAILABLE",
  errorTitle = "The stock list is safely empty.",
  adminControls = null,
  stockLoading = false,
  seoTitle = "Wholesale DDR4 & DDR5 RAM | Reflexity",
  seoDescription = "Browse posted wholesale RAM lots or send Reflexity an exact-SKU bulk sourcing request.",
}) {
  useSEO({
    title: seoTitle,
    description: seoDescription,
  });

  return (
    <div className="wholesale-simple-shell">
      <Header />
      <main className="wholesale-simple">
        <section className="ws-market">
          <div className="ws-glow" aria-hidden="true" />
          <div className="ws-grid-lines" aria-hidden="true" />
          <div className="ws-container">
            <header className="ws-market-head">
              <div>
                <p className="ws-eyebrow"><span /> REFLEXITY WHOLESALE</p>
                <h1>Wholesale RAM.<br /><em>Ready stock or sourced.</em></h1>
              </div>
              <div className="ws-market-intro">
                <p>Choose a verified posted lot, or send the exact part number and quantity you need.</p>
                <div className="ws-market-facts">
                  <span><ShieldCheck aria-hidden="true" size={15} /> Quote-confirmed inventory</span>
                  <span>Toronto · Domestic &amp; international</span>
                </div>
              </div>
            </header>

            <div className="ws-market-grid">
              <WholesaleInventory
                errorEyebrow={errorEyebrow}
                errorTitle={errorTitle}
                inventoryEyebrow={inventoryEyebrow}
                inventoryNote={inventoryNote}
                lots={postedLots}
                stockError={stockError}
                stockLoading={stockLoading}
                badgeLabel={badgeLabel}
                detailBasePath={detailBasePath}
                adminControls={adminControls}
              />

              <aside className="ws-coming" aria-labelledby="wholesale-desk-title">
                <div className="ws-coming-top">
                  <span>NEED A SPECIFIC SKU?</span>
                  <div>DIRECT SOURCING</div>
                </div>
                <div className="ws-coming-icon"><Mail aria-hidden="true" size={27} /></div>
                <h2 id="wholesale-desk-title">Tell us the SKU and quantity.</h2>
                <p>If it is not posted, send the exact requirement and we&apos;ll check sourcing.</p>
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
                <Link className="ws-sell-link" to="/liquidators">
                  <ShoppingBag aria-hidden="true" size={15} /> Selling stock to Reflexity?
                </Link>
              </aside>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default function Wholesale() {
  const user = useAuthStore((state) => state.user);
  const [inventory, setInventory] = useState({ lots: [], loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    wholesaleApi.list({ signal: controller.signal })
      .then(({ data }) => {
        if (!current) return;
        const received = Array.isArray(data?.lots) ? data.lots : [];
        const lots = publishedWholesaleLots(received).filter((lot) => lot.visibility === "public");
        setInventory({ lots, loading: false, error: null });
      })
      .catch((error) => {
        if (!current || error?.code === "ERR_CANCELED") return;
        setInventory({
          lots: [],
          loading: false,
          error: "Posted inventory could not be loaded. Send the exact SKU to our sourcing desk while we reconnect.",
        });
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, []);

  const adminControls = user?.role === "admin" ? (
    <div className="ws-admin-actions" aria-label="Wholesale admin actions">
      <Link to="/admin/wholesale"><Settings2 aria-hidden="true" size={13} /> Manage</Link>
      <Link className="is-primary" to="/admin/wholesale?new=1"><Plus aria-hidden="true" size={13} /> Add listing</Link>
    </div>
  ) : null;

  return (
    <WholesaleMarket
      adminControls={adminControls}
      postedLots={inventory.lots}
      stockError={inventory.error}
      stockLoading={inventory.loading}
    />
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Cpu,
  PackageOpen,
  Plus,
  Settings2,
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmptyState from "@/components/EmptyState";
import SectionLabel from "@/components/SectionLabel";
import { wholesaleApi } from "@/lib/api";
import useAuthStore from "@/lib/authStore";
import { useSEO } from "@/lib/seo";
import { buildWholesaleEmailUrl, publishedWholesaleLots } from "@/lib/wholesaleLots";
import { formatStorePrice, STORE_CURRENCY_CODE } from "@/lib/currency";
import { imageSrcSet, imageUrl } from "@/lib/imageUrl";

// Built from the same parts as the rest of the shop (2026-11-17): section label, display heading, glass boxes,
// pill buttons and the shop's product-card layout. No page-only fonts, colours, grid lines or glows.

const WHOLESALE_GMAIL_URL = buildWholesaleEmailUrl();

const SOURCING_CHECKLIST = [
  "Part number and exact specification",
  "Quantity and condition preference",
  "Destination and required date",
];

function WholesaleLotCard({ badgeLabel, detailBasePath = "/wholesale", index = 0, lot }) {
  const isEcc = /\bECC\b/i.test(`${lot.title} ${lot.notes || ""}`);
  const priorityImage = index < 3;
  const badge = lot.badgeLabel || badgeLabel;
  const specs = [lot.generation, lot.formFactor, lot.capacityLabel, lot.speedLabel, lot.rank, isEcc ? "ECC" : null].filter(Boolean);
  return (
    <Link
      aria-label={`View wholesale lot ${lot.title}`}
      className="glass card-hover rounded-xl overflow-hidden flex flex-col fade-up"
      data-testid={`wholesale-card-${lot.id}`}
      style={{ animationDelay: `${(index % 8) * 0.04}s` }}
      to={`${detailBasePath}/${encodeURIComponent(lot.id)}`}
    >
      <div className="relative aspect-[2/1] bg-white overflow-hidden px-3 py-4 sm:px-5 sm:py-5">
        {lot.imageUrl ? (
          <img
            alt={lot.imageAlt || lot.title}
            className="w-full h-full object-contain"
            decoding="async"
            fetchPriority={priorityImage ? "high" : "auto"}
            loading={priorityImage ? "eager" : "lazy"}
            sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw"
            src={imageUrl(lot.imageUrl, { width: 640, trim: true })}
            srcSet={imageSrcSet(lot.imageUrl, undefined, { trim: true })}
            width="960"
            height="300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><Cpu aria-hidden="true" className="text-neutral-400" size={32} /></div>
        )}
        {badge && <span className="pill pill-amber pill-on-photo absolute top-3 left-3 text-[10px] py-1 px-2">{badge}</span>}
      </div>
      <div className="p-4 flex flex-col flex-1">
        <div className="mono text-[10px] text-neutral-500 tracking-widest uppercase mb-1.5">{specs.join(" · ")}</div>
        <h3 className="text-[15px] font-semibold tracking-tight text-white leading-snug line-clamp-2 mb-1">{lot.title}</h3>
        <div className="mono text-[10px] text-neutral-500 mb-3 break-all">{lot.mpn}</div>
        <div className="mt-auto text-xl font-bold tracking-tight">
          {lot.unitPriceCad ? formatStorePrice(lot.unitPriceCad) : "Request quote"}
          {lot.unitPriceCad && <span className="text-[10px] font-medium text-neutral-500"> {STORE_CURRENCY_CODE}</span>}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-neutral-500">
          <span className="inline-flex items-center gap-1.5"><span className="dot dot-green" />{lot.quantityAvailable} available</span>
          <span className="inline-flex items-center gap-1">View details <ArrowRight aria-hidden="true" size={13} /></span>
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
    <section className="min-w-0 flex flex-col" aria-labelledby="wholesale-stock-title">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          {inventoryEyebrow && <div className="section-label mb-2">{inventoryEyebrow}</div>}
          <h2 id="wholesale-stock-title" className="text-xl sm:text-2xl font-semibold tracking-tight">Posted lots</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {adminControls}
          {!stockLoading && !stockError && lots.length > 0 && (
            <span className="pill" data-testid="wholesale-lot-count">{lots.length} live lot{lots.length === 1 ? "" : "s"}</span>
          )}
        </div>
      </div>

      {inventoryNote && !stockError && <p className="text-[13px] text-neutral-500 leading-relaxed mb-4 max-w-2xl">{inventoryNote}</p>}

      {stockLoading ? (
        <div className="skeleton rounded-2xl flex-1 min-h-[240px]" role="status" aria-label="Loading posted lots" />
      ) : stockError ? (
        <EmptyState
          as="h3"
          className="flex-1 justify-center max-sm:!px-6 max-sm:!py-9"
          description={stockError}
          eyebrow={errorEyebrow}
          icon={AlertTriangle}
          role="status"
          testId="wholesale-error"
          title={errorTitle}
        />
      ) : lots.length ? (
        <div className="grid sm:grid-cols-2 gap-3 sm:gap-4" data-testid="wholesale-grid">
          {lots.map((lot, index) => <WholesaleLotCard badgeLabel={badgeLabel} detailBasePath={detailBasePath} index={index} key={lot.id} lot={lot} />)}
        </div>
      ) : (
        <EmptyState
          as="h3"
          className="flex-1 justify-center max-sm:!px-6 max-sm:!py-9"
          description="Send the exact part number and quantity, and we'll check sourcing."
          icon={PackageOpen}
          testId="wholesale-empty"
          title="No lots posted right now"
        />
      )}
    </section>
  );
}

export function WholesaleMarket({
  postedLots = [],
  stockError = null,
  badgeLabel = null,
  detailBasePath = "/wholesale",
  inventoryEyebrow = null,
  inventoryNote = null,
  errorEyebrow = null,
  errorTitle = "Posted lots couldn't load",
  adminControls = null,
  stockLoading = false,
  seoTitle = "Wholesale DDR4 & DDR5 RAM | Reflexity",
  seoDescription = "Browse posted wholesale RAM lots or send Reflexity an exact-SKU bulk sourcing request.",
}) {
  useSEO({
    title: seoTitle,
    description: seoDescription,
  });

  // With lots posted the sourcing box stays put beside a long list; with none, the two boxes share one height.
  const hasLots = !stockLoading && !stockError && postedLots.length > 0;

  return (
    <>
      <Header />
      <main className="page" data-testid="wholesale-page">
        <div className="container-tight pt-12 pb-16">
          <SectionLabel num="02">Wholesale</SectionLabel>
          <h1 className="display-2 display-grad mt-4 mb-4">Wholesale RAM</h1>
          <p className="text-neutral-400 max-w-2xl leading-relaxed">
            Choose a posted lot, or send the exact part number and quantity you need. Ships from Toronto to Canada and abroad.
          </p>

          <div className={`mt-12 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] ${hasLots ? "items-start" : "items-stretch"}`}>
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

            <aside
              className={`glass rounded-2xl p-6 md:p-7 flex flex-col ${hasLots ? "lg:sticky lg:top-20" : ""}`}
              aria-labelledby="wholesale-desk-title"
              data-testid="wholesale-sourcing"
            >
              <div className="mono text-[10px] text-neutral-500 tracking-widest">NEED A SPECIFIC SKU?</div>
              <h2 id="wholesale-desk-title" className="mt-3 text-xl font-semibold tracking-tight">Tell us the SKU and quantity.</h2>
              <p className="mt-2 text-[14px] text-neutral-400 leading-relaxed">
                If it is not posted, send the exact requirement and we&apos;ll check sourcing.
              </p>
              <ul className="mt-5 flex flex-col gap-2.5 text-[13px]" style={{ color: "var(--fg-muted)" }}>
                {SOURCING_CHECKLIST.map((item) => (
                  <li key={item} className="inline-flex items-center gap-2">
                    <Check aria-hidden="true" size={14} style={{ color: "var(--brand-yellow-deep)" }} /> {item}
                  </li>
                ))}
              </ul>
              <a
                className="btn-primary mt-6 w-full"
                href={WHOLESALE_GMAIL_URL}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="wholesale-quote-btn"
              >
                Get bulk pricing <ArrowRight aria-hidden="true" size={15} />
              </a>
              <Link
                className="mt-4 self-center min-h-11 inline-flex items-center text-[13px] underline underline-offset-4"
                style={{ color: "var(--fg-muted)" }}
                to="/liquidators"
              >
                Selling stock to Reflexity?
              </Link>
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </>
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
          error: "Try again in a moment, or send the exact SKU and quantity for a quote.",
        });
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, []);

  const adminControls = user?.role === "admin" ? (
    <div className="flex items-center gap-2" aria-label="Wholesale admin actions">
      <Link className="btn-secondary !py-2 !px-3 text-[12px]" to="/admin/products#wholesale"><Settings2 aria-hidden="true" size={13} /> Manage</Link>
      <Link className="btn-primary !py-2 !px-3 text-[12px]" to="/admin/products?newLot=1#wholesale"><Plus aria-hidden="true" size={13} /> Add listing</Link>
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

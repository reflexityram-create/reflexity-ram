import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, ChevronLeft, Cpu, Loader2, Mail, Package, Shield, Truck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { wholesaleApi } from "@/lib/api";
import { useSEO } from "@/lib/seo";
import { buildWholesaleEmailUrl, publishedWholesaleLots } from "@/lib/wholesaleLots";
import { formatStorePrice, STORE_CURRENCY_CODE } from "@/lib/currency";

function LotUnavailable({ loading }) {
  return (
    <div className="glass rounded-2xl p-8 min-h-[260px] flex items-center gap-5" role="status">
      {loading ? <Loader2 aria-hidden="true" className="animate-spin text-neutral-500" size={30} /> : <Package aria-hidden="true" className="text-neutral-500" size={30} />}
      <div>
        <div className="mono text-[10px] text-neutral-500 tracking-widest mb-2">{loading ? "CHECKING LIVE INVENTORY" : "LOT UNAVAILABLE"}</div>
        <h1 className="text-2xl font-bold tracking-tight mb-3">{loading ? "Loading lot details." : "This wholesale lot is not currently posted."}</h1>
        {!loading && <Link className="text-[13px] text-neutral-400 hover:text-white underline underline-offset-4" to="/wholesale">Back to wholesale stock</Link>}
      </div>
    </div>
  );
}

export function WholesaleLotDetail({ lot }) {
  const minimum = Math.max(1, Number(lot.minimumOrderQuantity) || 1);
  const isEcc = /\bECC\b/i.test(`${lot.title} ${lot.notes || ""}`);
  const specifications = [
    ["Brand", lot.brand],
    ["Manufacturer part number", lot.mpn],
    ["Generation", lot.generation],
    ["Form factor", lot.formFactor],
    ["Capacity", lot.capacityLabel],
    ["Speed", lot.speedLabel],
    ["Rank", lot.rank],
    ["ECC", isEcc ? "Yes" : "Not specified"],
    ["Condition", lot.condition],
    ["Testing", lot.testStatus],
    ["Warranty", lot.warranty],
    ["Ships from", lot.shipFrom],
  ].filter(([, value]) => value);

  useSEO({
    title: `${lot.title} | Reflexity Wholesale`,
    description: lot.notes || `${lot.title}. ${lot.quantityAvailable} units available from Toronto.`,
  });

  return (
    <>
      <Link className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 hover:text-white mb-6" to="/wholesale">
        <ChevronLeft aria-hidden="true" size={14} /> Back to wholesale
      </Link>

      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-14">
        <div>
          <div className="block w-full glass rounded-2xl overflow-hidden aspect-[5/4] mb-3">
            {lot.imageUrl ? (
              <img alt={lot.imageAlt || lot.title} className="w-full h-full object-cover" src={lot.imageUrl} />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><Cpu aria-hidden="true" className="text-neutral-700" size={48} /></div>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="mono text-[11px] text-neutral-500 tracking-widest">{lot.mpn}</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-3">{lot.title}</h1>
          <div className="text-[13px] text-neutral-500 mb-5">Wholesale lot · {lot.lotCode || "Live inventory"}</div>

          <div className="flex flex-wrap gap-1.5 mb-6">
            <span className="pill">{lot.generation}</span>
            <span className="pill">{lot.formFactor}</span>
            <span className="pill">{lot.capacityLabel}</span>
            <span className="pill">{lot.speedLabel}</span>
            {lot.rank && <span className="pill">{lot.rank}</span>}
            {isEcc && <span className="pill pill-accent">ECC</span>}
          </div>

          <div className="flex items-end gap-3 mb-2">
            <div className="text-4xl font-bold tracking-tight">
              {lot.unitPriceCad ? formatStorePrice(lot.unitPriceCad) : "Request quote"}
              {lot.unitPriceCad && <span className="text-sm font-medium text-neutral-500"> {STORE_CURRENCY_CODE}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3 mb-6">
            <span className="pill pill-accent"><span className="dot dot-green" />{lot.quantityAvailable} available</span>
            <span className="mono text-[11px] text-neutral-500">MOQ: {minimum} · Step: {Math.max(1, Number(lot.orderIncrement) || 1)}</span>
          </div>

          <a className="btn-primary w-full sm:w-auto mb-5" href={buildWholesaleEmailUrl([{ lot, quantity: minimum }])} rel="noopener noreferrer" target="_blank">
            <Mail aria-hidden="true" size={15} /> Request this lot <ArrowRight aria-hidden="true" size={15} />
          </a>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-4 text-[12px] text-neutral-600 dark:text-neutral-400">
            {[lot.testStatus, `${lot.warranty} warranty`, `Ships from ${lot.shipFrom}`].map((item) => (
              <span className="inline-flex items-center gap-1.5" key={item}><span className="text-emerald-600 dark:text-emerald-400">✓</span>{item}</span>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <div className="glass-soft rounded-xl p-4 flex items-start gap-3">
              <Truck aria-hidden="true" className="text-neutral-300 mt-0.5 shrink-0" size={18} />
              <div><div className="text-[13px] font-medium">Wholesale shipping</div><div className="text-[12px] text-neutral-500">Quote-confirmed · ESD-safe · tracked</div></div>
            </div>
            <div className="glass-soft rounded-xl p-4 flex items-start gap-3">
              <Shield aria-hidden="true" className="text-neutral-300 mt-0.5 shrink-0" size={18} />
              <div><div className="text-[13px] font-medium">{lot.warranty}</div><div className="text-[12px] text-neutral-500">Defect-replacement coverage</div></div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-16 border-t border-white/5 pt-10">
        <div className="flex flex-wrap gap-1 mb-6"><span className="tab-pill" data-active="true">Specifications</span><span className="tab-pill">Lot notes</span></div>
        <div className="glass rounded-2xl p-6 md:p-8">
          <div className="grid lg:grid-cols-[1.2fr_.8fr] gap-8">
            <div>
              <h2 className="text-lg font-semibold tracking-tight mb-4">Specifications</h2>
              <dl className="divide-y divide-white/5">
                {specifications.map(([label, value]) => <div className="grid grid-cols-[minmax(120px,160px)_1fr] gap-4 py-2.5 text-[13.5px]" key={label}><dt className="text-neutral-500">{label}</dt><dd>{value}</dd></div>)}
              </dl>
            </div>
            <div className="glass-soft rounded-xl p-5 h-fit">
              <div className="mono text-[10px] text-neutral-500 tracking-widest mb-3">LOT NOTES</div>
              <p className="text-[13.5px] text-neutral-300 leading-relaxed">{lot.notes || "Contact Reflexity with the exact part number and quantity for matching and delivery details."}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function WholesaleLot() {
  const { lotId } = useParams();
  const [state, setState] = useState({ lot: null, loading: true });

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    wholesaleApi.list({ signal: controller.signal })
      .then(({ data }) => {
        if (!current) return;
        const lots = publishedWholesaleLots(Array.isArray(data?.lots) ? data.lots : []).filter((lot) => lot.visibility === "public");
        setState({ lot: lots.find((lot) => lot.id === lotId) || null, loading: false });
      })
      .catch((error) => {
        if (current && error?.code !== "ERR_CANCELED") setState({ lot: null, loading: false });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [lotId]);

  return (
    <>
      <Header />
      <main className="page pb-16" data-testid="wholesale-detail-page">
        <div className="container-tight pt-8">{state.lot ? <WholesaleLotDetail lot={state.lot} /> : <LotUnavailable loading={state.loading} />}</div>
      </main>
      <Footer />
    </>
  );
}

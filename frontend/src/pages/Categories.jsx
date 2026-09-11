import { Link } from "react-router-dom";
import { ArrowRight, Mail } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { RAM_CATEGORIES } from "@/lib/catalog";
import { useSEO } from "@/lib/seo";

/* ── Custom hardware-oriented SVG icons ──────────────────────────────── */

function DesktopIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* DIMM module — upright stick */}
      <rect x="8" y="6" width="24" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" />
      {/* PCB edge connector notch */}
      <rect x="14" y="24" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      {/* Memory chips — 3 chips on the module face */}
      <rect x="11" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="18" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="25" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      {/* Second row of chips */}
      <rect x="11" y="16" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="18" y="16" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="25" y="16" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      {/* Retention clip top */}
      <path d="M8 8 L6 8 L6 14 L8 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M32 8 L34 8 L34 14 L32 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {/* Label line */}
      <line x1="11" y1="32" x2="29" y2="32" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity="0.4" />
    </svg>
  );
}

function LaptopIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* SO-DIMM — horizontal, shorter and wider */}
      <rect x="5" y="12" width="30" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      {/* Edge connector notch (bottom center) */}
      <rect x="15" y="24" width="10" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
      {/* Memory chips — compact horizontal row */}
      <rect x="8" y="15" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="14.5" y="15" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="21" y="15" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="27.5" y="15" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      {/* Retention clips on sides */}
      <path d="M5 14 L3 14 L3 20 L5 20" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M35 14 L37 14 L37 20 L35 20" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {/* Label line */}
      <line x1="8" y1="30" x2="32" y2="30" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity="0.4" />
    </svg>
  );
}

function ServerIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* RDIMM — tall module with heat spreader profile */}
      <rect x="7" y="5" width="26" height="22" rx="2" stroke="currentColor" strokeWidth="1.5" />
      {/* Edge connector */}
      <rect x="13" y="25" width="14" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      {/* Heat spreader fins (top edge) */}
      <line x1="11" y1="5" x2="11" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="15" y1="5" x2="15" y2="2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="19" y1="5" x2="19" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="23" y1="5" x2="23" y2="2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="27" y1="5" x2="27" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* Memory chips — 3 rows */}
      <rect x="10" y="8" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="17.5" y="8" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="25" y="8" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="10" y="14" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="17.5" y="14" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="25" y="14" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      {/* Register chip (ECC register — small chip center bottom) */}
      <rect x="16" y="20" width="8" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
      {/* Retention clips */}
      <path d="M7 7 L5 7 L5 15 L7 15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M33 7 L35 7 L35 15 L33 15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {/* ECC label dot */}
      <circle cx="20" cy="32" r="1.5" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/* ── Category definitions ─────────────────────────────────────────── */

const CATEGORIES = [
  {
    id: "server",
    title: "Server RAM",
    description: "Tested enterprise memory, including individual modules and small lots.",
    badge: "SERVER MEMORY · DDR4 · DDR5",
    to: RAM_CATEGORIES.server.href,
    Icon: ServerIcon,
    glow: "rgba(200, 140, 80, 0.07)",
  },
];

/* ── Component ────────────────────────────────────────────────────── */

export default function Categories() {
  useSEO({
    title: "Shop RAM — Reflexity RAM",
    description:
      "Browse tested Server memory from Reflexity RAM.",
  });

  return (
    <>
      <Header />
      <main className="page" data-testid="categories-page">
        <div className="container-tight py-14 md:py-20">

          {/* Page header */}
          <div className="mb-12 border-b border-white/5 pb-8">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Shop RAM
            </h1>
            <p className="text-neutral-400 text-[14px] mt-2">
              Select a category to browse available stock.
            </p>
          </div>

          {/* Server-memory category grid */}
          <div
            className="grid grid-cols-1 gap-5"
            data-testid="categories-grid"
          >
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.id}
                to={cat.to}
                className="group relative border border-white/8 rounded-2xl p-7 flex flex-col gap-5 overflow-hidden
                           hover:border-white/20 transition-all duration-300
                           hover:shadow-[0_0_30px_0px_var(--cat-glow)]"
                style={{ "--cat-glow": cat.glow }}
                data-testid={`category-card-${cat.id}`}
              >
                {/* Subtle inner glow on hover */}
                <div
                  className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl"
                  style={{
                    background: `radial-gradient(ellipse 80% 60% at 30% 30%, ${cat.glow}, transparent 70%)`,
                  }}
                />

                {/* Icon */}
                <div
                  className="relative w-12 h-12 rounded-xl border border-white/10 flex items-center justify-center
                             text-neutral-500 group-hover:text-neutral-200 group-hover:border-white/20
                             transition-all duration-300 bg-white/[0.02] group-hover:bg-white/[0.05]"
                >
                  <cat.Icon />
                </div>

                {/* Text */}
                <div className="relative flex-1 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-[16px] font-semibold tracking-tight text-neutral-100 group-hover:text-white transition-colors duration-200">
                      {cat.title}
                    </h2>
                    <ArrowRight
                      size={15}
                      className="shrink-0 text-neutral-600 group-hover:text-neutral-300 group-hover:translate-x-0.5 transition-all duration-200"
                    />
                  </div>
                  <p className="text-[13px] text-neutral-500 leading-relaxed group-hover:text-neutral-400 transition-colors duration-200">
                    {cat.description}
                  </p>
                </div>

                {/* Badge */}
                <span className="relative inline-block font-mono text-[10px] text-neutral-600 border border-white/8 rounded-md px-2 py-1 self-start group-hover:border-white/14 group-hover:text-neutral-500 transition-all duration-200">
                  {cat.badge}
                </span>
              </Link>
            ))}
          </div>

          {/* Wholesale / custom inquiry */}
          <div className="mt-10 border border-white/8 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center gap-4 hover:border-white/14 transition-colors duration-300">
            <div className="flex-1">
              <div className="text-[14px] font-semibold mb-1">
                Need a specific part number?
              </div>
              <div className="text-[13px] text-neutral-500">
                Wholesale orders, server pulls, or QVL-matched kits — email us and we'll source it.
              </div>
            </div>
            <a
              href="https://mail.google.com/mail/u/0/?fs=1&to=reflexityram@gmail.com&su=Reflexity+RAM+%E2%80%94+Inquiry&tf=cm"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary shrink-0 text-[13px] inline-flex items-center gap-2 transition-all duration-200 hover:scale-[1.02]"
            >
              <Mail size={14} />
              Email to inquire
            </a>
          </div>

        </div>
      </main>
      <Footer />
    </>
  );
}

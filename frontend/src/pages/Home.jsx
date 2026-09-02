import { Link } from "react-router-dom";
import { Server, Laptop, Monitor, ArrowRight } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ProductCard from "@/components/ProductCard";
import { RAM_CATEGORIES } from "@/lib/catalog";
import { useSEO } from "@/lib/seo";
import { useStock } from "@/lib/useStock";

/**
 * Storefront home — "What are you building?".
 * Server memory gets the wide, primary tile since it is the main stock;
 * laptop and desktop sit beside it. Featured stock sits underneath.
 */
const LANES = [
  {
    icon: Server,
    title: "Server memory",
    sub: "RDIMM · LRDIMM · ECC",
    body: "Registered DDR4 server pulls, tested and ECC-verified.",
    to: RAM_CATEGORIES.server.href,
    primary: true,
  },
  {
    icon: Laptop,
    title: "Laptop",
    sub: "SO-DIMM",
    body: "DDR4 and DDR5 laptop sticks.",
    to: RAM_CATEGORIES.laptop.href,
  },
  {
    icon: Monitor,
    title: "Desktop",
    sub: "UDIMM",
    body: "Standard desktop memory.",
    to: RAM_CATEGORIES.desktop.href,
  },
];

export default function Home() {
  useSEO({
    title: "Server & Laptop RAM in Canada — Tested DDR4 & DDR5",
    description:
      "Pick your build: server RDIMM/LRDIMM, laptop SO-DIMM, or desktop UDIMM. Tested memory shipped from Toronto.",
  });
  const { loading, products } = useStock(6);

  return (
    <>
      <Header />
      <main className="page" data-testid="home-page">
        <section className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="container-tight pt-14 pb-12">
            <div className="section-label mb-5">
              <span className="num">01</span> WHAT ARE YOU BUILDING?
            </div>
            <h1 className="display-2 max-w-[17ch] mb-9">
              Memory that's been <span className="hl">tested first.</span>
            </h1>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
              {LANES.map(({ icon: Icon, title, sub, body, to, primary }) => (
                <Link
                  key={title}
                  to={to}
                  className="glass card-hover rounded-xl p-6 flex flex-col"
                  style={{
                    textDecoration: "none",
                    gridColumn: primary ? "span 2" : undefined,
                    borderTop: primary ? "3px solid var(--brand-yellow)" : undefined,
                  }}
                >
                  <Icon
                    size={primary ? 30 : 24}
                    style={{ color: primary ? "var(--brand-yellow-deep)" : "var(--fg-muted)" }}
                  />
                  <div className="mt-4 font-semibold" style={{ fontSize: primary ? 21 : 17 }}>
                    {title}
                  </div>
                  <div className="mono text-[11px] mt-1" style={{ color: "var(--fg-faint)" }}>
                    {sub}
                  </div>
                  <p className="text-[14px] mt-3 flex-1" style={{ color: "var(--fg-muted)" }}>
                    {body}
                  </p>
                  <span
                    className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium"
                    style={{ color: "var(--fg)" }}
                  >
                    Browse <ArrowRight size={14} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="container-tight pt-16 pb-14">
            <div className="section-label mb-6">
              <span className="num">02</span> FEATURED STOCK
            </div>
            {loading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 320 }} />
                ))}
              </div>
            ) : products.length === 0 ? (
              <p style={{ color: "var(--fg-muted)" }}>
                Nothing listed right now — <Link to="/support" className="underline">email us</Link> for current stock.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {products.map((p, i) => (
                  <ProductCard key={p._id} p={p} index={i} priority={i < 3} />
                ))}
              </div>
            )}

            <div className="callout-brand mt-14 rounded-xl px-6 py-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="callout-title font-semibold">Buying in volume?</div>
                <div className="callout-body text-[14px]">
                  We do wholesale on server pulls — tell us the SKU and quantity.
                </div>
              </div>
              <Link to="/wholesale" className="btn-primary">Get bulk pricing</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Inbox } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ProductCard from "@/components/ProductCard";
import EmptyState from "@/components/EmptyState";
import { productsApi } from "@/lib/api";
import { fetchAllCatalogProducts, isPublicServerRam } from "@/lib/catalog";
import { useSEO } from "@/lib/seo";

export default function Shop() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useSEO({
    title: "Server RAM — Reflexity RAM",
    description: "Shop tested Server RAM at Reflexity RAM.",
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);
    fetchAllCatalogProducts(
      ({ page, limit, signal }) => productsApi.list(
        { page, limit, sort: "createdAt", order: "desc" },
        { signal },
      ),
      { signal: controller.signal },
    )
      .then((catalogProducts) => {
        if (active) setProducts(catalogProducts);
      })
      .catch((requestError) => {
        if (active && requestError?.name !== "AbortError" && requestError?.code !== "ERR_CANCELED") {
          setError("Failed to load products. Please refresh.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const publicProducts = products.filter(isPublicServerRam);

  return (
    <>
      <Header />
      <main className="page" data-testid="shop-page">
        <div className="container-tight pt-10 pb-16">
          <Link
            to="/categories"
            className="inline-flex items-center gap-1.5 text-[13px] text-neutral-500 hover:text-white transition-colors mb-6"
            data-testid="shop-back-to-categories"
          >
            <ArrowLeft size={13} /> All categories
          </Link>

          <div className="mb-8 pb-6 border-b border-white/5">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Server RAM</h1>
            <p className="text-[13px] text-neutral-500 mt-1.5">
              {loading ? "Loading…" : `${publicProducts.length} ${publicProducts.length === 1 ? "product" : "products"} available`}
            </p>
          </div>

          {loading ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="shop-loading">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="border border-white/8 rounded-xl overflow-hidden">
                  <div className="skeleton aspect-[5/4]" />
                  <div className="p-5 space-y-3">
                    <div className="skeleton h-3 w-1/3" />
                    <div className="skeleton h-4 w-4/5" />
                    <div className="skeleton h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <EmptyState
              icon={Inbox}
              title="Could not load products"
              description={error}
              ctaLabel="Refresh"
              ctaTo="/shop"
              testId="shop-error-state"
            />
          ) : publicProducts.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No products in this category yet"
              description="Check back soon or contact us to source a specific part."
              ctaLabel="Back to categories"
              ctaTo="/categories"
              secondaryLabel="Email us"
              secondaryTo="/support"
              testId="shop-empty-state"
            />
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="shop-grid">
              {publicProducts.map((p, i) => (
                <ProductCard key={p.slug} p={p} index={i} priority={i < 3} />
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ProductCard from "@/components/ProductCard";
import { productsApi } from "@/lib/api";
import { fetchAllCatalogProducts } from "@/lib/catalog";
import { productMatchesShopFilters, readShopFilters, setShopFilterParam } from "@/lib/shopFilters";
import { useSEO } from "@/lib/seo";

export default function Shop() {
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState([]); const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false);
  const filters = useMemo(() => readShopFilters(params), [params]);
  const activeFilterLabels = useMemo(() => [
    ...filters.lines, ...filters.generations, ...filters.formFactors,
    ...filters.capacities.map((capacity) => `${capacity}GB`), ...filters.conditions,
    ...(filters.eccOnly ? ["ECC"] : []),
  ], [filters]);
  useSEO({ title: "Wholesale Inventory", description: "Browse Reflexity's quote-only catalog of server RAM, ECC memory, desktop memory, laptop memory, and related IT hardware." });
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setFailed(false);
    fetchAllCatalogProducts(({ page, limit, signal }) => productsApi.list({ page, limit, sort: "createdAt", order: "desc" }, { signal }), { signal: controller.signal })
      .then((nextProducts) => { if (!active) return; setProducts(nextProducts); })
      .catch((error) => {
        if (!active || controller.signal.aborted || error?.code === "ERR_CANCELED" || error?.name === "CanceledError" || error?.name === "AbortError") return;
        setFailed(true);
      })
      .finally(() => { if (!active) return; setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, []);
  const filtered = useMemo(() => products.filter((product) => productMatchesShopFilters(product, filters)), [products, filters]);
  const updateQuery = (event) => setParams((current) => setShopFilterParam(current, "q", event.target.value));
  return <><Header /><main className="page"><section className="container-tight inventory-page"><div className="page-intro"><p className="mono">REFLEXITY / INVENTORY CATALOG</p><h1>Hardware lots, specs first.</h1><p>Posted inventory is a starting point for a B2B quote. Availability, shipping, condition, and all commercial terms are confirmed per lot.</p></div><div className="inventory-toolbar"><label><Search size={15} /><span className="sr-only">Filter inventory</span><input value={filters.query} onChange={updateQuery} placeholder="Search part number, capacity, DDR generation…" /></label><Link className="btn-primary" to="/contact?intent=buy&productType=RAM">Request availability</Link></div>{activeFilterLabels.length > 0 && <div className="inventory-filter-summary" aria-live="polite"><span className="mono">FILTERED BY</span>{activeFilterLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}<Link to="/inventory">Clear filters</Link></div>}{loading ? <p className="catalog-status" role="status">Loading inventory…</p> : failed ? <div className="catalog-status" role="alert">Inventory could not be loaded. <Link to="/contact?intent=buy&productType=RAM">Send your requirements</Link>.</div> : filtered.length ? <div className="inventory-grid" data-testid="inventory-grid">{filtered.map((product, index) => <ProductCard key={product.slug} p={product} index={index} priority={index < 3} />)}</div> : <div className="catalog-status">No catalog item matches that search. <Link to="/contact?intent=buy&productType=RAM">Request a specific part</Link>.</div>}</section></main><Footer /></>;
}

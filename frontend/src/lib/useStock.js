import { useEffect, useState } from "react";
import { productsApi } from "@/lib/api";
import { fetchAllCatalogProducts, publicServerStock } from "@/lib/catalog";

/**
 * Shared stock loader for the landing-page variants.
 * Splits live inventory into server memory (the lead line) and everything else.
 */
export function useStock(limit = 12) {
  const [stock, setStock] = useState({ catalog: [], products: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchAllCatalogProducts(
      ({ page, limit: pageSize }) => productsApi.list({ page, limit: pageSize }),
    )
      .then((r) => {
        if (!alive) return;
        setStock(publicServerStock(r, limit));
      })
      .catch(() => alive && setStock({ catalog: [], products: [] }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [limit]);

  return {
    loading,
    products: stock.products,
    // Every public server listing, for pickers that must not be limited to the few newest (home exact parts).
    catalog: stock.catalog,
    server: stock.products,
    consumer: [],
  };
}

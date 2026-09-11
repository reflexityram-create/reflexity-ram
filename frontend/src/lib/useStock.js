import { useEffect, useState } from "react";
import { productsApi } from "@/lib/api";
import { fetchAllCatalogProducts, isPublicServerRam } from "@/lib/catalog";

/**
 * Shared stock loader for the landing-page variants.
 * Splits live inventory into server memory (the lead line) and everything else.
 */
export function useStock(limit = 12) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchAllCatalogProducts(
      ({ page, limit: pageSize }) => productsApi.list({ page, limit: pageSize }),
    )
      .then((r) => {
        if (!alive) return;
        setProducts(r.filter(isPublicServerRam).slice(0, limit));
      })
      .catch(() => alive && setProducts([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [limit]);

  return {
    loading,
    products,
    server: products,
    consumer: [],
  };
}

import { useEffect, useState } from "react";
import { productsApi } from "@/lib/api";

/**
 * Shared stock loader for the landing-page variants.
 * Splits live inventory into server memory (the lead line) and everything else.
 */
export function useStock(limit = 12) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    productsApi
      .list({ limit })
      .then((r) => {
        if (!alive) return;
        setProducts(r.data?.products || []);
      })
      .catch(() => alive && setProducts([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [limit]);

  const isServer = (p) =>
    p.line === "Server" || ["RDIMM", "LRDIMM"].includes(p.formFactor);

  return {
    loading,
    products,
    server: products.filter(isServer),
    consumer: products.filter((p) => !isServer(p)),
  };
}

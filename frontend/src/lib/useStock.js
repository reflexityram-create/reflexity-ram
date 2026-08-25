import { useEffect, useState } from "react";
import { productsApi } from "@/lib/api";

/**
 * Shared stock loader for the landing-page variants.
 * Splits live inventory into server memory (the lead line) and everything else.
 */
export function useStock(limit = 12) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    productsApi
      .list({ limit })
      .then((r) => {
        if (!alive) return;
        setProducts(r.data?.products || []);
      })
      .catch(() => {
        if (!alive) return;
        setProducts([]);
        setError(true);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [limit]);

  const isServer = (p) =>
    p.line === "Server" || ["RDIMM", "LRDIMM"].includes(p.formFactor);

  return {
    error,
    loading,
    products,
    server: products.filter(isServer),
    consumer: products.filter((p) => !isServer(p)),
  };
}

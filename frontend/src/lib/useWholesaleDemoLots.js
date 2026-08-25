import { useCallback, useEffect, useState } from "react";
import {
  WHOLESALE_DEMO_EVENT,
  WHOLESALE_DEMO_STORAGE_KEY,
  readWholesaleDemoState,
  restoreWholesaleDemoExamples,
  writeWholesaleDemoLots,
} from "@/lib/wholesaleDemoStore";

export function useWholesaleDemoLots() {
  const [state, setState] = useState(() => readWholesaleDemoState());

  const refresh = useCallback(() => setState(readWholesaleDemoState()), []);

  useEffect(() => {
    const onStorage = (event) => {
      if (!event || event.key === WHOLESALE_DEMO_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(WHOLESALE_DEMO_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(WHOLESALE_DEMO_EVENT, refresh);
    };
  }, [refresh]);

  const saveLots = useCallback((nextLots) => {
    try {
      const lots = writeWholesaleDemoLots(nextLots);
      setState({ lots, error: null, seeded: false });
      return true;
    } catch {
      setState((current) => ({ ...current, error: "That change could not be saved in this browser." }));
      return false;
    }
  }, []);

  const restoreExamples = useCallback(() => {
    try {
      const lots = restoreWholesaleDemoExamples();
      setState({ lots, error: null, seeded: true });
      return true;
    } catch {
      setState((current) => ({ ...current, error: "The demo examples could not be restored." }));
      return false;
    }
  }, []);

  return { ...state, refresh, restoreExamples, saveLots };
}

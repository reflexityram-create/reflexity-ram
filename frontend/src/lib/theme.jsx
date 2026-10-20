import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { subscribeSystemTheme, systemTheme } from "./systemTheme.js";

const validTheme = (theme) => ["light", "dark", "system"].includes(theme);

// Keep the existing storage key so returning visitors retain their choice.
export const useTheme = create(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme: validTheme(theme) ? theme : "system" }),
    }),
    {
      name: "reflexity-theme",
      partialize: ({ theme }) => ({ theme }),
      merge: (saved, current) => ({ ...current, theme: validTheme(saved?.theme) ? saved.theme : "system" }),
    },
  ),
);

export function useResolvedTheme() {
  const theme = useTheme((s) => s.theme);
  const system = useSyncExternalStore(subscribeSystemTheme, systemTheme, () => "light");
  return theme === "system" ? system : theme;
}

export function useApplyTheme() {
  const theme = useResolvedTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f4f6" : "#050505");
  }, [theme]);
}

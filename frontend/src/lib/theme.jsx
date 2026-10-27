import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { THEME_COLOR } from "./themeColors.js";

const validTheme = (theme) => ["light", "dark"].includes(theme);

// Keep the existing storage key so returning visitors retain their choice.
export const useTheme = create(
  persist(
    (set) => ({
      theme: "light",
      setTheme: (theme) => set({ theme: validTheme(theme) ? theme : "light" }),
    }),
    {
      name: "reflexity-theme",
      partialize: ({ theme }) => ({ theme }),
      merge: (saved, current) => ({ ...current, theme: validTheme(saved?.theme) ? saved.theme : "light" }),
    },
  ),
);

export function useResolvedTheme() {
  return useTheme((s) => s.theme);
}

export function useApplyTheme() {
  const theme = useResolvedTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLOR[theme]);
  }, [theme]);
}

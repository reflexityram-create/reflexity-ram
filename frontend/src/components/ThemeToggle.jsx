import { Sun, Moon } from "lucide-react";
import { useResolvedTheme, useTheme } from "@/lib/theme";

export default function ThemeToggle() {
  const theme = useResolvedTheme();
  const setTheme = useTheme((s) => s.setTheme);
  const isDark = theme === "dark";
  const label = `Theme: ${theme}. Switch to ${isDark ? "light" : "dark"} mode`;

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className="theme-toggle-btn"
      data-theme={theme}
      data-testid="theme-toggle"
    >
      {isDark ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
    </button>
  );
}

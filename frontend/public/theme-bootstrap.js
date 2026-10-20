(function () {
  var theme = "system";
  try {
    var raw = localStorage.getItem("reflexity-theme");
    var parsed = raw && JSON.parse(raw);
    if (parsed && parsed.state && (parsed.state.theme === "light" || parsed.state.theme === "dark")) {
      theme = parsed.state.theme;
    }
  } catch (error) { /* Unavailable storage still follows the phone's appearance. */ }
  if (theme === "system") {
    var dark = false;
    try { dark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (error) { /* No media queries: keep the long-standing light default. */ }
    theme = dark ? "dark" : "light";
  }
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f4f4f6" : "#050505");
}());

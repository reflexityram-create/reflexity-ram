(function () {
  var theme = "light";
  try {
    var raw = localStorage.getItem("reflexity-theme");
    var parsed = raw && JSON.parse(raw);
    if (parsed && parsed.state && (parsed.state.theme === "light" || parsed.state.theme === "dark")) {
      theme = parsed.state.theme;
    }
  } catch (error) { /* Unavailable storage keeps the branded light default. */ }
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#fafaf7" : "#08090a");
}());

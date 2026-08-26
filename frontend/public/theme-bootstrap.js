(function () {
  try {
    var theme = "light";
    var raw = localStorage.getItem("reflexity-theme");
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.state && (parsed.state.theme === "light" || parsed.state.theme === "dark")) {
        theme = parsed.state.theme;
      }
    }
    document.documentElement.classList.add(theme);
  } catch (error) {
    document.documentElement.classList.add("light");
  }
}());

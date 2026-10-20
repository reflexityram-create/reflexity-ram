// The browser chrome (Android address bar, iOS status bar) follows <meta name="theme-color">. These are the page backgrounds (--bg in
// index.css), so the chrome and the page meet without a seam. public/theme-bootstrap.js and index.html repeat them because they run
// before any module loads; test/theme.test.js keeps all of them equal to the CSS.
export const THEME_COLOR = Object.freeze({ light: "#fafaf7", dark: "#08090a" });

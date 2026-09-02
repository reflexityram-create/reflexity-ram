// Fonts are visual enhancement, not a render prerequisite. Load the Google
// stylesheet after the initial document so it cannot block first paint/LCP.
const loadFonts = () => {
  if (document.querySelector('link[data-reflexity-fonts]')) return;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.dataset.reflexityFonts = 'true';
  stylesheet.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(stylesheet);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadFonts, { once: true });
} else {
  loadFonts();
}

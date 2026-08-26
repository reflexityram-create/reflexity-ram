// ─── Minimal HTML sanitizer for admin-edited page content ──────────────────────
// These pages (shipping/returns/warranty/faq) only need basic formatting, so
// rather than pull in a heavy dependency we allowlist a small set of safe tags
// and strip everything else. Admin-only input, but we sanitize anyway — defense
// in depth, and it neutralizes any pasted markup from a Word doc / web page.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'h2', 'h3', 'h4',
  'a', 'blockquote',
]);

// Block-level tags that browsers/Word emit which we convert to <p> so their
// text stays wrapped (instead of becoming bare unwrapped text that renders
// inconsistently and loses paragraph spacing — the "squished/wrong font" bug).
const BLOCK_TO_P = new Set(['div', 'section', 'article', 'header', 'footer', 'main']);

// Inline wrappers we drop entirely while keeping their text inline
// (span, font carry pasted font-family/size styling we don't want).
const INLINE_UNWRAP = new Set(['span', 'font', 'small', 'big', 'tt']);

// Per-tag allowed attributes
const ALLOWED_ATTRS = {
  a: new Set(['href', 'title']),
};

const stripTag = (tag) => `</${tag}>`;

const decodeHtmlEntities = (value) => value
  .replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (_, code) => {
    const radix = code[0].toLowerCase() === 'x' ? 16 : 10;
    const number = parseInt(code.slice(radix === 16 ? 1 : 0), radix);
    return Number.isInteger(number) && number >= 0 && number <= 0x10ffff
      ? String.fromCodePoint(number) : _;
  })
  .replace(/&(colon|tab|newline);/gi, (_, name) => ({ colon: ':', tab: '\t', newline: '\n' }[name.toLowerCase()]));

function sanitizeHtml(input) {
  if (!input || typeof input !== 'string') return '';

  // 1. Remove script/style blocks entirely (content included)
  let html = input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // 2. Walk tags. Allowlisted tags pass (attributes filtered); block tags map
  //    to <p>; inline wrappers are unwrapped; everything else is dropped.
  html = html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    const isClosing = match.startsWith('</');

    // Block-level wrappers → paragraph, so content keeps a styled wrapper
    if (BLOCK_TO_P.has(tag)) return isClosing ? '</p>' : '<p>';

    // Inline wrappers (span/font/etc.) → remove the tag, keep the text
    if (INLINE_UNWRAP.has(tag)) return '';

    if (!ALLOWED_TAGS.has(tag)) return '';

    // Closing tag — keep as-is
    if (isClosing) return stripTag(tag);

    // Opening tag — filter attributes
    const allowed = ALLOWED_ATTRS[tag];
    if (!allowed) return `<${tag}>`;

    const keptAttrs = [];
    const attrRe = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = attrRe.exec(rawAttrs)) !== null) {
      const name = m[1].toLowerCase();
      let value = m[2];
      if (!allowed.has(name)) continue;
      // Block dangerous URL schemes on href
      if (name === 'href') {
        const v = decodeHtmlEntities(value).replace(/[\u0000-\u0020]/g, '').trim().toLowerCase();
        if (v.startsWith('javascript:') || v.startsWith('data:') || v.startsWith('vbscript:')) continue;
      }
      // Escape quotes defensively
      value = value.replace(/"/g, '&quot;');
      keptAttrs.push(`${name}="${value}"`);
    }
    // Force external links to be safe
    if (tag === 'a') keptAttrs.push('rel="noopener noreferrer nofollow"');

    return `<${tag}${keptAttrs.length ? ' ' + keptAttrs.join(' ') : ''}>`;
  });

  // 3. Strip any leftover on* event handler fragments (paranoia)
  html = html.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');

  // 4. Collapse empty/whitespace-only paragraphs left behind by unwrapping
  //    (e.g. <p><span>…</span></p> → <p></p> after span removal)
  html = html.replace(/<p>\s*<\/p>/gi, '');

  // 5. Collapse accidental nested paragraphs from block→<p> mapping
  //    (a <div> inside a <p> would otherwise produce <p><p>…</p></p>)
  html = html.replace(/<p>\s*<p>/gi, '<p>').replace(/<\/p>\s*<\/p>/gi, '</p>');

  return html.trim();
}

module.exports = { sanitizeHtml };

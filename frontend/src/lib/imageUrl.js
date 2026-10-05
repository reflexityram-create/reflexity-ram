/**
 * Accept both the API image shape ({ url, ... }) and historical string values.
 * Provider migrations belong in the catalog data, not in rendering fallbacks.
 */
// Phones draw a card about 360 CSS px wide at 3x, so cards need up to ~1100
// real pixels; c_limit never upscales past the original (960-1200 px).
export const CARD_IMAGE_WIDTHS = Object.freeze([320, 480, 640, 960, 1280]);
export const DETAIL_IMAGE_WIDTHS = Object.freeze([480, 640, 960, 1200]);

// q_auto:best keeps label text crisp (q_auto alone shrank a 640 px photo to
// ~23 KB and softened it), e_sharpen restores edges lost in the resize, and
// `trim` crops the plain background around a module, like the Google feed,
// so a stick fills a wide card instead of a thin band in a white square.
export function imageUrl(image, { width, trim = false } = {}) {
  if (!image) return null;
  const url = typeof image === "string" ? image : image.url;
  if (!url) return null;
  const pixelWidth = Number(width);
  if (Number.isInteger(pixelWidth) && pixelWidth >= 32 && pixelWidth <= 2400) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com" && parsed.pathname.includes("/image/upload/")) {
        parsed.pathname = parsed.pathname.replace("/image/upload/", `/image/upload/${trim ? "e_trim:12/" : ""}c_limit,f_auto,q_auto:best,w_${pixelWidth}/e_sharpen:40/`);
        return parsed.toString();
      }
    } catch {
      // Preserve the original URL when it is not parseable.
    }
  }
  return url;
}

/**
 * Return width descriptors only for Cloudinary assets that can actually honor
 * them. The browser then selects the smallest useful derivative for its layout
 * and pixel density instead of every device downloading the same 640px image.
 */
export function imageSrcSet(image, widths = CARD_IMAGE_WIDTHS, { trim = false } = {}) {
  const source = imageUrl(image);
  if (!source) return undefined;
  const candidates = widths
    .filter((width) => Number.isInteger(width) && width >= 32 && width <= 2400)
    .map((width) => [imageUrl(source, { width, trim }), width])
    .filter(([candidate]) => candidate && candidate !== source);
  if (candidates.length === 0) return undefined;
  return candidates.map(([candidate, width]) => `${candidate} ${width}w`).join(", ");
}

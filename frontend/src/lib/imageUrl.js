/**
 * Accept both the API image shape ({ url, ... }) and historical string values.
 * Provider migrations belong in the catalog data, not in rendering fallbacks.
 */
export const CARD_IMAGE_WIDTHS = Object.freeze([320, 480, 640]);
export const DETAIL_IMAGE_WIDTHS = Object.freeze([480, 640, 960, 1200]);

export function imageUrl(image, { width } = {}) {
  if (!image) return null;
  const url = typeof image === "string" ? image : image.url;
  if (!url) return null;
  const pixelWidth = Number(width);
  if (Number.isInteger(pixelWidth) && pixelWidth >= 32 && pixelWidth <= 2400) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com" && parsed.pathname.includes("/image/upload/")) {
        parsed.pathname = parsed.pathname.replace("/image/upload/", `/image/upload/c_limit,f_auto,q_auto,w_${pixelWidth}/`);
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
export function imageSrcSet(image, widths = CARD_IMAGE_WIDTHS) {
  const source = imageUrl(image);
  if (!source) return undefined;
  const candidates = widths
    .filter((width) => Number.isInteger(width) && width >= 32 && width <= 2400)
    .map((width) => [imageUrl(source, { width }), width])
    .filter(([candidate]) => candidate && candidate !== source);
  if (candidates.length === 0) return undefined;
  return candidates.map(([candidate, width]) => `${candidate} ${width}w`).join(", ");
}

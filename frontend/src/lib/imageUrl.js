/**
 * Accept both the API image shape ({ url, ... }) and historical string values.
 * Provider migrations belong in the catalog data, not in rendering fallbacks.
 */
export function imageUrl(image, { width } = {}) {
  if (!image) return null;
  const url = typeof image === "string" ? image : image.url;
  if (!url) return null;
  const pixelWidth = Number(width);
  if (Number.isInteger(pixelWidth) && pixelWidth >= 32 && pixelWidth <= 2400) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com" && parsed.pathname.includes("/image/upload/")) {
        parsed.pathname = parsed.pathname.replace("/image/upload/", `/image/upload/f_auto,q_auto,w_${pixelWidth}/`);
        return parsed.toString();
      }
    } catch {
      // Preserve the original URL when it is not parseable.
    }
  }
  return url;
}

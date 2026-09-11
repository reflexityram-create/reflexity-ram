import { permanentRedirect } from "../../functions-shared/legacyRedirects.js";

export function onRequest(context) {
  const slug = encodeURIComponent(context.params?.slug || "");
  return permanentRedirect(context.request, `/inventory/${slug}`);
}

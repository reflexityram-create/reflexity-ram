import { permanentRedirect } from "../../functions-shared/legacyRedirects.js";

export function onRequest(context) {
  return permanentRedirect(context.request, `/shop/${encodeURIComponent(context.params?.slug || "")}`);
}

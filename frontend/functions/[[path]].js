import { legacyRedirect } from "../functions-shared/legacyRedirects.js";
import { renderStaticPage } from "../functions-shared/staticMetadata.js";

export function onRequest(context) {
  return legacyRedirect(context.request) || renderStaticPage(context);
}

import { renderStaticPage } from "../functions-shared/staticMetadata.js";
import { legacyRedirect } from "../functions-shared/legacyRedirects.js";

export function onRequest(context) {
  const redirect = legacyRedirect(context.request);
  if (redirect) return redirect;
  return renderStaticPage(context);
}

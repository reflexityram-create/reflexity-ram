import { renderStaticPage } from "../functions-shared/staticMetadata.js";

export function onRequest(context) {
  return renderStaticPage(context);
}

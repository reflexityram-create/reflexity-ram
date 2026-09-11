import { renderProductPage } from "../../functions-shared/productMetadata.js";

export function onRequest(context) {
  return renderProductPage(context);
}

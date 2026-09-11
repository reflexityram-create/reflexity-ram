import { renderWholesaleLotPage } from "../../functions-shared/wholesaleLotMetadata.js";

export function onRequest(context) {
  return renderWholesaleLotPage(context);
}

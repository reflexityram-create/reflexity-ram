// What a failed read means for the page. It is "not found" only when the server said so (404): a timeout while the server
// wakes up, a 5xx or a lost connection is a failure to load, and the page offers to try again instead of telling the buyer
// the item does not exist. A request the page cancelled itself (it moved on) means nothing.
export function loadFailure(error) {
  if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError" || error?.name === "AbortError") return "cancelled";
  return error?.response?.status === 404 ? "not-found" : "failed";
}

// The phone app (android-admin/) shows the admin site in a web view. Its Back button first asks the page whether something
// on top (a sheet) wants to close; if so the page closes it and the app stays, otherwise the app goes back as usual.
// Older app versions never ask, and a plain browser never calls this, so nothing depends on it.
const handlers = [];

// Register what Back should do while something is open. Returns the function that unregisters it.
export function pushBackHandler(handler) {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

// True when a handler took the Back press.
export function handleBack() {
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  handler();
  return true;
}

if (typeof window !== 'undefined') window.rfxHandleBack = handleBack;

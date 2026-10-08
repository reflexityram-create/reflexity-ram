// Keep the guest proof in the closure, never in a URL. Only one lookup can be
// in flight, and late replies cannot change an unmounted or different order.
export function startOrderUpdates({ load, onOrder, onError, onLoaded,
  doc = document, setTimer = setInterval, clearTimer = clearInterval }) {
  let active = true;
  let busy = false;
  let first = true;
  let terminal = false;
  const refresh = async () => {
    if (!active || busy || terminal || (!first && doc.visibilityState === 'hidden')) return;
    busy = true;
    try {
      const { data } = await load();
      if (!active) return;
      terminal = ['delivered', 'cancelled', 'refunded'].includes(data.order.status);
      onOrder(data.order);
    } catch {
      if (active && first) onError('Order not found');
    } finally {
      if (active && first) onLoaded();
      first = false;
      busy = false;
    }
  };
  refresh();
  const timer = setTimer(refresh, 60000);
  doc.addEventListener('visibilitychange', refresh);
  return () => { active = false; clearTimer(timer); doc.removeEventListener('visibilitychange', refresh); };
}

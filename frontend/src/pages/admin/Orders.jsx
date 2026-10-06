import { useEffect, useRef, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, X, Package, Truck, Star } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { adminApi } from '@/lib/api';
import { imageUrl } from '@/lib/imageUrl';
import ShippingPreparationPanel from '@/components/admin/ShippingPreparationPanel';

const NEXT_STATUS = Object.freeze({
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  refunded: [],
});
function statusOptions(order) {
  const current = order?.status;
  if (!current) return [];
  const next = NEXT_STATUS[current] || [];
  const allowed = order.paymentStatus === 'paid' ? next.filter((status) => status !== 'cancelled') : next;
  // Keep the current value visible for read-only terminal/refunded states,
  // but never present refunded as an admin transition.
  return [current, ...allowed.filter((status) => status !== current && status !== 'refunded')];
}
// The status filter's options. Kept in the same order as NEXT_STATUS and
// matching the values the admin orders API accepts.
const STATUS_OPTIONS = Object.keys(NEXT_STATUS);
const STATUS_PILLS = {
  pending: 'pill-amber',
  processing: 'pill-blue',
  shipped: 'pill-accent',
  delivered: 'pill-accent',
  cancelled: 'text-neutral-500',
  refunded: 'text-neutral-500',
};

const formatDateTime = (value) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// The "how was your order?" email: queued automatically when the order is
// marked shipped; the button covers older orders and failed attempts.
function ReviewEmailPanel({ order, onUpdated }) {
  const [sending, setSending] = useState(false);
  const request = order.reviewRequest || {};
  const reviewable = order.paymentStatus === 'paid' && ['shipped', 'delivered'].includes(order.status);
  const email = order.user?.email || order.guestEmail;

  let summary;
  if (request.cancelledAt) summary = `Cancelled ${formatDateTime(request.cancelledAt)} (order refunded).`;
  else if (request.scheduledFor) {
    summary = new Date(request.scheduledFor) > new Date()
      ? `Scheduled for ${formatDateTime(request.scheduledFor)}.`
      : `Sent ${formatDateTime(request.scheduledFor)}.`;
  } else if (request.claimedAt) summary = 'Sending…';
  else if (request.lastError) summary = `Last attempt failed: ${request.lastError}`;
  else if (reviewable) summary = 'Not sent. Orders shipped before review emails existed have none.';
  else summary = 'Goes out 10 days after the order is marked shipped.';
  const canSend = reviewable && !request.claimedAt && Boolean(email);

  const send = async () => {
    if (!window.confirm(`Email ${email} a review request for this order now?`)) return;
    setSending(true);
    try {
      const { data } = await adminApi.sendReviewRequest(order._id);
      onUpdated(data.order);
      toast.success('Review email sent');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Review email failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="glass rounded-xl p-4 text-[13px]" data-testid="review-email-panel">
      <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-2 flex items-center gap-1.5">
        <Star size={11} /> Review email
      </div>
      <div className="text-neutral-300">{summary}</div>
      {canSend && (
        <button type="button" onClick={send} disabled={sending} className="btn-ghost mt-3 flex items-center gap-2">
          {sending && <Loader2 size={13} className="animate-spin" />}
          Send review email now
        </button>
      )}
    </div>
  );
}

function OrderDetailModal({ orderId, onClose }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [statusForm, setStatusForm] = useState({ status: '', trackingNumber: '', note: '' });
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    triggerRef.current = document.activeElement;
    setLoading(true);
    setOrder(null);
    setStatusForm({ status: '', trackingNumber: '', note: '' });
    adminApi.getOrder(orderId, { signal: controller.signal })
      .then(({ data }) => {
        if (!active) return;
        setOrder(data.order);
        setStatusForm(f => ({ ...f, status: data.order.status }));
      })
      .catch((error) => {
        if (active && error?.code !== 'ERR_CANCELED') toast.error('Failed to load order');
      })
      .finally(() => active && setLoading(false));
    const focusTimer = window.setTimeout(() => dialogRef.current?.querySelector('button,select,input')?.focus(), 0);
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button,select,input,textarea')].filter((el) => !el.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      triggerRef.current?.focus?.();
    };
  }, [orderId]);

  // Only GET /orders/:id carries `shippingPreparation`; the status and review-email responses are plain orders, so replacing the order with them made the
  // shipping panel vanish after any action. Read the order again instead (and fall back to what the action returned if that read fails).
  const reloadOrder = async (fallback) => {
    try {
      const { data } = await adminApi.getOrder(orderId);
      setOrder(data.order);
    } catch {
      if (fallback) setOrder(fallback);
    }
  };

  const handleStatusUpdate = async (e) => {
    e.preventDefault();
    setUpdating(true);
    try {
      const { data } = await adminApi.updateOrderStatus(orderId, statusForm);
      await reloadOrder(data.order);
      toast.success('Order status updated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-auto" role="dialog" aria-modal="true" aria-labelledby="order-detail-title" ref={dialogRef}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl glass rounded-2xl p-6 my-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 id="order-detail-title" className="font-bold text-lg">Order details</h2>
            {order && <div className="mono text-[12px] text-neutral-500 mt-0.5">{order.orderNumber}</div>}
          </div>
          <button aria-label="Close order details" onClick={onClose} className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-neutral-400 py-8">
            <Loader2 size={16} className="animate-spin" />
            Loading…
          </div>
        ) : order && (
          <div className="space-y-5">
            {/* Customer */}
            <div className="glass rounded-xl p-4 text-[13px]">
              <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-2">Customer</div>
              <div>{order.user ? `${order.user.firstName} ${order.user.lastName}` : 'Guest'}</div>
              <div className="text-neutral-400">{order.user?.email || order.guestEmail}</div>
            </div>

            {/* Notes the system left on the order: which Canada Post service to buy, an oversold item, an email or payment that needs a look */}
            {order.adminNotes && (
              <div className="rounded-xl p-4 text-[13px] border border-amber-500/30 bg-amber-500/5" role="note" data-testid="order-admin-notes">
                <div className="text-amber-700 dark:text-amber-300 text-[11px] uppercase tracking-widest mb-2">Notes on this order</div>
                <ul className="space-y-1.5 leading-relaxed break-words">
                  {order.adminNotes.split('\n').filter(Boolean).map((line, i) => (
                    <li key={i} className={/^(OVERSOLD|REVIEW)/.test(line) ? 'text-amber-800 dark:text-amber-200 font-medium' : 'text-neutral-200'}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Items */}
            <div className="glass rounded-xl p-4">
              <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Package size={11} /> Items
              </div>
              <div className="space-y-2">
                {order.items?.map((item, idx) => (
                  <div key={idx} className="flex gap-3 text-[12.5px]">
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 shrink-0">
                      {item.image && <img src={imageUrl(item.image)} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="flex-1">
                      <div>{item.name}</div>
                      <div className="mono text-[10px] text-neutral-500">Qty: {item.qty}</div>
                    </div>
                    <div className="mono">${(item.price * item.qty).toFixed(2)}</div>
                  </div>
                ))}
              </div>
              <div className="border-t border-white/5 mt-3 pt-3 flex justify-between text-[13px] font-bold">
                <span>Total</span>
                <span className="mono">${order.total?.toFixed(2)}</span>
              </div>
            </div>

            {/* Shipping */}
            <div className="glass rounded-xl p-4 text-[13px]">
              <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Truck size={11} /> Shipping
              </div>
              <div className="text-neutral-200 leading-relaxed">
                {order.shippingAddress?.firstName} {order.shippingAddress?.lastName}<br />
                {order.shippingAddress?.line1}<br />
                {order.shippingAddress?.city}, {order.shippingAddress?.state} {order.shippingAddress?.zip}
              </div>
              {order.trackingNumber && (
                <div className="mt-2 text-neutral-400">
                  Tracking: <span className="mono text-white">{order.trackingNumber}</span>
                </div>
              )}
            </div>

            <ShippingPreparationPanel preparation={order.shippingPreparation} />

            <ReviewEmailPanel order={order} onUpdated={(next) => reloadOrder(next)} />

            {/* Update status */}
            <form onSubmit={handleStatusUpdate} className="glass rounded-xl p-4 space-y-3">
              <div className="text-neutral-500 text-[11px] uppercase tracking-widest">Update status</div>
              <select
                className="input"
                value={statusForm.status}
                onChange={e => setStatusForm(f => ({ ...f, status: e.target.value }))}
              >
                {statusOptions(order).map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <input
                className="input"
                placeholder="Tracking number (optional)"
                value={statusForm.trackingNumber}
                onChange={e => setStatusForm(f => ({ ...f, trackingNumber: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Note (optional)"
                value={statusForm.note}
                onChange={e => setStatusForm(f => ({ ...f, note: e.target.value }))}
              />
              <button type="submit" disabled={updating} className="btn-primary flex items-center gap-2">
                {updating && <Loader2 size={13} className="animate-spin" />}
                Update status
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [archivedView, setArchivedView] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  const load = (p = page, s = statusFilter, arch = archivedView) => {
    setLoading(true);
    adminApi.listOrders({
      page: p,
      limit: 20,
      status: s || undefined,
      archived: arch ? 'true' : 'false',
    })
      .then(({ data }) => {
        setOrders(data.orders);
        setPagination(data.pagination);
      })
      .catch(() => toast.error('Failed to load orders'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, statusFilter, archivedView]);

  const handleArchive = async (id, archived) => {
    try {
      await adminApi.archiveOrder(id, archived);
      toast.success(archived ? 'Order archived' : 'Order restored');
      load();
    } catch {
      toast.error('Failed to update order');
    }
  };

  return (
    <AppLayout requireAdmin>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-neutral-500 text-[13px] mt-0.5">{pagination.total} total orders</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          <select
            className="input w-auto"
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { setArchivedView(v => !v); setPage(1); }}
            className={archivedView ? 'btn-primary' : 'btn-secondary'}
          >
            {archivedView ? 'Viewing archived' : 'Show archived'}
          </button>
        </div>

        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-neutral-500 text-[11px] uppercase tracking-widest border-b border-white/5">
                  <th className="text-left p-4 font-normal">Order</th>
                  <th className="text-left p-4 font-normal">Customer</th>
                  <th className="text-left p-4 font-normal">Status</th>
                  <th className="text-right p-4 font-normal">Total</th>
                  <th className="text-right p-4 font-normal">Date</th>
                  <th className="text-right p-4 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-neutral-500">
                      <Loader2 size={16} className="animate-spin inline mr-2" />
                      Loading…
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-neutral-500">No orders found</td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <tr key={o._id} className="hover:bg-white/2 transition-colors">
                      <td className="p-4 mono text-[11px]">{o.orderNumber}</td>
                      <td className="p-4 text-neutral-400">
                        {o.user ? `${o.user.firstName} ${o.user.lastName}` : o.guestEmail || 'Guest'}
                      </td>
                      <td className="p-4">
                        <span className={`pill ${STATUS_PILLS[o.status] || ''} text-[10px] py-0.5`}>
                          {o.status}
                        </span>
                      </td>
                      <td className="p-4 text-right mono">${o.total?.toFixed(2)}</td>
                      <td className="p-4 text-right text-neutral-500">
                        {new Date(o.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setSelectedOrderId(o._id)}
                            className="btn-ghost py-1 px-2.5 text-[11px]"
                          >
                            Manage
                          </button>
                          <button
                            onClick={() => handleArchive(o._id, !o.archived)}
                            className="btn-ghost py-1 px-2.5 text-[11px] text-neutral-500 hover:text-white"
                            title={o.archived ? 'Restore order' : 'Archive order'}
                          >
                            {o.archived ? 'Restore' : 'Archive'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {pagination.pages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-white/5 text-[13px]">
              <span className="text-neutral-500">Page {pagination.page} of {pagination.pages}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost py-1.5 px-3 flex items-center gap-1">
                  <ChevronLeft size={13} /> Prev
                </button>
                <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages} className="btn-ghost py-1.5 px-3 flex items-center gap-1">
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedOrderId && (
        <OrderDetailModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </AppLayout>
  );
}

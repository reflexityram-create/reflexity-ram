import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, ChevronLeft, ChevronRight, Package, Truck, Star, RefreshCw, Copy, Check, History } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import AdminSheet from '@/components/admin/AdminSheet';
import ConfirmButton from '@/components/admin/ConfirmButton';
import OrderActions from '@/components/admin/OrderActions';
import { adminApi } from '@/lib/api';
import { imageUrl } from '@/lib/imageUrl';
import ShippingPreparationPanel from '@/components/admin/ShippingPreparationPanel';
import PaymentPanel from '@/components/admin/PaymentPanel';
import DisputeBox from '@/components/admin/DisputeBox';
import DisputePill from '@/components/admin/DisputePill';
import { TONE_CLASS, disputeState, paymentState, showPaymentLabel } from '@/lib/orderPayment';
import { ORDER_VIEWS, ageLabel, countFor, customerName, isViewKey, nextStep, orderMoney } from '@/lib/adminOrders';

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
        <div className="mt-3">
          <ConfirmButton
            variant="secondary"
            label="Send review email now"
            confirmLabel="Yes, send it"
            message={`Email ${email} a review request for this order now?`}
            busy={sending}
            onConfirm={send}
            className="w-full sm:w-auto"
            testId="review-email-send"
          />
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value, strong = false }) => (
  <div className={`flex justify-between gap-3 ${strong ? 'pt-2 mt-2 border-t border-white/5 text-[13px] font-bold' : 'text-[12.5px] text-neutral-400'}`}>
    <span>{label}</span>
    <span className="mono">{value}</span>
  </div>
);

// Collapsible block for the details the owner rarely needs (label preparation, history).
const Fold = ({ icon: Icon, title, children, testId }) => (
  <details className="glass rounded-xl text-[13px]" data-testid={testId}>
    <summary className="flex min-h-12 cursor-pointer items-center gap-1.5 px-4 py-3 text-neutral-500 text-[11px] uppercase tracking-widest">
      {Icon && <Icon size={11} />} {title}
    </summary>
    <div className="px-4 pb-4">{children}</div>
  </details>
);

function CopyAddress({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy the address');
    }
  };
  return (
    <button type="button" onClick={copy} className="btn-secondary min-h-11 mt-3 text-[12px]" data-testid="order-copy-address">
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy address'}
    </button>
  );
}

function OrderSheet({ orderId, onClose, onChanged }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setOrder(null);
    adminApi.getOrder(orderId, { signal: controller.signal })
      .then(({ data }) => {
        if (!active) return;
        setOrder(data.order);
      })
      .catch((error) => {
        if (active && error?.code !== 'ERR_CANCELED') toast.error('Failed to load order');
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      controller.abort();
    };
  }, [orderId]);

  // Only GET /orders/:id carries `shippingPreparation`; the status and review-email responses are plain orders, so replacing the order with them
  // made the shipping panel vanish after any action. Read the order again instead (and fall back to what the action returned if that read fails).
  // The list behind the sheet is refreshed too, so its counts and pills follow what was just done.
  const reloadOrder = async (fallback) => {
    try {
      const { data } = await adminApi.getOrder(orderId);
      setOrder(data.order);
    } catch {
      if (fallback) setOrder(fallback);
    }
    onChanged?.();
  };

  const step = order ? nextStep(order) : null;
  const paymentShownAbove = step?.key === 'collect' || step?.key === 'clearing';
  const shipped = order && ['shipped', 'delivered'].includes(order.status);
  const address = order?.shippingAddress || {};
  const addressText = [
    `${address.firstName || ''} ${address.lastName || ''}`.trim(),
    address.line1,
    address.line2,
    [address.city, address.state, address.zip].filter(Boolean).join(', '),
    address.country && address.country !== 'CA' ? address.country : '',
  ].filter(Boolean).join('\n');
  const email = order ? (order.user?.email || order.guestEmail) : '';
  const phone = order ? (address.phone || order.user?.phone) : '';

  return (
    <AdminSheet
      titleId="order-detail-title"
      title="Manage order"
      subtitle={order?.orderNumber}
      closeLabel="Close order details"
      onClose={onClose}
      badges={order && (
        <>
          <span className={`pill ${STATUS_PILLS[order.status] || ''} text-[10px] py-0.5`}>{order.status}</span>
          {showPaymentLabel(order) && <span className={`pill ${TONE_CLASS[paymentState(order).tone]} text-[10px] py-0.5`} data-testid="sheet-payment-label">{paymentState(order).label}</span>}
          <DisputePill order={order} />
        </>
      )}
    >
      {loading ? (
        <div className="flex items-center gap-2 text-neutral-400 py-8">
          <Loader2 size={16} className="animate-spin" />
          Loading…
        </div>
      ) : order && (
        <div className="space-y-4">
          {/* A dispute or bank inquiry on the payment: first, because it has a deadline and it changes what to do with the parcel */}
          <DisputeBox order={order} />

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

          {/* What to do next: collect the money, ship it, mark it delivered or cancel an unpaid one */}
          <OrderActions order={order} step={step} onChanged={(next) => reloadOrder(next)} />

          {/* Customer */}
          <div className="glass rounded-xl p-4 text-[13px]">
            <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-2">Customer</div>
            <div className="font-medium">{customerName(order)}</div>
            {email && <a className="block text-neutral-400 underline underline-offset-4 break-all min-h-6" href={`mailto:${email}`}>{email}</a>}
            {phone && <a className="block text-neutral-400 underline underline-offset-4 min-h-6" href={`tel:${phone}`}>{phone}</a>}
          </div>

          {/* Shipping */}
          <div className="glass rounded-xl p-4 text-[13px]">
            <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Truck size={11} /> Ship to
            </div>
            <div className="text-neutral-200 leading-relaxed whitespace-pre-line">{addressText || 'No address on this order'}</div>
            {addressText && <CopyAddress text={addressText} />}
            {order.trackingNumber && (
              <div className="mt-3 text-neutral-400">
                Tracking: <span className="mono text-white break-all">{order.trackingNumber}</span>
              </div>
            )}
            {order.untracked && <div className="mt-3 text-neutral-400">Shipped without tracking.</div>}
          </div>

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
                  <div className="flex-1 min-w-0">
                    <div className="break-words">{item.name}</div>
                    <div className="mono text-[10px] text-neutral-500">Qty: {item.qty}</div>
                  </div>
                  <div className="mono shrink-0">{orderMoney(item.price * item.qty)}</div>
                </div>
              ))}
            </div>
            <div className="border-t border-white/5 mt-3 pt-3">
              {Number(order.subtotal) > 0 && <Row label="Items" value={orderMoney(order.subtotal)} />}
              {Number(order.discount) > 0 && <Row label={order.paymentDiscountPct ? `Discount (${order.paymentDiscountPct}% for ${order.paymentMethod === 'etransfer' ? 'e-Transfer' : 'bank debit'})` : 'Discount'} value={`−${orderMoney(order.discount)}`} />}
              {Number(order.shippingCost) > 0 && <Row label="Shipping" value={orderMoney(order.shippingCost)} />}
              {Number(order.tax) > 0 && <Row label="Tax" value={orderMoney(order.tax)} />}
              <Row label="Total" value={orderMoney(order.total)} strong />
            </div>
          </div>

          {/* How it was paid (an e-Transfer or bank debit still being collected is shown above, as the next step) */}
          {!paymentShownAbove && <PaymentPanel order={order} onChanged={() => reloadOrder()} />}

          {/* What happened to the order, newest first */}
          {order.statusHistory?.length > 0 && (
            <Fold icon={History} title={`History (${order.statusHistory.length})`} testId="order-history">
              <ol className="space-y-2.5 text-[12.5px]">
                {[...order.statusHistory].reverse().map((entry, index) => (
                  <li key={`${entry.timestamp}-${index}`} className="border-l-2 pl-3" style={{ borderColor: 'var(--border-strong)' }}>
                    <div className="text-neutral-200 capitalize">{entry.status}</div>
                    {entry.note && <div className="text-neutral-400 break-words">{entry.note}</div>}
                    <div className="text-neutral-500 text-[11px]">{formatDateTime(entry.timestamp)}</div>
                  </li>
                ))}
              </ol>
            </Fold>
          )}

          {/* Label details only matter until the parcel has gone */}
          {!shipped && order.shippingPreparation && (
            <Fold icon={Truck} title="Shipping label details" testId="order-label-details">
              <ShippingPreparationPanel preparation={order.shippingPreparation} />
            </Fold>
          )}

          {shipped && <ReviewEmailPanel order={order} onUpdated={(next) => reloadOrder(next)} />}
        </div>
      )}
    </AdminSheet>
  );
}

// One order as a card: the whole card opens it. Built for a thumb, so nothing here needs sideways scrolling.
function OrderCard({ order, onOpen }) {
  const payment = paymentState(order);
  const waitingOnYou = nextStep(order).key === 'collect' || nextStep(order).key === 'ship';
  // While the bank is disputing or asking about the payment, or once the dispute is lost (the money is gone), the card does not
  // suggest shipping: the order is the owner's call.
  const underDispute = ['open', 'inquiry', 'lost'].includes(disputeState(order)?.key);
  return (
    <li>
      <button type="button" onClick={() => onOpen(order._id)} className={`admin-card ${waitingOnYou ? 'needs-you' : ''}`} data-testid="order-card" aria-label={`Manage order ${order.orderNumber}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-[15px] truncate">{customerName(order)}</div>
            <div className="mono text-[11px] text-neutral-500 truncate">{order.orderNumber}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="mono font-semibold text-[15px]">{orderMoney(order.total)}</div>
            <div className="text-[11px] text-neutral-500">{ageLabel(order.createdAt)}</div>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className={`pill ${STATUS_PILLS[order.status] || ''} text-[10px] py-0.5`}>{order.status}</span>
          {showPaymentLabel(order) && <span className={`pill ${TONE_CLASS[payment.tone]} text-[10px] py-0.5`} data-testid="order-card-payment-label">{payment.label}</span>}
          <DisputePill order={order} />
          {nextStep(order).key === 'ship' && !underDispute && <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Ready to ship</span>}
          <ChevronRight size={16} className="ml-auto text-neutral-500" aria-hidden="true" />
        </div>
      </button>
    </li>
  );
}

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('all');
  const [page, setPage] = useState(1);
  // A phone notification opens /admin/orders?order=<id>: that order's panel opens straight away.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedOrder = /^[a-f0-9]{24}$/i.test(searchParams.get('order') || '') ? searchParams.get('order') : null;
  const [selectedOrderId, setSelectedOrderId] = useState(linkedOrder);
  useEffect(() => { if (linkedOrder) setSelectedOrderId(linkedOrder); }, [linkedOrder]);
  const closeOrder = () => {
    setSelectedOrderId(null);
    if (searchParams.has('order')) setSearchParams({}, { replace: true });
  };

  // The latest request wins: a slow answer for an old view must not overwrite the view that is open now.
  const latest = useRef(0);
  const load = (p = page, v = view, quiet = false) => {
    const ticket = latest.current + 1;
    latest.current = ticket;
    if (!quiet) setLoading(true);
    adminApi.listOrders({ page: p, limit: 20, view: v === 'all' ? undefined : v })
      .then(({ data }) => {
        if (latest.current !== ticket) return;
        setOrders(data.orders);
        setPagination(data.pagination);
        setCounts(data.counts || null);
      })
      .catch(() => { if (latest.current === ticket) toast.error('Failed to load orders'); })
      .finally(() => { if (latest.current === ticket) setLoading(false); });
  };

  useEffect(() => { load(); }, [page, view]);

  // A new order should show up without a manual refresh (the phone app keeps this page open): reload quietly every minute
  // and whenever the page comes back to the front, but never while an order's panel is open (it would not disturb it, yet
  // there is nothing to gain).
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !selectedOrderId) load(page, view, true);
    };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [page, view, selectedOrderId]);

  const pickView = (key) => {
    if (!isViewKey(key) || key === view) return;
    setOrders([]);
    setView(key);
    setPage(1);
  };

  const total = countFor(counts, 'all');

  return (
    <AppLayout requireAdmin>
      <div className="p-4 md:p-8">
        <div className="mb-4 md:mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
            <p className="text-neutral-500 text-[13px] mt-0.5">{total === null ? 'Loading…' : `${total} ${total === 1 ? 'order' : 'orders'} in total`}</p>
          </div>
          <button type="button" onClick={() => load(page, view)} className="btn-secondary min-h-11 !px-3.5" aria-label="Refresh orders" data-testid="orders-refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* One row of buttons instead of a dropdown and toggles: what needs you is first and carries its count */}
        <div className="chip-row -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:mb-6 md:flex-wrap md:overflow-visible md:px-0" role="group" aria-label="Show orders">
          {ORDER_VIEWS.map((entry) => {
            const count = countFor(counts, entry.key);
            return (
              <button
                key={entry.key}
                type="button"
                className="chip"
                aria-pressed={view === entry.key}
                onClick={() => pickView(entry.key)}
                data-testid={entry.key === 'awaiting' ? 'orders-awaiting-filter' : `orders-view-${entry.key}`}
              >
                {entry.label}
                {count !== null && <span className={`chip-count ${entry.needsYou && count > 0 ? 'needs-you' : ''}`}>{count}</span>}
              </button>
            );
          })}
        </div>

        {loading && orders.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center text-neutral-500">
            <Loader2 size={16} className="animate-spin inline mr-2" />
            Loading…
          </div>
        ) : orders.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center text-neutral-500" data-testid="orders-empty">No orders here.</div>
        ) : (
          <>
            {/* Phone: cards */}
            <ul className="space-y-2.5 md:hidden" data-testid="orders-cards">
              {orders.map((o) => <OrderCard key={o._id} order={o} onOpen={setSelectedOrderId} />)}
            </ul>

            {/* Tablet and desktop: the table, as before, with one Manage button per order */}
            <div className="glass rounded-2xl overflow-hidden hidden md:block">
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
                    {orders.map((o) => (
                      <tr key={o._id} className="hover:bg-white/2 transition-colors">
                        <td className="p-4 mono text-[11px]">{o.orderNumber}</td>
                        <td className="p-4 text-neutral-400">{customerName(o)}</td>
                        <td className="p-4">
                          <span className={`pill ${STATUS_PILLS[o.status] || ''} text-[10px] py-0.5`}>
                            {o.status}
                          </span>
                          {showPaymentLabel(o) && (
                            <span className={`pill ${TONE_CLASS[paymentState(o).tone]} text-[10px] py-0.5 ml-1.5`} data-testid="order-payment-label">{paymentState(o).label}</span>
                          )}
                          <DisputePill order={o} className="ml-1.5" />
                        </td>
                        <td className="p-4 text-right mono">${o.total?.toFixed(2)}</td>
                        <td className="p-4 text-right text-neutral-500">
                          {new Date(o.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-4 text-right">
                          <button onClick={() => setSelectedOrderId(o._id)} className="btn-secondary !py-1.5 !px-4 text-[12px]">
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {pagination.pages > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3 text-[13px]">
            <span className="text-neutral-500">Page {pagination.page} of {pagination.pages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-secondary min-h-11 !px-4 flex items-center gap-1">
                <ChevronLeft size={14} /> Prev
              </button>
              <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages} className="btn-secondary min-h-11 !px-4 flex items-center gap-1">
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedOrderId && (
        <OrderSheet
          orderId={selectedOrderId}
          onClose={closeOrder}
          onChanged={() => load(page, view, true)}
        />
      )}
    </AppLayout>
  );
}

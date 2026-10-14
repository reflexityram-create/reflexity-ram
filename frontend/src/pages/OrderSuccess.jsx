import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle, Package, Truck, Loader2, AlertTriangle, Clock, Copy, Check } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { ordersApi } from '@/lib/api';
import GoogleCustomerReviewsOptIn from '@/components/GoogleCustomerReviewsOptIn';
import { imageUrl } from '@/lib/imageUrl';
import useAuthStore from '@/lib/authStore';
import OrderTracking from '@/components/OrderTracking';
import { startOrderUpdates } from '@/lib/orderUpdates';
import { torontoDeadline } from '@/lib/paymentMethods';
import { SUPPORT_EMAIL, differsFromContact } from '@/lib/contact';

const STATUS_STEPS = [
  { id: 'pending', label: 'Order placed' },
  { id: 'processing', label: 'Processing' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'delivered', label: 'Delivered' },
];

const STATUS_INDEX = { pending: 0, processing: 1, shipped: 2, delivered: 3 };

const dayLabel = (value) => (value
  ? new Date(value).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
  : null);

// The same page is the confirmation right after paying and the status page the
// shipping email links to later, so the headline follows the order's status.
const headline = (order) => {
  const email = order.user?.email || order.guestEmail;
  // Placed but not paid yet: an e-Transfer to send, or a bank debit that is still clearing.
  if (order.paymentStatus === 'pending' && order.status === 'pending') {
    if (order.paymentMethod === 'etransfer') {
      return { Icon: Clock, title: 'Order placed: now send your e-Transfer',
        text: `We are holding your items${order.etransfer?.expiresAt ? ` until ${torontoDeadline(order.etransfer.expiresAt)}` : ''}. Your order is confirmed, and ships, as soon as we receive the transfer.` };
    }
    if (order.paymentMethod === 'bank_debit') {
      return { Icon: Clock, title: 'Order received: your bank is processing the payment',
        text: 'A bank debit takes up to 5 business days to clear. We ship as soon as it does, and we will email you.' };
    }
  }
  switch (order.status) {
    case 'shipped':
      // Sent on purpose without a tracking number: say so instead of promising a carrier scan that will never come.
      if (order.untracked) {
        return { Icon: Truck, title: 'Your order is on its way',
          text: `Shipped${order.shippedAt ? ` ${dayLabel(order.shippedAt)}` : ''} without a tracking number, so there is nothing to follow online. Delivery usually takes 3–6 business days after dispatch. If it has not arrived by then, email reflexityram@gmail.com.` };
      }
      return { Icon: Truck, title: 'Your order is on its way',
        text: `Shipped${order.shippedAt ? ` ${dayLabel(order.shippedAt)}` : ''} with Canada Post. ${order.trackingLatest?.expectedDeliveryDate
          ? `Canada Post expects to deliver it ${dayLabel(`${order.trackingLatest.expectedDeliveryDate}T12:00:00Z`)}.`
          : 'Delivery usually takes 3–6 business days after dispatch.'}` };
    case 'delivered':
      return { Icon: Package, title: 'Your order was delivered',
        text: `Delivered${order.deliveredAt ? ` ${dayLabel(order.deliveredAt)}` : ''}. Thank you for shopping with us.` };
    case 'cancelled':
      return { Icon: AlertTriangle, warn: true, title: 'This order was cancelled', text: 'Questions about it? Email reflexityram@gmail.com.' };
    case 'refunded':
      return { Icon: AlertTriangle, warn: true, title: 'This order was refunded', text: 'The refund goes back to your original payment method.' };
    default:
      return { Icon: CheckCircle, title: 'Order confirmed!', text: email ? `Thank you for your order. A confirmation email has been sent to ${email}.` : 'Thank you for your order.' };
  }
};

// One line of the e-Transfer instructions, with a button to copy it into the banking app.
function CopyRow({ label, value, copyValue, testId }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(copyValue ?? value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
    catch { /* the value is selectable on the page */ }
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-t border-white/5 first:border-t-0" data-testid={testId}>
      <div className="min-w-0">
        <div className="text-neutral-500 text-[11px] uppercase tracking-widest">{label}</div>
        <div className="mono text-[14px] break-all select-all">{value}</div>
      </div>
      <button type="button" onClick={copy} className="btn-secondary min-h-11 shrink-0" aria-label={`Copy ${label.toLowerCase()}`}>
        {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function OrderSuccess() {
  const { orderNumber } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!orderNumber) return;
    setLoading(true); setError(null); setOrder(null);
    // Guest proof arrives in a client-only fragment and then lives only for
    // this browser session. Legacy query links are cleaned before the API call.
    const storageKey = `rfx_order_email:${orderNumber}`;
    const hashEmail = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('email');
    const queryEmail = new URLSearchParams(window.location.search).get('email');
    let storedEmail;
    try { storedEmail = window.sessionStorage.getItem(storageKey); } catch { /* storage unavailable */ }
    const guestEmail = hashEmail || queryEmail || storedEmail || undefined;
    if (guestEmail) {
      try { window.sessionStorage.setItem(storageKey, guestEmail); } catch { /* storage unavailable */ }
    }
    if (window.location.search || window.location.hash) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    return startOrderUpdates({
      load: () => ordersApi.getByNumber(orderNumber, guestEmail),
      onOrder: (next) => { setOrder(next); setError(null); }, onError: setError, onLoaded: () => setLoading(false),
    });
  }, [orderNumber]);

  return (
    <>
      <Header />
      <main className="container-tight pt-32 pb-20 min-h-screen flex flex-col items-center" data-testid="order-success-page">
        {loading ? (
          <div className="flex items-center gap-2 text-neutral-400 py-12">
            <Loader2 size={16} className="animate-spin" />
            Loading order…
          </div>
        ) : error ? (
          <div className="glass rounded-2xl p-8 max-w-lg flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h1 className="font-semibold">Order not found</h1>
              <p className="text-[13px] text-neutral-400 mt-1">
                We couldn't find order <strong>{orderNumber}</strong>. Check your confirmation email.
              </p>
              <Link to="/shop" className="btn-primary mt-4 inline-flex">Browse memory</Link>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            {/* Status header */}
            {(() => {
              const { Icon, title, text, warn } = headline(order);
              return (
                <div className="text-center mb-10" data-testid="order-headline">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border ${warn ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                    <Icon size={32} className={warn ? 'text-amber-400' : 'text-emerald-400'} />
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
                  <p className="text-neutral-400 text-[14px] mt-2">{text}</p>
                  <div className="mono text-[13px] text-neutral-500 mt-2">
                    Order #{order.orderNumber}
                  </div>
                </div>
              );
            })()}

            {/* The review survey is for orders that are actually paid for. */}
            {order.paymentStatus === 'paid' && <GoogleCustomerReviewsOptIn order={order} />}

            {order.etransfer && (
              <div className="glass rounded-2xl p-6 mb-6" data-testid="etransfer-instructions">
                <h3 className="font-semibold tracking-tight text-[15px] mb-1">Send your Interac e-Transfer</h3>
                <p className="text-[13px] text-neutral-400 mb-3">In your banking app choose Interac e-Transfer, then send:</p>
                <CopyRow label="Send to" value={order.etransfer.recipientEmail} testId="et-recipient" />
                {differsFromContact(order.etransfer.recipientEmail) && (
                  <p className="text-[13px] text-amber-600 dark:text-amber-400 pb-2.5" role="note" data-testid="et-not-contact">
                    This is not our contact email. Send the e-Transfer only to the address above, not to {SUPPORT_EMAIL}: that inbox is for questions.
                  </p>
                )}
                <CopyRow label="Amount (exactly)" value={`$${Number(order.etransfer.amountDue).toFixed(2)} CAD`} copyValue={Number(order.etransfer.amountDue).toFixed(2)} testId="et-amount" />
                <CopyRow label="Message (optional, helps us match it)" value={order.etransfer.message} testId="et-message" />
                <p className="text-[13px] text-neutral-400 mt-3">
                  {order.etransfer.expiresAt ? <>Send it before <strong className="text-neutral-200">{torontoDeadline(order.etransfer.expiresAt)}</strong>, or the order is cancelled and the items go back on sale. </> : null}
                  The deposit is automatic: no security question or password. We check payments by hand during the day, then confirm by email. Only ever pay the address shown here.
                </p>
              </div>
            )}

            {/* Status tracker */}
            <div className="glass rounded-2xl p-6 mb-6">
              <div className="flex items-center justify-between relative">
                <div className="absolute left-0 right-0 top-4 h-px bg-white/8 -z-0" />
                {STATUS_STEPS.map((step, idx) => {
                  const currentIdx = STATUS_INDEX[order.status] ?? 0;
                  const done = idx <= currentIdx;
                  const active = idx === currentIdx;
                  return (
                    <div key={step.id} className="flex flex-col items-center gap-2 z-10">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                        done
                          ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-400'
                          : 'bg-white/3 border-white/10 text-neutral-600'
                      } ${active ? 'ring-2 ring-emerald-500/30' : ''}`}>
                        {done ? <CheckCircle size={14} /> : <div className="w-2 h-2 rounded-full bg-current" />}
                      </div>
                      <span className={`text-[11px] text-center ${done ? 'text-white' : 'text-neutral-600'}`}>
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <OrderTracking order={order} />
            </div>

            {/* Order items */}
            <div className="glass rounded-2xl p-6 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <Package size={15} className="text-neutral-400" />
                <h3 className="font-semibold tracking-tight text-[15px]">Items ordered</h3>
              </div>
              <div className="flex flex-col gap-3">
                {order.items?.map((item, idx) => (
                  <div key={idx} className="flex gap-3">
                    <div className="w-14 h-14 rounded-lg overflow-hidden bg-white/5 shrink-0">
                      {item.image && <img src={imageUrl(item.image, { width: 160 })} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />}
                    </div>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium">{item.name}</div>
                      <div className="mono text-[11px] text-neutral-500">{item.sku}</div>
                      <div className="text-[12px] text-neutral-400 mt-0.5">Qty: {item.qty}</div>
                    </div>
                    <div className="mono text-[13px]">${(item.price * item.qty).toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Shipping + Totals */}
            <div className="glass rounded-2xl p-6 mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Truck size={15} className="text-neutral-400" />
                <h3 className="font-semibold tracking-tight text-[15px]">Shipping details</h3>
              </div>
              <div className="grid md:grid-cols-2 gap-6 text-[13px]">
                <div>
                  <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-2">Ship to</div>
                  <div className="text-neutral-200 leading-relaxed">
                    {order.shippingAddress?.firstName} {order.shippingAddress?.lastName}<br />
                    {order.shippingAddress?.line1}<br />
                    {order.shippingAddress?.line2 && <>{order.shippingAddress.line2}<br /></>}
                    {order.shippingAddress?.city}, {order.shippingAddress?.state} {order.shippingAddress?.zip}<br />
                    {order.shippingAddress?.country}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-2">Summary</div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-neutral-400">Subtotal</span>
                      <span className="mono">${order.subtotal?.toFixed(2)}</span>
                    </div>
                    {order.discount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Discount</span>
                        <span className="mono">-${order.discount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-4">
                      <span className="text-neutral-400">Shipping
                        {order.shippingMethod && (
                          <span className="block text-[12px] leading-snug" data-testid="order-shipping-method">{order.importDuties > 0 ? order.shippingMethod.replace(/ \+ prepaid US import duties and fees$/, '') : order.shippingMethod}</span>
                        )}
                      </span>
                      <span className="mono shrink-0">{order.shippingCost === 0 ? 'Free' : `$${(order.importDuties > 0 ? Math.round((order.shippingCost - order.importDuties) * 100) / 100 : order.shippingCost)?.toFixed(2)}`}</span>
                    </div>
                    {order.importDuties > 0 && (
                      <div className="flex justify-between gap-4" data-testid="order-us-duties">
                        <span className="text-neutral-400">US import duties and fees
                          <span className="block text-[12px] leading-snug">Prepaid, nothing due on delivery</span>
                        </span>
                        <span className="mono shrink-0">${order.importDuties.toFixed(2)}</span>
                      </div>
                    )}
                    {order.tax > 0 && (
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Tax</span>
                        <span className="mono">${order.tax.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold">
                      <span>Total</span>
                      <span className="mono">${order.total?.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-center">
              {/* Guests check out without an account, so they have no order list to open. */}
              {isAuthenticated() && (
                <Link to="/account?tab=orders" className="btn-secondary">View all orders</Link>
              )}
              <Link to="/shop" className="btn-primary">Continue shopping</Link>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

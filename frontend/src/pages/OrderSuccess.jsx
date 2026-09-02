import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle, Package, Truck, Loader2, AlertTriangle } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { ordersApi } from '@/lib/api';
import GoogleCustomerReviewsOptIn from '@/components/GoogleCustomerReviewsOptIn';
import { imageUrl } from '@/lib/imageUrl';

const STATUS_STEPS = [
  { id: 'pending', label: 'Order placed' },
  { id: 'processing', label: 'Processing' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'delivered', label: 'Delivered' },
];

const STATUS_INDEX = { pending: 0, processing: 1, shipped: 2, delivered: 3 };

export default function OrderSuccess() {
  const { orderNumber } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orderNumber) return;
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
    ordersApi.getByNumber(orderNumber, guestEmail)
      .then(({ data }) => setOrder(data.order))
      .catch(() => setError('Order not found'))
      .finally(() => setLoading(false));
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
              <p className="font-semibold">Order not found</p>
              <p className="text-[13px] text-neutral-400 mt-1">
                We couldn't find order <strong>{orderNumber}</strong>. Check your confirmation email.
              </p>
              <Link to="/shop" className="btn-primary mt-4 inline-flex">Browse memory</Link>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            {/* Success header */}
            <div className="text-center mb-10">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={32} className="text-emerald-400" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Order confirmed!</h1>
              <p className="text-neutral-400 text-[14px] mt-2">
                Thank you for your order. A confirmation email has been sent to{' '}
                <strong>{order.user?.email || order.guestEmail}</strong>.
              </p>
              <div className="mono text-[13px] text-neutral-500 mt-2">
                Order #{order.orderNumber}
              </div>
            </div>

            <GoogleCustomerReviewsOptIn order={order} />

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
              {order.trackingNumber && (
                <div className="mt-4 pt-4 border-t border-white/5 text-[13px] text-neutral-400">
                  Tracking: <span className="mono text-white">{order.trackingNumber}</span>
                </div>
              )}
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
                    <div className="flex justify-between">
                      <span className="text-neutral-400">Shipping</span>
                      <span className="mono">{order.shippingCost === 0 ? 'Free' : `$${order.shippingCost?.toFixed(2)}`}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Total</span>
                      <span className="mono">${order.total?.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-center">
              <Link to="/account?tab=orders" className="btn-secondary">View all orders</Link>
              <Link to="/shop" className="btn-primary">Continue shopping</Link>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

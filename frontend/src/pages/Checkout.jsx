import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Loader2, ShieldCheck, Truck, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import useCartStore from '@/lib/cartStore';
import { stripeApi } from '@/lib/api';
import { useSEO } from '@/lib/seo';
import { imageUrl } from '@/lib/imageUrl';
import { formatStorePrice, STORE_CURRENCY_NAME } from '@/lib/currency';
import { ecommerceItem, trackEvent } from '@/lib/analytics';

// Checkout is handled by Stripe's hosted Checkout page:
// - Address collection restricted to Canada + United States, with the
//   country-appropriate form (Province/Postal code vs State/ZIP) rendered
//   by Stripe automatically
// - Phone number collection enabled
// - Stripe Tax applies Canadian provincial tax (HST/GST/PST); US orders are
//   untaxed until US registrations are added in the Stripe dashboard
// This page is a final order review + hand-off.

export default function Checkout() {
  useSEO({ title: 'Checkout — Reflexity RAM' });
  const { items, subtotal, itemCount, fetchCart, isLoading } = useCartStore();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => { fetchCart(); }, []);

  const startCheckout = async () => {
    setRedirecting(true);
    try {
      const { data } = await stripeApi.createCheckoutSession();
      trackEvent('checkout_redirect', {
        currency: 'CAD',
        value: Number(subtotal || 0),
        items: items.map((item) => ecommerceItem(item, item.qty)),
      });
      window.location.href = data.url; // hand off to Stripe's hosted checkout
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start checkout');
      setRedirecting(false);
    }
  };

  return (
    <>
      <Header />
      <main className="container-tight pt-28 pb-20 min-h-screen" data-testid="checkout-page">
        <h1 className="text-3xl font-bold tracking-tight mb-8">Checkout</h1>

        {isLoading ? (
          <div className="flex items-center gap-2 text-neutral-400 py-12">
            <Loader2 size={16} className="animate-spin" /> Loading your cart…
          </div>
        ) : items.length === 0 ? (
          <div className="glass rounded-2xl p-8 max-w-lg">
            <p className="font-semibold">Your cart is empty</p>
            <p className="text-[13px] text-neutral-400 mt-1">Add some memory before checking out.</p>
            <Link to="/shop" className="btn-primary mt-4 inline-flex">Browse memory</Link>
          </div>
        ) : (
          <div className="grid lg:grid-cols-5 gap-8 max-w-5xl mx-auto">
            {/* Order review */}
            <div className="lg:col-span-3 space-y-3">
              {items.map((item) => (
                <div key={item.slug} className="glass rounded-xl p-4 flex items-center gap-4">
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-white/5 shrink-0">
                    {item.image && <img src={imageUrl(item.image, { width: 160 })} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[14px] line-clamp-1">{item.name}</div>
                    <div className="text-[12px] text-neutral-500">Qty {item.qty}</div>
                  </div>
                  <div className="mono text-[14px]">{formatStorePrice(item.price * item.qty)}</div>
                </div>
              ))}
              <Link to="/cart" className="inline-block text-[13px] text-neutral-400 hover:text-white mt-1">
                ← Edit cart
              </Link>
            </div>

            {/* Summary + hand-off */}
            <div className="lg:col-span-2">
              <div className="glass rounded-2xl p-6 sticky top-24">
                <p className="text-[11px] text-neutral-500 mb-4">All prices and checkout charges are in {STORE_CURRENCY_NAME}.</p>
                <div className="space-y-2 text-[13px] mb-4">
                  <div className="flex justify-between">
                    <span className="text-neutral-400">Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'})</span>
                    <span className="mono">{formatStorePrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Shipping</span>
                    <span className="text-[11px]">Selected at checkout</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Tax</span>
                    <span className="text-[11px]">Calculated from your address</span>
                  </div>
                </div>

                <button
                  onClick={startCheckout}
                  disabled={redirecting}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                  data-testid="checkout-pay-btn"
                >
                  {redirecting
                    ? (<><Loader2 size={15} className="animate-spin" /> Opening secure checkout…</>)
                    : (<><Lock size={14} /> Continue to secure checkout <ArrowRight size={15} /></>)}
                </button>

                <div className="mt-5 space-y-2.5 text-[12px] text-neutral-500">
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={14} className="shrink-0 mt-0.5" />
                    <span>Payment, address, and tax handled securely by Stripe</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Truck size={14} className="shrink-0 mt-0.5" />
                    <span>Shipping to Canada and the United States</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

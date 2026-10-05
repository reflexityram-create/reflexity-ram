import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Loader2, ShieldCheck, Truck, ArrowRight, CreditCard, Package, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import useCartStore from '@/lib/cartStore';
import { stripeApi, shippingApi } from '@/lib/api';
import { useSEO } from '@/lib/seo';
import { imageUrl } from '@/lib/imageUrl';
import { formatStorePrice, STORE_CURRENCY_NAME } from '@/lib/currency';
import { ACCEPTED_PAYMENTS_SENTENCE } from '@/lib/payments';
import { ecommerceItem, readGaIdentifiers, trackEvent } from '@/lib/analytics';

// Checkout is handled by Stripe's hosted Checkout page:
// - Address collection restricted to Canada (Province/Postal code form
//   rendered by Stripe)
// - Phone number collection enabled
// - Stripe Tax applies Canadian provincial tax (HST/GST/PST)
// - The shipping shown here is the cart's flat rate from the cart API, the
//   same amount the server puts on the Stripe session
// This page is a final order review + hand-off.

export default function Checkout() {
  useSEO({ title: 'Checkout — Reflexity RAM' });
  const { items, subtotal, shipping, itemCount, fetchCart, isLoading } = useCartStore();
  const [redirecting, setRedirecting] = useState(false);
  // Outside Canada the buyer pays what Canada Post charges for their country.
  const [destination, setDestination] = useState('CA');
  const [countries, setCountries] = useState([]);
  const [country, setCountry] = useState('');
  const [quote, setQuote] = useState({ loading: false, options: [], error: '' });
  const [serviceCode, setServiceCode] = useState('');
  const international = destination === 'INTL';
  const chosen = quote.options.find((o) => o.serviceCode === serviceCode);
  const shippingAmount = international ? chosen?.price : shipping;
  const totalBeforeTax = Number(subtotal || 0) + Number(shippingAmount || 0);

  useEffect(() => { fetchCart(); }, []);

  useEffect(() => {
    if (!international || countries.length) return;
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    shippingApi.countries()
      .then(({ data }) => setCountries((data.countries || []).map((code) => ({ code, name: names.of(code) || code }))
        .sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setQuote((q) => ({ ...q, error: 'Could not load the country list.' })));
  }, [international]);

  const chooseCountry = async (code) => {
    setCountry(code);
    setServiceCode('');
    if (!code) return setQuote({ loading: false, options: [], error: '' });
    setQuote({ loading: true, options: [], error: '' });
    try {
      const { data } = await shippingApi.internationalQuote(code);
      setQuote({ loading: false, options: data.options, error: '' });
      setServiceCode(data.options[0]?.serviceCode || '');
    } catch (err) {
      setQuote({ loading: false, options: [], error: err.response?.data?.error || 'Could not get Canada Post prices right now.' });
    }
  };

  const startCheckout = async () => {
    setRedirecting(true);
    try {
      // Never blocks checkout: resolves {} when analytics is unavailable or blocked.
      const { data } = await stripeApi.createCheckoutSession(
        await readGaIdentifiers(),
        international ? { country, serviceCode } : undefined,
      );
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
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
          <p className="text-[15px] text-neutral-400 mt-2 mb-8">Review your order, then pay securely with Stripe.</p>

          {isLoading ? (
            <div className="flex items-center gap-2 text-neutral-400 py-12">
              <Loader2 size={16} className="animate-spin" /> Loading your cart…
            </div>
          ) : items.length === 0 ? (
            <div className="glass rounded-2xl p-8 max-w-lg">
              <p className="font-semibold">Your cart is empty</p>
              <p className="text-[14px] text-neutral-400 mt-1">Add some memory before checking out.</p>
              <Link to="/shop" className="btn-primary mt-4 inline-flex">Browse memory</Link>
            </div>
          ) : (
            <div className="grid lg:grid-cols-5 gap-6 lg:gap-8 items-start">
              {/* Order review */}
              <section className="lg:col-span-3 space-y-4" aria-labelledby="checkout-items-heading">
                <div className="glass rounded-2xl p-5 sm:p-6">
                  <div className="flex items-baseline justify-between gap-4 mb-2">
                    <h2 id="checkout-items-heading" className="text-lg font-semibold">Your order</h2>
                    <Link to="/cart" className="text-[14px] text-neutral-400 hover:underline underline-offset-4">Edit cart</Link>
                  </div>
                  <ul>
                    {items.map((item, index) => (
                      <li key={item.slug} className={`flex items-center gap-4 py-4 ${index ? 'border-t border-white/5' : ''}`}>
                        <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/5 shrink-0">
                          {item.image && <img src={imageUrl(item.image, { width: 240 })} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[15px] leading-snug line-clamp-2">{item.name}</div>
                          <div className="text-[14px] text-neutral-400 mt-1">{item.qty} × {formatStorePrice(item.price)}</div>
                        </div>
                        <div className="mono text-[15px] font-medium shrink-0">{formatStorePrice(item.price * item.qty)}</div>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Delivery and returns */}
                <div className="glass-soft rounded-2xl p-5 sm:p-6 grid sm:grid-cols-3 lg:grid-cols-1 gap-4">
                  <div className="flex items-start gap-3">
                    <Package size={18} className="shrink-0 mt-0.5 text-neutral-400" />
                    <div>
                      <div className="font-medium text-[14px]">Ships in 1–3 business days</div>
                      <div className="text-[13px] text-neutral-400">Tracked, from Toronto</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Truck size={18} className="shrink-0 mt-0.5 text-neutral-400" />
                    <div>
                      <div className="font-medium text-[14px]">{international
                        ? (chosen?.transitDays ? `Arrives about ${chosen.transitDays} business days later` : 'Delivery time depends on the service')
                        : 'Arrives 3–6 business days later'}</div>
                      <div className="text-[13px] text-neutral-400">{international ? 'Canada Post, tracked to your door' : 'Shipping within Canada'}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <RotateCcw size={18} className="shrink-0 mt-0.5 text-neutral-400" />
                    <div>
                      <div className="font-medium text-[14px]">30-day returns</div>
                      <Link to="/returns" className="text-[13px] text-neutral-400 hover:underline underline-offset-4">Returns policy</Link>
                    </div>
                  </div>
                </div>
              </section>

              {/* Summary + hand-off */}
              <aside className="lg:col-span-2" aria-labelledby="checkout-summary-heading">
                <div className="glass rounded-2xl p-6 lg:sticky lg:top-24">
                  <h2 id="checkout-summary-heading" className="text-lg font-semibold mb-4">Summary</h2>

                  <div className="mb-5" data-testid="checkout-ship-to">
                    <div className="text-[13px] text-neutral-400 mb-2">Ship to</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[['CA', 'Canada'], ['INTL', 'Another country']].map(([value, label]) => (
                        <button key={value} type="button" onClick={() => setDestination(value)}
                          className={`btn-secondary justify-center text-[14px] ${destination === value ? 'ring-2 ring-amber-300' : ''}`}
                          aria-pressed={destination === value}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {international && (
                      <div className="mt-3 space-y-3">
                        <select className="input" value={country} onChange={(e) => chooseCountry(e.target.value)} aria-label="Country" data-testid="checkout-country">
                          <option value="">Choose your country</option>
                          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                        </select>
                        <p className="text-[12px] text-neutral-500">
                          Shipping to the United States? <a href="mailto:reflexityram@gmail.com?subject=US%20order%20quote" className="underline underline-offset-4">Email us</a> for a quote.
                        </p>
                        {quote.loading && (
                          <div className="flex items-center gap-2 text-[13px] text-neutral-400"><Loader2 size={14} className="animate-spin" /> Getting Canada Post prices…</div>
                        )}
                        {quote.error && <p className="text-[13px] text-amber-500" role="alert">{quote.error}</p>}
                        {quote.options.length > 0 && (
                          <fieldset className="space-y-2" data-testid="checkout-shipping-options">
                            <legend className="text-[13px] text-neutral-400 mb-1">Canada Post service</legend>
                            {quote.options.map((o) => (
                              <label key={o.serviceCode} className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 cursor-pointer ${serviceCode === o.serviceCode ? 'border-amber-300' : 'border-white/10'}`}>
                                <span className="flex items-start gap-2.5">
                                  <input type="radio" name="service" className="mt-1" checked={serviceCode === o.serviceCode} onChange={() => setServiceCode(o.serviceCode)} />
                                  <span className="text-[14px]">{o.name}
                                    <span className="block text-[12px] text-neutral-500">{o.transitDays ? `About ${o.transitDays} business days` : 'Tracked'}{o.guaranteed ? ' · on-time guarantee' : ''}</span>
                                  </span>
                                </span>
                                <span className="mono text-[14px]">{formatStorePrice(o.price)}</span>
                              </label>
                            ))}
                            <p className="text-[12px] text-neutral-500">Import taxes and duties are charged by your country on delivery.</p>
                          </fieldset>
                        )}
                      </div>
                    )}
                  </div>

                  <dl className="space-y-3 text-[15px]">
                    <div className="flex justify-between gap-4">
                      <dt className="text-neutral-400">Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'})</dt>
                      <dd className="mono">{formatStorePrice(subtotal)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-neutral-400">Shipping <span className="block text-[13px]">{international
                        ? (chosen ? `Canada Post ${chosen.name}` : 'Choose a country and service')
                        : 'Canada Post, tracked: $14 for 1–2 sticks, $25 for 3 or more'}</span></dt>
                      <dd className="mono">{shippingAmount === undefined ? '—' : formatStorePrice(shippingAmount)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-neutral-400">Tax</dt>
                      <dd className="text-[14px] text-neutral-400 text-right">Added by Stripe from your address</dd>
                    </div>
                  </dl>
                  <div className="flex justify-between items-baseline gap-4 border-t border-white/10 mt-4 pt-4 mb-5">
                    <span className="font-semibold">Total before tax</span>
                    <span className="mono font-semibold text-[18px]">{formatStorePrice(totalBeforeTax)}</span>
                  </div>

                  <button
                    onClick={startCheckout}
                    disabled={redirecting || (international && !chosen)}
                    className="btn-primary w-full flex items-center justify-center gap-2 text-[15px]"
                    data-testid="checkout-pay-btn"
                  >
                    {redirecting
                      ? (<><Loader2 size={16} className="animate-spin" /> Opening secure checkout…</>)
                      : (<><Lock size={15} /> Continue to secure checkout <ArrowRight size={16} /></>)}
                  </button>
                  <p className="text-[12px] text-neutral-500 text-center mt-3">All prices are in {STORE_CURRENCY_NAME}.</p>

                  <div className="mt-5 space-y-3 text-[13px] text-neutral-400">
                    <div className="flex items-start gap-2.5">
                      <ShieldCheck size={16} className="shrink-0 mt-0.5" />
                      <span>Payment, address and tax handled securely by Stripe</span>
                    </div>
                    <div className="flex items-start gap-2.5" data-testid="checkout-payments">
                      <CreditCard size={16} className="shrink-0 mt-0.5" />
                      <span>{ACCEPTED_PAYMENTS_SENTENCE}</span>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

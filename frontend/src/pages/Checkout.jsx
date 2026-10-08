import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Loader2, ShieldCheck, Truck, ArrowRight, CreditCard, Package, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import useCartStore from '@/lib/cartStore';
import { stripeApi, shippingApi } from '@/lib/api';
import CountryPicker from '@/components/CountryPicker';
import { useSEO } from '@/lib/seo';
import { imageUrl } from '@/lib/imageUrl';
import { formatStorePrice, FASTER_SHIPPING_MAX_STICKS, SIGNATURE_PRICE, STORE_CURRENCY_NAME } from '@/lib/currency';
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

// One delivery speed inside Canada: a radio row with its wording and price.
function SpeedRow({ selected, onSelect, title, detail, price, testId }) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors" data-testid={testId}
      style={{ borderColor: selected ? 'var(--brand-yellow)' : 'var(--border-strong)', background: selected ? 'var(--input-bg-focus)' : 'transparent' }}>
      <span className="flex items-start gap-2.5">
        <input type="radio" name="delivery-speed" className="mt-1" checked={selected} onChange={onSelect} />
        <span className="text-[14px]">{title}
          <span className="block text-[12px] text-neutral-500">{detail}</span>
        </span>
      </span>
      <span className="mono text-[14px]">{formatStorePrice(price)}</span>
    </label>
  );
}

export default function Checkout() {
  useSEO({ title: 'Checkout — Reflexity RAM' });
  const { items, subtotal, shipping, shippingFaster, itemCount, fetchCart, isLoading } = useCartStore();
  const [redirecting, setRedirecting] = useState(false);
  // Outside Canada the buyer pays what Canada Post charges for their country.
  const [destination, setDestination] = useState('CA');
  const [countries, setCountries] = useState([]);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [country, setCountry] = useState('');
  // `duties` is set for the United States only: the prepaid import duties and fees (CAD) the server worked out with the shipping.
  const [quote, setQuote] = useState({ loading: false, options: [], error: '', duties: null });
  const [serviceCode, setServiceCode] = useState('');
  // Inside Canada the flat rate is the default. Two optional extras, both with fixed prices the server works out:
  // Faster shipping (Xpresspost, orders of up to 6 sticks) and a signature on delivery. Nothing to look up, nothing to type.
  const [faster, setFaster] = useState(false);
  const [signature, setSignature] = useState(false);
  const international = destination === 'INTL';
  const canFaster = Number.isFinite(shippingFaster);
  const useFaster = faster && canFaster;
  const chosen = quote.options.find((o) => o.serviceCode === serviceCode);
  const shippingAmount = international
    ? chosen?.price
    : (useFaster ? shippingFaster : Number(shipping || 0)) + (signature ? SIGNATURE_PRICE : 0);
  const dutiesAmount = international && country === 'US' ? Number(quote.duties?.amount || 0) : 0;
  const totalBeforeTax = Number(subtotal || 0) + Number(shippingAmount || 0) + dutiesAmount;

  useEffect(() => { fetchCart(); }, []);

  useEffect(() => {
    if (!international || countries.length) return;
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    setCountriesLoading(true);
    shippingApi.countries()
      .then(({ data }) => setCountries((data.countries || []).map((code) => ({ code, name: names.of(code) || code }))
        .sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setQuote((q) => ({ ...q, error: 'Could not load the country list.' })))
      .finally(() => setCountriesLoading(false));
  }, [international]);

  // Only the newest country's answer may land: a late one for the country the buyer already left would put its options and
  // service code next to another country's total (the server refuses that mismatch, but the page should never show it).
  const quoteRequestRef = useRef(0);
  const chooseCountry = async (code) => {
    const request = ++quoteRequestRef.current;
    setCountry(code);
    setServiceCode('');
    if (!code) return setQuote({ loading: false, options: [], error: '', duties: null });
    setQuote({ loading: true, options: [], error: '', duties: null });
    try {
      const { data } = await shippingApi.internationalQuote(code);
      if (request !== quoteRequestRef.current) return;
      setQuote({ loading: false, options: data.options, error: '', duties: data.duties || null });
      setServiceCode(data.options[0]?.serviceCode || '');
    } catch (err) {
      if (request !== quoteRequestRef.current) return;
      setQuote({ loading: false, options: [], error: err.response?.data?.error || 'Could not get Canada Post prices right now.', duties: null });
    }
  };

  const startCheckout = async () => {
    setRedirecting(true);
    try {
      // Never blocks checkout: resolves {} when analytics is unavailable or blocked.
      const { data } = await stripeApi.createCheckoutSession(
        await readGaIdentifiers(),
        international
          ? { country, serviceCode }
          : (useFaster || signature)
            ? { country: 'CA', faster: useFaster, signature }
            : undefined,
      );
      // Which delivery the buyer chose, for GA4's shipping_tier report (Standard, Faster, "Faster + signature", ...).
      const tier = international
        ? (chosen?.name || 'International')
        : `${useFaster ? 'Faster' : 'Standard'}${signature ? ' + signature' : ''}`;
      trackEvent('add_shipping_info', {
        currency: 'CAD',
        value: Number(subtotal || 0),
        shipping_tier: tier,
        items: items.map((item) => ecommerceItem(item, item.qty)),
      });
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
                        : useFaster
                          ? 'Arrives typically 1–3 business days later'
                          : 'Arrives 3–6 business days later'}</div>
                      <div className="text-[13px] text-neutral-400">{international
                        ? 'Canada Post, tracked to your door'
                        : useFaster ? `Canada Post Xpresspost, tracked${signature ? ', signature on delivery' : ''}` : `Shipping within Canada${signature ? ', signature on delivery' : ''}`}</div>
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
                        <CountryPicker
                          countries={countries}
                          loading={countriesLoading}
                          value={country}
                          onChange={chooseCountry}
                          unavailableNote="United States: orders are not open on the website yet, so email us for a quote."
                        />
                        <p className="text-[12px] text-neutral-500">
                          Shipping to a country not listed? <a href="mailto:reflexityram@gmail.com?subject=Shipping%20quote" className="underline underline-offset-4">Email us</a> for a quote.
                        </p>
                        {quote.loading && (
                          <div className="flex items-center gap-2 text-[13px] text-neutral-400"><Loader2 size={14} className="animate-spin" /> Getting Canada Post prices…</div>
                        )}
                        {quote.error && <p className="text-[13px] text-amber-500" role="alert">{quote.error}</p>}
                        {quote.options.length > 0 && (
                          <fieldset className="space-y-2" data-testid="checkout-shipping-options">
                            <legend className="text-[13px] text-neutral-400 mb-1">Canada Post service</legend>
                            {quote.options.map((o) => (
                              <label key={o.serviceCode} className="flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors"
                                style={{ borderColor: serviceCode === o.serviceCode ? 'var(--brand-yellow)' : 'var(--border-strong)', background: serviceCode === o.serviceCode ? 'var(--input-bg-focus)' : 'transparent' }}>
                                <span className="flex items-start gap-2.5">
                                  <input type="radio" name="service" className="mt-1" checked={serviceCode === o.serviceCode} onChange={() => setServiceCode(o.serviceCode)} />
                                  <span className="text-[14px]">{o.name}
                                    <span className="block text-[12px] text-neutral-500">{o.transitDays ? `About ${o.transitDays} business days` : 'Tracked'}{o.guaranteed ? ' · on-time guarantee' : ''}</span>
                                  </span>
                                </span>
                                <span className="mono text-[14px]">{formatStorePrice(o.price)}</span>
                              </label>
                            ))}
                            {country === 'US'
                              ? (
                                <p className="text-[12px] text-neutral-500" data-testid="checkout-us-duties-note">
                                  US import duties and customs fees are prepaid in your total, so nothing is due when the parcel arrives. US customs sets them; we pass them on at cost.
                                  Promotion codes cannot be used on US orders.
                                </p>
                              )
                              : <p className="text-[12px] text-neutral-500">Import taxes and duties are charged by your country on delivery.</p>}
                          </fieldset>
                        )}
                      </div>
                    )}
                    {!international && (
                      <div className="mt-3 space-y-3" data-testid="checkout-canada-delivery">
                        <fieldset className="space-y-2" data-testid="checkout-delivery-speed">
                          <legend className="text-[13px] text-neutral-400 mb-1">Shipping</legend>
                          <SpeedRow selected={!useFaster} onSelect={() => setFaster(false)} title="Standard"
                            detail="Canada Post, tracked · 3–6 business days after dispatch" price={Number(shipping || 0)} testId="checkout-speed-standard" />
                          {canFaster && (
                            <SpeedRow selected={useFaster} onSelect={() => setFaster(true)} title="Faster shipping"
                              detail="Canada Post Xpresspost, tracked · typically 1–3 business days after dispatch" price={shippingFaster} testId="checkout-speed-faster" />
                          )}
                        </fieldset>
                        {!canFaster && Number(itemCount) > FASTER_SHIPPING_MAX_STICKS && (
                          <p className="text-[12px] text-neutral-500" data-testid="checkout-faster-unavailable">
                            Faster shipping is not offered on orders of more than {FASTER_SHIPPING_MAX_STICKS} sticks.{' '}
                            <a href="mailto:reflexityram@gmail.com?subject=Faster%20shipping%20for%20a%20large%20order" className="underline underline-offset-4">Email us</a> if you need it sooner.
                          </p>
                        )}
                        <label className="flex items-start gap-2.5 text-[14px] cursor-pointer" data-testid="checkout-signature">
                          <input type="checkbox" className="mt-1" checked={signature} onChange={(e) => setSignature(e.target.checked)} />
                          <span>Signature required on delivery <span className="mono">+{formatStorePrice(SIGNATURE_PRICE)}</span>
                            <span className="block text-[12px] text-neutral-500">Someone has to sign for the parcel. Safer for a pricey module.</span>
                          </span>
                        </label>
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
                        : useFaster
                          ? `Canada Post Xpresspost${signature ? ' + signature' : ''}`
                          : signature
                            ? 'Canada Post, tracked, with signature on delivery'
                            : 'Canada Post, tracked: $14 for 1–2 sticks, $25 for 3 or more'}</span></dt>
                      <dd className="mono">{shippingAmount === undefined ? '—' : formatStorePrice(shippingAmount)}</dd>
                    </div>
                    {dutiesAmount > 0 && (
                      <div className="flex justify-between gap-4" data-testid="checkout-us-duties">
                        <dt className="text-neutral-400">US import duties and fees <span className="block text-[13px]">Prepaid, nothing due on delivery</span></dt>
                        <dd className="mono">{formatStorePrice(dutiesAmount)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-4">
                      <dt className="text-neutral-400">Tax</dt>
                      <dd className="text-[14px] text-neutral-400 text-right">Here at Reflexity, we don’t charge tax. Enjoy 🙂</dd>
                    </div>
                  </dl>
                  <div className="flex justify-between items-baseline gap-4 border-t border-white/10 mt-4 pt-4 mb-5">
                    <span className="font-semibold">Total</span>
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
                      <span>Payment and address handled securely by Stripe</span>
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

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Lock, ArrowRight, Clock, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import useCartStore from '@/lib/cartStore';
import useAuthStore from '@/lib/authStore';
import { paymentsApi } from '@/lib/api';
import { useSEO } from '@/lib/seo';
import { formatStorePrice, SIGNATURE_PRICE, STORE_CURRENCY_CODE } from '@/lib/currency';
import { ETRANSFER, PROVINCES, discountFor, etransferSizeProblem, normalizePostalCode, offeredMethods, validateEtransferForm } from '@/lib/paymentMethods';
import { ecommerceItem, readGaIdentifiers, trackEvent } from '@/lib/analytics';

// Pay by Interac e-Transfer. Stripe cannot take one, so this is the shop's own order form: the buyer gives a Canadian
// address, we save the order UNPAID with its items held, and we email the address and message to send the transfer to.
// The owner marks it received by hand, and only then does it ship. The server re-prices everything (the discount, the
// delivery choice, the stock): the figures on this page are a preview.

const EMPTY = { firstName: '', lastName: '', email: '', phone: '', line1: '', line2: '', city: '', state: 'ON', zip: '' };

// The delivery choice (Faster shipping, signature) comes from the checkout page, by navigation state or session storage.
function readDelivery(state) {
  if (state && typeof state === 'object') return { faster: state.faster === true, signature: state.signature === true };
  try {
    const saved = JSON.parse(window.sessionStorage.getItem('rfx_checkout_delivery') || 'null');
    if (saved && typeof saved === 'object') return { faster: saved.faster === true, signature: saved.signature === true };
  } catch { /* storage blocked */ }
  return { faster: false, signature: false };
}

function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] text-neutral-400 mb-1">{label}</span>
      {children}
      {error && <span className="block text-[12px] text-amber-500 mt-1" role="alert">{error}</span>}
    </label>
  );
}

export default function CheckoutEtransfer() {
  useSEO({ title: 'Pay by e-Transfer — Reflexity RAM' });
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const { items, subtotal, shipping, shippingFaster, itemCount, fetchCart, clearCartLocal, isLoading } = useCartStore();
  const [offer, setOffer] = useState(null);                  // the e-Transfer entry from the server, once known
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const delivery = useMemo(() => readDelivery(location.state), [location.state]);

  useEffect(() => { fetchCart(); }, []);
  useEffect(() => {
    paymentsApi.methods()
      .then(({ data }) => {
        const found = offeredMethods(data?.methods).find((m) => m.id === ETRANSFER);
        if (!found) { toast.error('Interac e-Transfer is not available right now.'); navigate('/checkout', { replace: true }); return; }
        setOffer(found);
      })
      .catch(() => { toast.error('Could not load payment options.'); navigate('/checkout', { replace: true }); });
  }, []);

  const canFaster = Number.isFinite(shippingFaster);
  const faster = delivery.faster && canFaster;
  const shippingAmount = (faster ? shippingFaster : Number(shipping || 0)) + (delivery.signature ? SIGNATURE_PRICE : 0);
  const discount = offer ? discountFor(subtotal, offer.discountPct) : 0;
  const hours = offer?.holdHours || 48;
  const total = Number(subtotal || 0) - discount + shippingAmount;
  // The server refuses an order over the shop's e-Transfer size limit; saying so here saves the buyer filling in the form.
  const sizeProblem = offer ? etransferSizeProblem({ units: Number(itemCount) || 0, total, maxUnits: offer.maxUnits, maxTotal: offer.maxTotal }, formatStorePrice) : '';

  const set = (name) => (event) => {
    setForm((f) => ({ ...f, [name]: event.target.value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const found = validateEtransferForm(form, { needsEmail: !user });
    setErrors(found);
    if (Object.keys(found).length) { toast.error('Check the highlighted fields.'); return; }
    if (!agreed) { toast.error('Please tick the box to confirm you will send the e-Transfer.'); return; }
    setSubmitting(true);
    try {
      const { data } = await paymentsApi.createEtransferOrder({
        buyer: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim(), ...(user ? {} : { email: form.email.trim() }) },
        address: { line1: form.line1.trim(), ...(form.line2.trim() ? { line2: form.line2.trim() } : {}), city: form.city.trim(), state: form.state, zip: normalizePostalCode(form.zip) },
        shipping: { faster, signature: delivery.signature },
        analytics: await readGaIdentifiers(),
        acceptTerms: true,
      });
      trackEvent('etransfer_order_placed', { currency: STORE_CURRENCY_CODE, value: data.total, items: items.map((item) => ecommerceItem(item, item.qty)) });
      clearCartLocal();
      navigate({ pathname: `/order/${data.orderNumber}`, hash: data.email ? `#email=${encodeURIComponent(data.email)}` : '' }, { replace: true });
    } catch (err) {
      const details = err.response?.data?.details;
      if (Array.isArray(details) && details.length) {
        setErrors(Object.fromEntries(details.map((d) => [String(d.field || '').split('.').pop(), d.message])));
        toast.error('Check the highlighted fields.');
      } else {
        toast.error(err.response?.data?.error || 'We could not place your order. Nothing was charged. Please try again.');
      }
      setSubmitting(false);
    }
  };

  if (isLoading && items.length === 0) {
    return (<><Header /><main className="container-tight pt-28 pb-20 min-h-screen"><div className="flex items-center gap-2 text-neutral-400 py-12"><Loader2 size={16} className="animate-spin" /> Loading your cart…</div></main><Footer /></>);
  }
  if (items.length === 0) {
    return (
      <>
        <Header />
        <main className="container-tight pt-28 pb-20 min-h-screen">
          <div className="glass rounded-2xl p-8 max-w-lg">
            <p className="font-semibold">Your cart is empty</p>
            <Link to="/shop" className="btn-primary mt-4 inline-flex">Browse memory</Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="container-tight pt-28 pb-20 min-h-screen" data-testid="etransfer-page">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold tracking-tight">Pay by Interac e-Transfer</h1>
          <p className="text-[15px] text-neutral-400 mt-2 mb-8">Place your order now, then send the e-Transfer from your own bank. We hold your items for {hours} hours and ship as soon as it arrives.</p>

          {sizeProblem && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 mb-6 text-[14px]" role="alert" data-testid="et-too-big">
              <p className="font-medium text-amber-700 dark:text-amber-300">This order is too big for e-Transfer.</p>
              <p className="text-neutral-400 mt-1">{sizeProblem} Pay by card instead, or <a href="mailto:reflexityram@gmail.com?subject=Large%20e-Transfer%20order" className="underline underline-offset-4">email us</a> and we will arrange it.</p>
              <Link to="/checkout" className="btn-primary mt-3 inline-flex">Back to checkout</Link>
            </div>
          )}

          <form onSubmit={submit} noValidate className="grid lg:grid-cols-5 gap-6 lg:gap-8 items-start">
            <section className="lg:col-span-3 glass rounded-2xl p-5 sm:p-6 space-y-4" aria-labelledby="etransfer-details-heading">
              <h2 id="etransfer-details-heading" className="text-lg font-semibold">Who is it for, and where does it go?</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="First name" error={errors.firstName}><input className="input" autoComplete="given-name" value={form.firstName} onChange={set('firstName')} aria-invalid={!!errors.firstName} data-testid="et-first-name" /></Field>
                <Field label="Last name" error={errors.lastName}><input className="input" autoComplete="family-name" value={form.lastName} onChange={set('lastName')} aria-invalid={!!errors.lastName} data-testid="et-last-name" /></Field>
              </div>
              {user ? (
                <p className="text-[13px] text-neutral-400">Order emails go to <strong className="text-neutral-200">{user.email}</strong>, the email of your account.</p>
              ) : (
                <Field label="Email (we send the e-Transfer details here)" error={errors.email}><input className="input" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set('email')} aria-invalid={!!errors.email} data-testid="et-email" /></Field>
              )}
              <Field label="Phone" error={errors.phone}><input className="input" type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={set('phone')} aria-invalid={!!errors.phone} data-testid="et-phone" /></Field>
              <Field label="Street address" error={errors.line1}><input className="input" autoComplete="address-line1" value={form.line1} onChange={set('line1')} aria-invalid={!!errors.line1} data-testid="et-line1" /></Field>
              <Field label="Apartment, suite (optional)"><input className="input" autoComplete="address-line2" value={form.line2} onChange={set('line2')} data-testid="et-line2" /></Field>
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="City" error={errors.city}><input className="input" autoComplete="address-level2" value={form.city} onChange={set('city')} aria-invalid={!!errors.city} data-testid="et-city" /></Field>
                <Field label="Province"><select className="input" autoComplete="address-level1" value={form.state} onChange={set('state')} data-testid="et-state">
                  {PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select></Field>
                <Field label="Postal code" error={errors.zip}><input className="input" autoComplete="postal-code" value={form.zip} onChange={set('zip')} aria-invalid={!!errors.zip} data-testid="et-zip" /></Field>
              </div>
              <p className="text-[12px] text-neutral-500">Shipping within Canada only. Pay by card if you ship anywhere else.</p>
            </section>

            <aside className="lg:col-span-2" aria-labelledby="etransfer-summary-heading">
              <div className="glass rounded-2xl p-6 lg:sticky lg:top-24">
                <h2 id="etransfer-summary-heading" className="text-lg font-semibold mb-4">Summary</h2>
                <dl className="space-y-3 text-[15px]">
                  <div className="flex justify-between gap-4">
                    <dt className="text-neutral-400">Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'})</dt>
                    <dd className="mono">{formatStorePrice(subtotal)}</dd>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between gap-4" data-testid="et-discount">
                      <dt className="text-neutral-400">Discount <span className="block text-[13px]">{offer.discountPct}% off the goods for paying by e-Transfer</span></dt>
                      <dd className="mono text-emerald-500">-{formatStorePrice(discount)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className="text-neutral-400">Shipping <span className="block text-[13px]">{faster ? 'Canada Post Xpresspost' : 'Canada Post, tracked'}{delivery.signature ? ', signature on delivery' : ''}</span></dt>
                    <dd className="mono">{formatStorePrice(shippingAmount)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-neutral-400">Tax</dt>
                    <dd className="text-[14px] text-neutral-400 text-right">Here at Reflexity, we don’t charge tax. Enjoy 🙂</dd>
                  </div>
                </dl>
                <div className="flex justify-between items-baseline gap-4 border-t border-white/10 mt-4 pt-4 mb-5">
                  <span className="font-semibold">You will send</span>
                  <span className="mono font-semibold text-[18px]" data-testid="et-total">{formatStorePrice(total)}</span>
                </div>

                <label className="flex items-start gap-2.5 text-[13px] cursor-pointer mb-4" data-testid="et-agree">
                  <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>I will send exactly this amount by Interac e-Transfer within {hours} hours. I understand the order is confirmed and shipped only once the shop has received it, and it is cancelled if not. I agree to the <Link to="/terms" target="_blank" className="underline underline-offset-4">Terms</Link>.</span>
                </label>

                <button type="submit" disabled={submitting || !offer || Boolean(sizeProblem)} className="btn-primary w-full flex items-center justify-center gap-2 text-[15px]" data-testid="et-place-order">
                  {submitting ? (<><Loader2 size={16} className="animate-spin" /> Placing your order…</>) : (<><Lock size={15} /> Place order <ArrowRight size={16} /></>)}
                </button>
                <p className="text-[12px] text-neutral-500 text-center mt-3">All prices are in Canadian dollars (CAD). Nothing is charged by us.</p>
                <div className="mt-5 space-y-3 text-[13px] text-neutral-400">
                  <div className="flex items-start gap-2.5"><Landmark size={16} className="shrink-0 mt-0.5" /><span>After you place the order we show, and email, the address and the message to use.</span></div>
                  <div className="flex items-start gap-2.5"><Clock size={16} className="shrink-0 mt-0.5" /><span>Your items are held for {hours} hours. We check payments by hand during the day.</span></div>
                </div>
              </div>
            </aside>
          </form>
        </div>
      </main>
      <Footer />
    </>
  );
}

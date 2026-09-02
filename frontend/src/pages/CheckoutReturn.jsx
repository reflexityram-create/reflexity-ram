import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, AlertTriangle } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import useCartStore from '@/lib/cartStore';
import { stripeApi } from '@/lib/api';
import { trackPurchaseOnce } from '@/lib/analytics';

// Landing page after Stripe Checkout (success_url → /order/success?session_id=...).
// Polls /stripe/session-status, which both verifies payment server-side and
// acts as a fulfillment fallback if the webhook hasn't landed yet. Once the
// order exists, redirects to the regular order confirmation page.

const MAX_ATTEMPTS = 10;
const POLL_MS = 1500;

export default function CheckoutReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { clearCartLocal } = useCartStore();
  const [error, setError] = useState(null);
  const attempts = useRef(0);

  const checkoutSessionId = searchParams.get('session_id');

  useEffect(() => {
    if (!checkoutSessionId) {
      setError('Missing checkout session.');
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const { data } = await stripeApi.sessionStatus(checkoutSessionId);
        if (cancelled) return;

        if (data.status === 'complete' && data.orderNumber) {
          trackPurchaseOnce(data);
          clearCartLocal();
          const emailParam = data.email ? `?email=${encodeURIComponent(data.email)}` : '';
          navigate(`/order/${data.orderNumber}${emailParam}`, { replace: true });
          return;
        }

        attempts.current += 1;
        if (attempts.current >= MAX_ATTEMPTS) {
          setError(
            "Your payment is still being confirmed. If you completed payment, you'll receive a confirmation email shortly — no need to pay again."
          );
          return;
        }
        setTimeout(poll, POLL_MS);
      } catch {
        if (!cancelled) setError('Could not verify your payment. If you were charged, check your email for confirmation.');
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [checkoutSessionId]);

  return (
    <>
      <Header />
      <main className="container-tight pt-32 pb-20 min-h-screen flex flex-col items-center justify-start">
        {error ? (
          <div className="glass rounded-2xl p-8 max-w-lg flex items-start gap-3 mt-12">
            <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Confirmation pending</p>
              <p className="text-[13px] text-neutral-400 mt-1">{error}</p>
              <Link to="/shop" className="btn-primary mt-4 inline-flex">Back to shop</Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 mt-24 text-neutral-300">
            <Loader2 size={24} className="animate-spin" />
            <p className="text-[14px]">Confirming your payment…</p>
            <p className="text-[12px] text-neutral-500">Don't close this page.</p>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

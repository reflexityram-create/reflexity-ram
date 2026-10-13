import { useState } from 'react';
import { ExternalLink, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/api';
import { METHOD_NAMES, TONE_CLASS, paymentState, stripePaymentUrl } from '@/lib/orderPayment';
import { torontoDeadline } from '@/lib/paymentMethods';
import ConfirmButton from '@/components/admin/ConfirmButton';

const money = (value) => `$${Number(value || 0).toFixed(2)} CAD`;
const when = (value) => (value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

// Everything about how this order was (or is to be) paid. For an Interac e-Transfer order it is where the owner says "the
// money arrived": nothing ships before that. Card orders that are simply paid show nothing here.
export default function PaymentPanel({ order, onChanged }) {
  const state = paymentState(order);
  const method = order.paymentMethod || 'stripe';
  const [amount, setAmount] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [note, setNote] = useState('');
  const [different, setDifferent] = useState(false);
  const [mismatch, setMismatch] = useState('');
  const [busy, setBusy] = useState(false);
  const [refundNote, setRefundNote] = useState('');
  if (method === 'stripe' && state.key === 'paid') return null;

  const et = order.etransfer || {};
  const waiting = state.key === 'etransfer_waiting' || state.key === 'etransfer_expired';

  const entered = Number(amount);
  const amountOk = Number.isFinite(entered) && entered > 0;
  const due = Number(et.amountDue ?? order.total);
  // The page asks once, in the page itself (a browser dialog does not show inside the phone app's web view).
  const confirmText = entered === due
    ? `Mark ${money(entered)} as received? The order becomes paid and ready to ship, and the buyer gets a confirmation email.`
    : `You are accepting ${money(entered)} for an order of ${money(due)}. Continue?`;

  const markReceived = async () => {
    if (!amountOk) { toast.error('Enter the amount you received.'); return; }
    setBusy(true);
    setMismatch('');
    try {
      await adminApi.markEtransferReceived(order._id, {
        amount: entered,
        ...(confirmation.trim() ? { confirmation: confirmation.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(different ? { acceptDifferentAmount: true } : {}),
      });
      toast.success('Payment recorded. The order is ready to ship.');
      setAmount(''); setConfirmation(''); setNote(''); setDifferent(false);
      await onChanged();
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'AMOUNT_MISMATCH') setMismatch(data.error);
      else toast.error(data?.error || 'Could not record the payment');
    } finally { setBusy(false); }
  };

  const refund = async () => {
    setBusy(true);
    try {
      await adminApi.refundEtransfer(order._id, refundNote.trim() ? { note: refundNote.trim() } : {});
      toast.success('Refund recorded');
      setRefundNote('');
      await onChanged();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not record the refund'); }
    finally { setBusy(false); }
  };

  return (
    <div className="glass rounded-xl p-4 text-[13px]" data-testid="payment-panel">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-neutral-500 text-[11px] uppercase tracking-widest flex items-center gap-1.5"><Landmark size={11} /> Payment</div>
        <span className={`pill ${TONE_CLASS[state.tone]} text-[10px] py-0.5`} data-testid="payment-state">{state.label}</span>
      </div>
      <div className="text-neutral-300">{METHOD_NAMES[method] || method}{order.paymentDiscountPct > 0 ? ` · ${order.paymentDiscountPct}% discount on the goods` : ''}</div>

      {state.key === 'bank_debit_clearing' && (
        <div className="mt-3 text-neutral-300 space-y-1" data-testid="bank-debit-note">
          <p className="text-amber-700 dark:text-amber-300 font-medium">The bank is still clearing this debit (up to 5 business days). Do not ship yet.</p>
          <p className="text-neutral-400">It turns paid by itself when Stripe confirms, and you get an alert. If it fails, the order is cancelled and the stock goes back.</p>
          {stripePaymentUrl(order) && <a className="inline-flex items-center gap-1 underline underline-offset-4 text-neutral-300" href={stripePaymentUrl(order)} target="_blank" rel="noopener noreferrer">See it in Stripe <ExternalLink size={12} /></a>}
        </div>
      )}

      {waiting && (
        <div className="mt-3 space-y-3" data-testid="etransfer-waiting">
          <div className="text-neutral-300 leading-relaxed">
            Expecting <strong className="text-white">{money(et.amountDue ?? order.total)}</strong> to <span className="mono">{et.recipientEmail}</span>, message <span className="mono">{order.orderNumber}</span>.
            {state.key === 'etransfer_waiting' && et.expiresAt && <> Held until {torontoDeadline(et.expiresAt)}.</>}
            {state.key === 'etransfer_expired' && <> The hold ended {when(et.expiredAt)} and the stock went back on sale. If the money did arrive, enter it below: the order comes back if the stock is still there.</>}
          </div>
          <div className="text-neutral-400" data-testid="et-sender-hint">
            The transfer should come from <strong className="text-neutral-200">{[order.shippingAddress?.firstName, order.shippingAddress?.lastName].filter(Boolean).join(' ') || 'the buyer'}</strong>.
            {' '}If the sender is someone else, check with the buyer before you ship.
          </div>
          <form onSubmit={(event) => event.preventDefault()} className="space-y-2">
            <label className="block"><span className="admin-label">Amount you received (CAD)</span>
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setMismatch(''); }} placeholder={Number(et.amountDue ?? order.total).toFixed(2)} data-testid="et-received-amount" />
            </label>
            <input className="input" placeholder="Bank confirmation number (optional)" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} maxLength={60} />
            {mismatch && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2" role="alert" data-testid="et-mismatch">
                <p className="text-amber-700 dark:text-amber-300">{mismatch}</p>
                <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" className="mt-1" checked={different} onChange={(e) => setDifferent(e.target.checked)} /><span>Accept this amount anyway</span></label>
                <input className="input" placeholder="Why the amount differs (required)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              </div>
            )}
            <ConfirmButton
              label="I received this e-Transfer"
              confirmLabel="Yes, mark it paid"
              message={confirmText}
              onConfirm={markReceived}
              disabled={!amountOk}
              busy={busy}
              className="w-full sm:w-auto"
              testId="et-mark-received"
            />
            <p className="text-[12px] text-neutral-500">Check your bank first. This is what makes the order paid and shippable.</p>
          </form>
        </div>
      )}

      {method === 'etransfer' && state.key === 'paid' && (
        <div className="mt-3 space-y-2 text-neutral-400" data-testid="etransfer-paid">
          <div>Received {when(et.receivedAt)}: {money(et.receivedAmount ?? order.total)}{et.confirmation ? ` · bank ref ${et.confirmation}` : ''}</div>
          <div className="flex flex-wrap gap-2 items-center">
            <input className="input flex-1 min-w-[10rem]" placeholder="Refund note (optional)" value={refundNote} onChange={(e) => setRefundNote(e.target.value)} maxLength={300} />
            <ConfirmButton
              variant="danger"
              label="Record a refund"
              confirmLabel="Yes, record the refund"
              message="Record this e-Transfer order as refunded? Send the money back by e-Transfer first: this does not send anything."
              onConfirm={refund}
              busy={busy}
              testId="et-refund"
            />
          </div>
        </div>
      )}

      {state.key === 'failed' && <p className="mt-3 text-red-500">The payment failed, so the order was cancelled and its stock returned.</p>}
    </div>
  );
}

import { ExternalLink } from 'lucide-react';
import { disputeState, stripeDisputeUrl } from '@/lib/orderPayment';

const BOX = {
  bad: 'border-red-500/40 bg-red-500/5',
  warn: 'border-amber-500/40 bg-amber-500/5',
  ok: 'border-emerald-500/30 bg-emerald-500/5',
  muted: 'border-white/10 bg-white/2',
};

// The top of an order that has a dispute: what the bank said, what Stripe did with the money, the deadline, and what to do with
// the parcel. Evidence is sent in Stripe; this page only makes sure the owner cannot miss it.
export default function DisputeBox({ order }) {
  const dispute = disputeState(order);
  if (!dispute) return null;
  const link = stripeDisputeUrl(order);
  return (
    <div className={`rounded-xl p-4 text-[13px] border ${BOX[dispute.tone] || BOX.muted}`} role={dispute.needsYou ? 'alert' : 'note'} data-testid="order-dispute" data-dispute-state={dispute.key}>
      <div className="text-red-700 dark:text-red-300 text-[11px] uppercase tracking-widest mb-2">{dispute.key === 'won' || dispute.key === 'prevented' || dispute.key === 'inquiry_closed' ? 'Dispute' : 'Needs a look: dispute'}</div>
      <p className="font-medium text-neutral-100 leading-relaxed break-words">{dispute.headline}</p>
      <p className="mt-1.5 text-neutral-300 leading-relaxed break-words">{dispute.text}</p>
      {link && <a className="mt-2 inline-flex items-center gap-1 underline underline-offset-4 text-neutral-300 min-h-6" href={link} target="_blank" rel="noopener noreferrer">Open it in Stripe <ExternalLink size={12} /></a>}
    </div>
  );
}

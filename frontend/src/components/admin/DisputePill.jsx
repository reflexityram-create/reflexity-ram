import { DISPUTE_PILL_CLASS, disputeState } from '@/lib/orderPayment';

// "Disputed" beside an order's other labels, wherever the owner sees orders in a list. Nothing for an order with no dispute.
export default function DisputePill({ order, className = '' }) {
  const dispute = disputeState(order);
  if (!dispute) return null;
  return <span className={`pill ${DISPUTE_PILL_CLASS[dispute.tone] || ''} text-[10px] py-0.5 ${className}`.trim()} data-testid="order-dispute-label">{dispute.label}</span>;
}

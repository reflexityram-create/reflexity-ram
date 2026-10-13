import { useState } from 'react';
import { ExternalLink, PackageCheck, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/api';
import { BUYER_EMAIL, canCancel, shipEmailLine, shipRequest } from '@/lib/adminOrders';
import ConfirmButton from '@/components/admin/ConfirmButton';
import PaymentPanel from '@/components/admin/PaymentPanel';

const Heading = ({ icon: Icon, children }) => (
  <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-3 flex items-center gap-1.5">
    {Icon && <Icon size={12} />} {children}
  </div>
);

const when = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

// What the owner can do next with an order, one clear card for it: collect the money (e-Transfer), ship it, mark it delivered,
// or cancel an unpaid one. Every button that changes something asks once, in the page, and says what the buyer is emailed.
export default function OrderActions({ order, step, onChanged }) {
  const [busy, setBusy] = useState('');

  // One status change. The server's answer is a plain order (no shipping panel), so the caller reads the order again.
  const changeStatus = async (payload, doneMessage) => {
    setBusy(payload.status);
    try {
      const { data } = await adminApi.updateOrderStatus(order._id, payload);
      await onChanged(data.order);
      const notice = data.shippingNotification;
      if (notice?.status === 'failed' || notice?.status === 'skipped') toast.warning(notice.message);
      else toast.success(notice?.status === 'sent' ? `${doneMessage} The buyer was emailed.` : doneMessage);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed');
    } finally {
      setBusy('');
    }
  };

  const cancelButton = canCancel(order) && (
    <ConfirmButton
      variant="danger"
      label="Cancel this order"
      confirmLabel="Yes, cancel it"
      message={`Cancel ${order.orderNumber} and put its items back in stock? ${BUYER_EMAIL.cancel} The buyer is not told.`}
      busy={busy === 'cancelled'}
      onConfirm={() => changeStatus({ status: 'cancelled', note: 'Cancelled by the owner' }, 'Order cancelled and its stock put back.')}
      className="w-full sm:w-auto"
      testId="order-cancel"
    />
  );

  if (step.key === 'collect' || step.key === 'clearing') {
    return (
      <div className="space-y-3" data-testid="order-next-pay">
        <PaymentPanel order={order} onChanged={() => onChanged()} />
        {cancelButton}
      </div>
    );
  }

  if (step.key === 'ship') return <ShipCard order={order} busy={busy} changeStatus={changeStatus} onChanged={onChanged} />;

  if (step.key === 'deliver') {
    const tracked = Boolean(order.trackingNumber);
    return (
      <section className="glass rounded-xl p-4 space-y-3 text-[13px]" data-testid="order-next-deliver">
        <Heading icon={Truck}>Shipped {when(order.shippedAt)}</Heading>
        {tracked ? (
          <div>
            Tracking <span className="mono text-white break-all">{order.trackingNumber}</span>
            {order.trackingUrl && (
              <a className="ml-2 inline-flex items-center gap-1 underline underline-offset-4" href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Track <ExternalLink size={12} /></a>
            )}
            {order.trackingLatest?.description && <div className="mt-1 text-neutral-400">{order.trackingLatest.description}</div>}
          </div>
        ) : (
          <div className="text-neutral-300">{order.untracked ? 'Sent without a tracking number.' : 'No tracking number was saved.'}</div>
        )}
        <ConfirmButton
          label="Mark as delivered"
          confirmLabel="Yes, it arrived"
          message={`Mark ${order.orderNumber} as delivered? ${BUYER_EMAIL.deliver}`}
          busy={busy === 'delivered'}
          onConfirm={() => changeStatus({ status: 'delivered' }, 'Marked as delivered.')}
          className="w-full sm:w-auto"
          testId="order-deliver"
        />
      </section>
    );
  }

  if (step.key === 'unpaid') {
    return (
      <section className="glass rounded-xl p-4 space-y-3 text-[13px]" data-testid="order-next-unpaid">
        <p className="text-neutral-300">This order is not paid, so it cannot be shipped.</p>
        {cancelButton}
      </section>
    );
  }

  if (step.key === 'done') return <p className="text-[13px] text-neutral-400" data-testid="order-next-done">Delivered {when(order.deliveredAt)}. Nothing more to do.</p>;
  if (step.key === 'closed') return <p className="text-[13px] text-neutral-400" data-testid="order-next-closed">This order is closed. Nothing more to do.</p>;
  return null;
}

// Ship it: a tracking number, or "no tracking number" when the parcel goes untracked. The buyer is emailed the moment it is marked.
function ShipCard({ order, busy, changeStatus, onChanged }) {
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber || '');
  const [noTracking, setNoTracking] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // Ticking "no tracking number" means no number goes out, even if one was typed before.
  const number = noTracking ? '' : trackingNumber;
  const request = shipRequest({ trackingNumber: number, noTracking, note });
  const emailLine = shipEmailLine({ trackingNumber: number, noTracking });
  // A new number can be saved on its own; the site then follows the parcel (see "tracking sync" in the docs).
  const canLetCanadaPostDoIt = number.trim() !== '' && number.trim() !== String(order.trackingNumber || '').trim();

  // Keeps the order where it is: Canada Post moves it to Shipped (and emails the buyer) when it scans the parcel.
  const saveTracking = async () => {
    setSaving(true);
    try {
      const { data } = await adminApi.updateOrderTracking(order._id, trackingNumber.trim());
      await onChanged(data.order);
      toast.success('Tracking saved. Status updates after Canada Post accepts the parcel.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Tracking could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass rounded-xl p-4 space-y-3 text-[13px]" data-testid="order-next-ship">
      <Heading icon={PackageCheck}>Next: ship it</Heading>
      <label className="block">
        <span className="admin-label">Tracking number</span>
        <input
          className="input"
          value={number}
          onChange={(event) => setTrackingNumber(event.target.value)}
          disabled={noTracking}
          placeholder={noTracking ? 'Sending without tracking' : 'Canada Post tracking number'}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={100}
          data-testid="order-tracking-input"
        />
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0"
          checked={noTracking}
          onChange={(event) => { setNoTracking(event.target.checked); if (event.target.checked) setTrackingNumber(''); }}
          data-testid="order-no-tracking"
        />
        <span>No tracking number (it goes untracked)</span>
      </label>
      {order.trackingNumber && (
        <div className="rounded-xl border p-3 text-neutral-300" style={{ borderColor: 'var(--border-strong)' }} data-testid="order-tracking-saved">
          Tracking <span className="mono text-white break-all">{order.trackingNumber}</span> is saved. The site marks this order shipped when Canada Post first scans the
          parcel, emails the buyer then, and marks it delivered by itself.
          {order.trackingLatest?.checkedAt
            ? ` Last checked ${new Date(order.trackingLatest.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${order.trackingLatest.description ? `: ${order.trackingLatest.description}` : ', no scan yet'}.`
            : ' Not checked yet.'}
        </div>
      )}
      <p className="text-neutral-400" data-testid="order-ship-email-line">{emailLine}</p>
      <ConfirmButton
        label="Mark as shipped"
        confirmLabel="Yes, mark shipped"
        message={`Mark ${order.orderNumber} as shipped${noTracking ? ' without tracking' : ''}? ${emailLine}`}
        disabled={!request.ok}
        busy={busy === 'shipped'}
        onConfirm={() => {
          if (!request.ok) { toast.error(request.error); return Promise.resolve(); }
          return changeStatus(request.payload, 'Marked as shipped.');
        }}
        className="w-full"
        testId="order-ship"
      />
      {canLetCanadaPostDoIt && (
        <div className="space-y-2" data-testid="order-let-canada-post">
          <button type="button" onClick={saveTracking} disabled={saving} className="btn-secondary min-h-11 w-full" data-testid="order-save-tracking">
            Save the number, let Canada Post mark it shipped
          </button>
          <p className="text-[12px] text-neutral-400">
            The order stays as it is until Canada Post scans the parcel (the site looks every 15 minutes). Then it becomes Shipped, the buyer is emailed,
            and it is marked Delivered by itself.
          </p>
        </div>
      )}
      <details className="text-neutral-400">
        <summary className="min-h-11 cursor-pointer py-2">More options</summary>
        <div className="pb-1">
          <label className="block">
            <span className="admin-label">Note on the order (optional, only you see it)</span>
            <input className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
          </label>
        </div>
      </details>
    </section>
  );
}

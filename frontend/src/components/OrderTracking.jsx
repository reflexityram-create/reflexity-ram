import { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';

export default function OrderTracking({ order }) {
  const [copyState, setCopyState] = useState('');
  const scan = order.trackingLatest;
  useEffect(() => setCopyState(''), [order.trackingNumber]);
  const scanDay = scan?.date ? new Date(`${scan.date}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  const scanClock = scan?.time ? new Date(`2000-01-01T${scan.time}Z`).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(order.trackingNumber); setCopyState('copied'); }
    catch { setCopyState('failed'); }
  };
  if (!order.trackingNumber) return null;
  return (
    <div className="mt-4 pt-4 border-t border-white/5 text-[13px]" data-testid="order-tracking">
      <p className="text-neutral-400 mb-1">Canada Post tracking</p>
      <p className="mono text-white break-all select-all">{order.trackingNumber}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" onClick={copy} className="btn-secondary min-h-11" aria-label="Copy tracking number">
          {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
          {copyState === 'copied' ? 'Copied' : 'Copy number'}
        </button>
        {order.trackingUrl && <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-11">
          Track on Canada Post <ExternalLink size={14} />
        </a>}
      </div>
      <span className="sr-only" role="status">{copyState === 'copied' ? 'Tracking number copied' : ''}</span>
      {copyState === 'failed' && <p role="status" className="mt-2 text-neutral-400">Select the number above to copy it, or use the Canada Post link.</p>}
      {scan?.description ? <div className="mt-4 text-neutral-400" data-testid="order-tracking-latest">
        <p className="text-white font-medium">{scan.description}</p>
        <p className="mt-1">{scanDay}{scanClock && ` at ${scanClock}${scan.timeZone ? ` ${scan.timeZone}` : ''}`}</p>
        {scan.location && <p>{scan.location}</p>}
      </div> : <p className="mt-4 text-neutral-400">Waiting for Canada Post’s first scan. Creating a label does not mean the parcel has shipped.</p>}
      {scan?.checkedAt && <p className="mt-3 text-[11px] text-neutral-500">Last checked {new Date(scan.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. Carrier updates are checked periodically.</p>}
    </div>
  );
}

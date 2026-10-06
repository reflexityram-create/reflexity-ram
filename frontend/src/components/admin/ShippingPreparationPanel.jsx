import { useState } from 'react';
import { Clipboard, ExternalLink, Truck } from 'lucide-react';
import { toast } from 'sonner';

const money = (value) => `CAD $${Number(value || 0).toFixed(2)}`;

export default function ShippingPreparationPanel({ preparation }) {
  const [copied, setCopied] = useState(false);
  if (!preparation) return null;
  const address = preparation.recipient || {};
  const service = preparation.service || {};
  const customs = preparation.customs || { required: false, lines: [] };
  const fulfillment = preparation.fulfillment || {};

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preparation.copyText || '');
      setCopied(true);
      toast.success('Shipping details copied');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy shipping details');
    }
  };

  return (
    <div className="glass rounded-xl p-4 text-[13px]" data-testid="shipping-preparation-panel">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-neutral-500 text-[11px] uppercase tracking-widest flex items-center gap-1.5">
          <Truck size={11} /> Shipping preparation
        </div>
        <span className={`pill text-[10px] py-0.5 ${fulfillment.canCreateLabel ? 'pill-accent' : 'text-neutral-500'}`}>
          {fulfillment.canCreateLabel ? 'Ready to prepare' : 'Reference only'}
        </span>
      </div>
      {!fulfillment.canCreateLabel && fulfillment.reason && (
        <div className="text-amber-700 dark:text-amber-300 text-[12px] mb-3">{fulfillment.reason}</div>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-1">Service</div>
          <div>{service.name || 'Service not recorded'}{service.signature ? ' + signature' : ''}</div>
          {service.recordedMethod && service.recordedMethod.toLowerCase() !== String(service.name || '').toLowerCase() && (
            <div className="text-neutral-500 text-[11px] mt-1 break-words">Recorded at checkout: {service.recordedMethod}</div>
          )}
        </div>
        <div>
          <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-1">Recipient</div>
          <div className="text-neutral-300 leading-relaxed">
            {address.fullName}<br />
            {address.line1}{address.line2 && <><br />{address.line2}</>}<br />
            {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}<br />
            {address.country}
          </div>
        </div>
      </div>
      {customs.required && (
        <div className="mt-4">
          <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-2">Customs lines</div>
          <div className="space-y-2">
            {(customs.lines || []).map((line) => (
              <div key={`${line.sku}-${line.name}`} className="border border-white/5 rounded-lg p-2.5 text-[12px] min-w-0">
                <div className="flex items-start justify-between gap-3 min-w-0"><span className="min-w-0 break-words">{line.qty} × {line.name}</span><span className="mono shrink-0 whitespace-nowrap">{money(line.unitValueCAD)} each</span></div>
                <div className="text-neutral-500 mt-1 break-words">
                  Origin: {line.countryOfOrigin || 'missing'} · HS: {line.hsCode || 'missing'}
                  {(!line.countryOfOrigin || !line.hsCode) && line.productId && (
                    <> · <a className="text-[#8a5a00] dark:text-[#ffcf24] hover:underline" href={`/admin/products?edit=${encodeURIComponent(line.productId)}`}>Edit product</a></>
                  )}
                </div>
                {!line.productFound && <div className="text-amber-700 dark:text-amber-300 mt-1">Current product record not found; verify before creating a label.</div>}
                {line.productFound && !line.productActive && <div className="text-amber-700 dark:text-amber-300 mt-1">Product is inactive; order snapshot is retained.</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-4">
        <button type="button" onClick={copy} className="btn-ghost flex items-center gap-1.5 text-[12px]">
          <Clipboard size={13} /> {copied ? 'Copied' : 'Copy shipping details'}
        </button>
        <a className="btn-ghost flex items-center gap-1.5 text-[12px]" href={preparation.links?.snapShip} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> Open Canada Post
        </a>
      </div>
      <div className="text-neutral-400 text-[11px] mt-3">Preparation only. No label has been purchased or created here.</div>
    </div>
  );
}

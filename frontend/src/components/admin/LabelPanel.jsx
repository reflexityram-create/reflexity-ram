import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clipboard, FileText, Loader2, RefreshCw, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/api';
import {
  arrivalNote, detailsOf, explainPurchaseError, initialChoice, labelStage, money, panelVisible, priceOf, purchaseRequest, signatureNote, withRequote,
} from '@/lib/labelPurchase';

// Buying a Canada Post label from the order. Prices are read-only; the ONLY thing that spends money is the confirm
// button in the last step, which sends the option and the exact price on screen. Nothing here runs by itself.
export default function LabelPanel({ order, onChanged }) {
  const stage = labelStage(order);
  const [step, setStep] = useState('closed'); // closed | loading | choosing | confirming | buying | checking
  const [payload, setPayload] = useState(null);
  const [choice, setChoice] = useState({ serviceCode: null, signature: false });
  const [notice, setNotice] = useState(null); // { tone: 'error' | 'warn' | 'info', text }
  const [opening, setOpening] = useState(false);
  const confirmRef = useRef(null);
  const reviewRef = useRef(null);
  const purchasing = useRef(false); // a second click while the first purchase is in flight is ignored here, before the server's own guard
  const orderId = order?._id;

  // A different order starts the panel over, and so does a changed label state: no price is carried from one to the other.
  // (The message is kept across a label-state change, so an error that arrives together with a reload stays visible.)
  useEffect(() => { setNotice(null); }, [orderId]);
  useEffect(() => {
    setStep('closed'); setPayload(null); setChoice({ serviceCode: null, signature: false });
  }, [orderId, order?.label?.status]);

  useEffect(() => { if (step === 'confirming') confirmRef.current?.focus(); }, [step]);

  if (!order || !panelVisible(order)) return null;

  const option = payload?.options?.find((o) => o.serviceCode === choice.serviceCode) || null;
  const due = priceOf(option, choice.signature);
  const details = detailsOf(option, choice.signature);
  const busy = step === 'loading' || step === 'buying' || step === 'checking';
  const address = order.shippingAddress || {};

  const loadOptions = async () => {
    setStep('loading'); setNotice(null);
    try {
      const { data } = await adminApi.getLabelOptions(orderId);
      setPayload(data.options);
      setChoice(initialChoice(data.options));
      setStep('choosing');
    } catch (err) {
      setStep('closed');
      setNotice({ tone: 'error', text: err.response?.data?.error || 'Canada Post prices could not be loaded. Try again in a minute.' });
    }
  };

  const pick = (serviceCode) => {
    const next = payload.options.find((o) => o.serviceCode === serviceCode);
    setChoice((c) => ({ serviceCode, signature: c.signature && Boolean(next?.withSignature) }));
    setNotice(null);
  };

  const confirmPurchase = async () => {
    const request = purchaseRequest(option, choice.signature);
    if (!request || step !== 'confirming' || purchasing.current) return;
    purchasing.current = true;
    setStep('buying'); setNotice(null);
    try {
      const { data } = await adminApi.buyLabel(orderId, request);
      toast.success(`Label bought. Tracking ${data.label?.trackingPin || ''}`.trim());
      if (data.mismatch) {
        toast.warning(`Canada Post charged ${money(data.mismatch.charged)}, not the ${money(data.mismatch.approved)} you approved.`);
      }
      await onChanged();
    } catch (err) {
      const outcome = explainPurchaseError(err);
      if (outcome.priceChanged) {
        setPayload((p) => withRequote(p, outcome.priceChanged, choice.signature));
        setStep('choosing');
        setNotice({ tone: 'warn', text: outcome.message });
        return;
      }
      toast.error(outcome.message);
      setNotice({ tone: 'error', text: outcome.message });
      if (outcome.reload) await onChanged(); else setStep('choosing');
    } finally {
      purchasing.current = false;
    }
  };

  const checkWithCanadaPost = async () => {
    setStep('checking'); setNotice(null);
    try {
      const { data } = await adminApi.checkLabel(orderId);
      if (data.found) toast.success('Found it: the label is on this order now.');
      else toast.info(data.message || 'Canada Post has no shipment for this order.');
      await onChanged();
    } catch (err) {
      setStep('closed');
      setNotice({ tone: 'error', text: err.response?.data?.error || 'Canada Post could not be asked. Try again in a minute.' });
    }
  };

  const openPdf = async () => {
    setOpening(true);
    try {
      const { data } = await adminApi.getLabelPdf(orderId);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      // No 'noopener' here: it makes window.open return null even when the tab opened, which would also trigger the download below.
      // The address is a blob of our own PDF on this origin, so the new tab gets nothing it could misuse.
      const opened = window.open(url, '_blank');
      if (!opened) {
        const link = document.createElement('a');
        link.href = url; link.download = `label-${order.orderNumber}.pdf`; link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (err) {
      const text = err.response?.data instanceof Blob ? 'The label could not be downloaded. Try again in a minute.' : (err.response?.data?.error || 'The label could not be downloaded. Try again in a minute.');
      toast.error(text);
    } finally { setOpening(false); }
  };

  const copyTracking = async () => {
    try { await navigator.clipboard.writeText(order.label.trackingPin); toast.success('Tracking number copied'); } catch { toast.error('Could not copy the tracking number'); }
  };

  const noticeClass = {
    error: 'text-red-700 dark:text-red-300',
    warn: 'text-amber-700 dark:text-amber-300',
    info: 'text-neutral-400',
  };
  const heading = (
    <div className="text-neutral-500 text-[11px] uppercase tracking-widest flex items-center gap-1.5">
      <Tag size={11} /> Canada Post label
    </div>
  );
  const notices = notice && (
    <div role="alert" className={`mt-3 text-[12px] leading-relaxed ${noticeClass[notice.tone]}`} data-testid="label-notice">{notice.text}</div>
  );

  // ── A label exists ────────────────────────────────────────────────────────────
  if (stage === 'bought') {
    const label = order.label;
    return (
      <div className="glass rounded-xl p-4 text-[13px]" data-testid="label-panel" data-stage="bought">
        <div className="flex items-center justify-between gap-3 mb-3">
          {heading}
          <span className="pill pill-accent text-[10px] py-0.5 flex items-center gap-1"><CheckCircle2 size={11} /> Label bought</span>
        </div>
        <div className="text-neutral-200">
          {label.serviceName}{label.signature ? ' + signature' : ''}
          {label.price?.due != null && <span className="text-neutral-400"> · {money(label.price.charged ?? label.price.due)} CAD incl. tax</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-neutral-500 text-[11px] uppercase tracking-widest">Tracking</span>
          <span className="mono text-neutral-100 break-all" data-testid="label-tracking">{label.trackingPin}</span>
          <button type="button" onClick={copyTracking} className="btn-ghost text-[12px]" aria-label="Copy tracking number"><Clipboard size={13} /> Copy</button>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button type="button" onClick={openPdf} disabled={opening} className="btn-secondary flex items-center gap-2 !py-2 !px-4 text-[12px]">
            {opening ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Open label (PDF)
          </button>
        </div>
        <p className="text-neutral-400 text-[12px] mt-3 leading-relaxed">
          Print it, stick it on the box, and hand the parcel to Canada Post. When Canada Post scans it (checked every 15 minutes) this order
          moves to Shipped and the buyer is emailed the tracking number automatically. Nothing is sent before that.
        </p>
      </div>
    );
  }

  // ── Something is unfinished ───────────────────────────────────────────────────
  if (stage === 'unfinished' || stage === 'running') {
    return (
      <div className="rounded-xl p-4 text-[13px] border border-amber-500/30 bg-amber-500/5" role="group" aria-label="Canada Post label" data-testid="label-panel" data-stage={stage}>
        <div className="text-amber-700 dark:text-amber-300 text-[11px] uppercase tracking-widest flex items-center gap-1.5 mb-2">
          <AlertTriangle size={11} /> {stage === 'running' ? 'Label purchase in progress' : 'Label purchase did not finish cleanly'}
        </div>
        {stage === 'running' ? (
          <p className="text-neutral-200 leading-relaxed">A purchase for this order is running right now. Give it a minute, then reload.</p>
        ) : (
          <p className="text-neutral-200 leading-relaxed">
            Canada Post may or may not have made a label (and charged the card) the last time. <strong>Do not buy another one yet.</strong> Ask Canada Post what happened first.
          </p>
        )}
        {order.label?.error?.message && stage === 'unfinished' && <p className="text-neutral-400 text-[12px] mt-2 break-words">What was reported: {order.label.error.message}</p>}
        <div className="mt-3">
          <button type="button" onClick={stage === 'running' ? () => onChanged() : checkWithCanadaPost} disabled={busy} className="btn-secondary flex items-center gap-2 !py-2 !px-4 text-[12px]">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {stage === 'running' ? 'Reload' : 'Check with Canada Post'}
          </button>
        </div>
        {notices}
      </div>
    );
  }

  // ── Nothing to buy here ─────────────────────────────────────────────────────────
  if (stage === 'unavailable') {
    return (
      <div className="glass rounded-xl p-4 text-[13px]" data-testid="label-panel" data-stage="unavailable">
        {heading}
        <p className="text-neutral-300 mt-2 leading-relaxed">{order.labelEligibility.reason}</p>
      </div>
    );
  }

  // ── Ready: look at the options, then approve one ──────────────────────────────────
  // The last refusal, unless the notice below is already saying the same thing.
  const failedBefore = !notice && order.label?.status === 'failed' && order.label.error?.message;
  return (
    <div className="glass rounded-xl p-4 text-[13px]" data-testid="label-panel" data-stage={stage}>
      <div className="flex items-center justify-between gap-3 mb-3">
        {heading}
        <span className={`pill text-[10px] py-0.5 ${stage === 'switched-off' ? 'text-neutral-500' : 'pill-blue'}`}>{stage === 'switched-off' ? 'Buying is off' : 'No label yet'}</span>
      </div>
      {failedBefore && (
        <p className="text-amber-700 dark:text-amber-300 text-[12px] mb-3 break-words">Last attempt: {String(order.label.error.message).replace(/[.\s]+$/, '')}. Nothing was charged.</p>
      )}
      {step === 'closed' && (
        <>
          <p className="text-neutral-300 leading-relaxed">
            Live Canada Post prices at your business rate. Nothing is bought until you approve one.
          </p>
          <button type="button" onClick={loadOptions} className="btn-secondary mt-3 !py-2 !px-4 text-[12px]">Show Canada Post options</button>
        </>
      )}
      {step === 'loading' && (
        <div className="flex items-center gap-2 text-neutral-400" role="status"><Loader2 size={14} className="animate-spin" /> Asking Canada Post…</div>
      )}
      {payload && ['choosing', 'confirming', 'buying'].includes(step) && option && (
        <>
          <fieldset disabled={step !== 'choosing'} className="space-y-2 min-w-0">
            <legend className="text-neutral-500 text-[11px] uppercase tracking-widest mb-2">Choose a service</legend>
            {payload.options.map((o) => {
              const selected = o.serviceCode === choice.serviceCode;
              const shown = detailsOf(o, choice.signature && Boolean(o.withSignature)) || o;
              return (
                <label
                  key={o.serviceCode}
                  className={`flex items-start gap-3 rounded-lg p-2.5 cursor-pointer border ${selected ? 'border-[#8a5a00] bg-[#8a5a00]/10 dark:border-[#ffcf24] dark:bg-[#ffcf24]/10' : 'border-white/10'}`}
                >
                  <input type="radio" name={`label-service-${orderId}`} value={o.serviceCode} checked={selected} onChange={() => pick(o.serviceCode)} className="mt-1" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-neutral-100">{o.serviceName}{payload.recommended?.serviceCode === o.serviceCode && <span className="text-neutral-500 text-[11px]"> · what the buyer paid for</span>}</span>
                    <span className="block text-neutral-400 text-[12px]">{arrivalNote(shown)}</span>
                  </span>
                  <span className="mono text-neutral-100 shrink-0">{money(choice.signature && o.withSignature ? o.withSignature.due : o.due)}</span>
                </label>
              );
            })}
          </fieldset>
          <label className={`flex items-center gap-2 mt-3 ${option.withSignature ? '' : 'opacity-60'}`}>
            <input
              type="checkbox"
              checked={choice.signature}
              disabled={step !== 'choosing' || !option.withSignature}
              onChange={(e) => { setChoice((c) => ({ ...c, signature: e.target.checked })); setNotice(null); }}
            />
            <span>Signature on delivery{option.withSignature ? ` (${signatureNote(option)})` : ' (not offered for this service)'}</span>
          </label>
          <p className="text-neutral-400 text-[12px] mt-3 leading-relaxed" data-testid="label-buyer-paid">
            The buyer paid {money(payload.buyerPaid?.shipping)} for shipping{payload.buyerPaid?.service ? ` (${payload.buyerPaid.service})` : ''}. Prices include tax and were checked at {new Date(payload.checkedAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}; they are checked again at the moment you buy.
          </p>

          {step === 'choosing' && (
            payload.switchedOff || stage === 'switched-off' ? (
              <p className="text-amber-700 dark:text-amber-300 text-[12px] mt-3" data-testid="label-switched-off">
                Buying labels is switched off on the server, so only prices are shown. It is turned on with a server setting, not from this page.
              </p>
            ) : (
              <button type="button" ref={reviewRef} onClick={() => { setStep('confirming'); setNotice(null); }} className="btn-primary mt-4 !py-2.5 !px-5 text-[13px]">
                Review and buy…
              </button>
            )
          )}

          {(step === 'confirming' || step === 'buying') && (
            <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" role="group" aria-label="Confirm label purchase" data-testid="label-confirm">
              <div className="text-amber-800 dark:text-amber-200 text-[11px] uppercase tracking-widest mb-2">You are about to buy</div>
              <div className="text-neutral-100">{option.serviceName}{choice.signature ? ' + signature' : ''} · <span className="mono">{money(due)} CAD</span> incl. tax</div>
              <div className="text-neutral-400 text-[12px] mt-1">
                To {[address.firstName, address.lastName].filter(Boolean).join(' ')}, {[address.city, address.state].filter(Boolean).join(' ')}
              </div>
              <p className="text-neutral-300 text-[12px] mt-2 leading-relaxed">
                This charges the card saved on your Canada Post account right now. A bought label can't be cancelled from this page.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" ref={confirmRef} onClick={confirmPurchase} disabled={step === 'buying'} className="btn-primary flex items-center gap-2 !py-2.5 !px-5 text-[13px]" data-testid="label-confirm-buy">
                  {step === 'buying' && <Loader2 size={13} className="animate-spin" />}
                  {step === 'buying' ? 'Buying…' : `Charge ${money(due)} and create label`}
                </button>
                <button type="button" onClick={() => { setStep('choosing'); window.setTimeout(() => reviewRef.current?.focus(), 0); }} disabled={step === 'buying'} className="btn-secondary !py-2.5 !px-5 text-[13px]">Cancel</button>
              </div>
              {step === 'buying' && <p className="text-neutral-400 text-[12px] mt-2" role="status">Waiting for Canada Post. This can take up to a minute; do not click again.</p>}
            </div>
          )}
        </>
      )}
      {notices}
    </div>
  );
}

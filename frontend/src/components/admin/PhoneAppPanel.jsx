import { useCallback, useEffect, useState } from 'react';
import { BellRing, Loader2, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/api';
import { codeCountdown, isLive, lastSeenLabel } from '@/lib/phoneApp';

// The owner's phone app (android-admin/): signed in for good and a notification for every order and change.
// A phone is paired with a one-time code from here; removing it signs that phone out at once.
export default function PhoneAppPanel() {
  const [devices, setDevices] = useState(null);
  const [pairing, setPairing] = useState(null);       // { code, expiresAt }
  const [busy, setBusy] = useState('');
  const [tick, setTick] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const { data } = await adminApi.listDevices();
      setDevices(data.devices || []);
    } catch {
      setDevices([]);
      toast.error('Could not load the paired phones');
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const countdown = pairing ? codeCountdown(pairing.expiresAt, tick) : null;

  const makeCode = async () => {
    setBusy('code');
    try {
      const { data } = await adminApi.createPairingCode();
      setPairing(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not make a pairing code');
    } finally { setBusy(''); }
  };

  const sendTest = async () => {
    setBusy('test');
    try {
      await adminApi.sendTestAlert();
      toast.success('Test alert sent. It should reach your phone within a few seconds.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not send the test alert');
    } finally { setBusy(''); }
  };

  const remove = async (device) => {
    if (!window.confirm(`Remove "${device.label}"? It is signed out at once and stops getting alerts.`)) return;
    setBusy(device.id);
    try {
      await adminApi.revokeDevice(device.id);
      toast.success('Phone removed');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not remove the phone');
    } finally { setBusy(''); }
  };

  return (
    <div className="glass rounded-2xl p-6 mb-6" data-testid="phone-app-panel">
      <div className="flex items-center gap-2 mb-1">
        <Smartphone size={16} className="text-neutral-400" />
        <h2 className="font-semibold">Phone app</h2>
      </div>
      <p className="text-[12px] text-neutral-500 mb-4">
        The Reflexity admin app keeps you signed in and sends a notification for every new order, payment, refund and quote request.
      </p>

      {devices === null ? (
        <div className="flex items-center gap-2 text-neutral-400 text-[13px] py-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : devices.length === 0 ? (
        <p className="text-[13px] text-neutral-400 mb-4" data-testid="phone-app-empty">No phone is paired yet.</p>
      ) : (
        <ul className="divide-y divide-white/5 mb-4" data-testid="phone-app-devices">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
              <div className="min-w-0">
                <div className="font-medium truncate">{device.label}</div>
                <div className="text-[12px] text-neutral-500 flex items-center gap-1.5">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${isLive(device.lastSeenAt, tick) ? 'bg-emerald-400' : 'bg-neutral-600'}`} />
                  {lastSeenLabel(device.lastSeenAt, tick)}{device.appVersion ? ` · v${device.appVersion}` : ''}
                </div>
              </div>
              <button type="button" onClick={() => remove(device)} disabled={busy === device.id}
                className="btn-ghost py-1 px-2.5 text-[11px] flex items-center gap-1 text-neutral-500 hover:text-red-400" aria-label={`Remove ${device.label}`}>
                {busy === device.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {pairing && countdown && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 mb-4" data-testid="phone-app-code">
          <div className="text-[11px] uppercase tracking-widest text-neutral-500 mb-1">Pairing code</div>
          <div className="mono text-2xl font-bold tracking-[0.2em]">{pairing.code}</div>
          <div className="text-[12px] text-neutral-400 mt-1">Open the app and enter it. Works once, expires in {countdown}.</div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={makeCode} disabled={busy === 'code'} className="btn-primary flex items-center gap-2">
          {busy === 'code' && <Loader2 size={13} className="animate-spin" />} Pair a phone
        </button>
        <button type="button" onClick={sendTest} disabled={busy === 'test' || !devices?.length} className="btn-secondary flex items-center gap-2">
          {busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />} Send test alert
        </button>
      </div>
    </div>
  );
}

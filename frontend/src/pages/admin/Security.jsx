import { useState } from 'react';
import { Shield, Lock, Key, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import useAuthStore from '@/lib/authStore';

export default function Security() {
  const changePassword = useAuthStore((state) => state.changePassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) return toast.error('New passwords do not match');
    if (next.length < 12) return toast.error('Use at least 12 characters');
    setSaving(true);
    try {
      const result = await changePassword({ currentPassword: current, newPassword: next });
      if (!result.success) throw new Error(result.message || 'Failed to change password');
      toast.success('Password changed');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      toast.error(err.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout requireAdmin>
      <div className="p-8 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Security</h1>
          <p className="text-neutral-500 text-[13px] mt-1">Account and store security settings</p>
        </div>

        {/* Change password */}
        <div className="glass rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={16} className="text-neutral-400" />
            <h2 className="font-semibold">Change admin password</h2>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="admin-label">Current password</label>
              <input type="password" className="input" value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" />
            </div>
            <div>
              <label className="admin-label">New password</label>
              <input type="password" className="input" value={next} onChange={e => setNext(e.target.value)} required autoComplete="new-password" minLength={12} />
              <p className="text-[11px] text-neutral-500 mt-1">At least 12 characters</p>
            </div>
            <div>
              <label className="admin-label">Confirm new password</label>
              <input type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
            </div>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Update password
            </button>
          </form>
        </div>

        {/* Security checklist — things only the owner can verify */}
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={16} className="text-neutral-400" />
            <h2 className="font-semibold">Security checklist</h2>
          </div>
          <ul className="space-y-3 text-[13px]">
            <ChecklistItem
              title="Rotate API keys quarterly"
              body="Stripe, Resend, Cloudinary, and your MongoDB password should be rotated every 90 days, and immediately if anyone with access leaves."
            />
            <ChecklistItem
              title="Never commit .env to git"
              body="Store secrets in your Render/Railway dashboard, not in the repo. The .env.example file in the repo should always have blank values."
            />
            <ChecklistItem
              title="Webhook signing secret matches"
              body="If Stripe webhooks fail, confirm STRIPE_WEBHOOK_SECRET in your hosting env exactly matches the signing secret shown in the Stripe dashboard."
            />
            <ChecklistItem
              title="Disable seed route after launch"
              body="Once your admin account exists and products are seeded, remove SEED_SECRET from env to disable POST /api/seed entirely."
              warning
            />
          </ul>
        </div>
      </div>
    </AppLayout>
  );
}

function ChecklistItem({ title, body, warning }) {
  return (
    <li className="flex items-start gap-3">
      {warning ? (
        <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
      ) : (
        <Check size={14} className="text-neutral-500 mt-0.5 shrink-0" />
      )}
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-neutral-500 text-[12px] mt-0.5">{body}</div>
      </div>
    </li>
  );
}

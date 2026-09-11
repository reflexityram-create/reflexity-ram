import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Inbox, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import AuthModal from '@/components/AuthModal';
import EmptyState from '@/components/EmptyState';
import useAuthStore from '@/lib/authStore';
import { ordersApi, authApi } from '@/lib/api';

const STATUS_PILLS = {
  pending: 'pill-amber',
  processing: 'pill-blue',
  shipped: 'pill-accent',
  delivered: 'pill-accent',
  cancelled: '',
  refunded: '',
};

export default function Account() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'profile';
  const setTab = (t) => setSearchParams({ tab: t });

  const [authOpen, setAuthOpen] = useState(false);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', phone: '' });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);

  const { user, logout, updateProfile, changePassword, isAuthenticated } = useAuthStore();

  const handleResendVerification = async () => {
    setResendingVerification(true);
    try {
      await authApi.resendVerification();
      toast.success('Verification email sent — check your inbox');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send verification email');
    } finally {
      setResendingVerification(false);
    }
  };

  useEffect(() => {
    if (user) {
      setProfileForm({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        phone: user.phone || '',
      });
    }
  }, [user]);

  useEffect(() => {
    if (user && tab === 'orders') {
      setOrdersLoading(true);
      ordersApi.list({ limit: 20 })
        .then(({ data }) => setOrders(data.orders || []))
        .catch(() => toast.error('Failed to load orders'))
        .finally(() => setOrdersLoading(false));
    }
  }, [user, tab]);

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out');
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const result = await updateProfile(profileForm);
    setSaving(false);
    if (result.success) toast.success('Profile updated');
    else toast.error(result.message);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setSaving(true);
    const result = await changePassword({
      currentPassword: pwForm.currentPassword,
      newPassword: pwForm.newPassword,
    });
    setSaving(false);
    if (result.success) {
      toast.success('Password changed successfully');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } else {
      toast.error(result.message);
    }
  };

  return (
    <>
    <AppLayout>
      <div className="p-8 max-w-4xl" data-testid="account-page">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Account</h1>
          {user && (
            <p className="text-neutral-400 text-[14px] mt-1">
              {user.firstName} {user.lastName} · {user.email}
            </p>
          )}
          {user && !user.isEmailVerified && (
            <div className="mt-3 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-[13px]">
              <AlertTriangle size={15} className="text-amber-400 shrink-0" />
              <span className="text-amber-200">Your email address is not verified.</span>
              <button
                onClick={handleResendVerification}
                disabled={resendingVerification}
                className="ml-auto btn-ghost text-[12px] text-amber-300 hover:text-amber-100 disabled:opacity-50"
              >
                {resendingVerification ? (
                  <><Loader2 size={12} className="animate-spin" /> Sending…</>
                ) : (
                  'Resend verification email'
                )}
              </button>
            </div>
          )}
        </div>

        {!isAuthenticated() ? (
          <div className="glass rounded-2xl p-8 max-w-lg">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle size={20} className="text-amber-400" />
              <h3 className="font-semibold">Sign in to view your account</h3>
            </div>
            <p className="text-[13px] text-neutral-400 mb-6">
              Access your orders, manage your profile, and update security settings.
            </p>
            <button onClick={() => setAuthOpen(true)} className="btn-primary">
              Sign in / Create account
            </button>
          </div>
        ) : (
          <div>
            <div>
              {tab === 'profile' && (
                <div className="space-y-6">
                  <div className="glass rounded-2xl p-6">
                    <h3 className="font-semibold tracking-tight text-[15px] mb-4">Account overview</h3>
                    <div className="grid grid-cols-2 gap-3 text-[13px]">
                      <div className="glass rounded-xl p-4">
                        <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-1">Role</div>
                        <div className="font-medium capitalize">{user.role}</div>
                      </div>
                      <div className="glass rounded-xl p-4">
                        <div className="text-neutral-500 text-[11px] uppercase tracking-widest mb-1">Email</div>
                        <div className={`font-medium flex items-center gap-1.5 ${user.isEmailVerified ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {user.isEmailVerified ? <><CheckCircle size={13} /> Verified</> : '⚠ Unverified'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'orders' && (
                <div data-testid="account-orders">
                  {ordersLoading ? (
                    <div className="flex items-center gap-2 text-neutral-400 py-8">
                      <Loader2 size={16} className="animate-spin" />
                      Loading orders…
                    </div>
                  ) : orders.length === 0 ? (
                    <EmptyState
                      icon={Inbox}
                      title="No orders yet"
                      description="Once you place an order, it will appear here."
                      ctaLabel="Browse memory"
                      ctaTo="/shop"
                      testId="account-orders-empty"
                    />
                  ) : (
                    <div className="flex flex-col gap-3">
                      {orders.map((o) => (
                        <Link
                          to={`/order/${o.orderNumber}`}
                          key={o._id}
                          className="glass card-hover rounded-xl p-5 grid md:grid-cols-[1fr_auto] gap-4"
                        >
                          <div>
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <div className="mono text-[12px] tracking-widest text-white">{o.orderNumber}</div>
                              <span className={`pill ${STATUS_PILLS[o.status] || 'pill-blue'} text-[10px] py-0.5`}>
                                {o.status}
                              </span>
                            </div>
                            <div className="text-[12px] text-neutral-500 mb-2">
                              {new Date(o.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                              {' · '}
                              {o.items?.reduce((s, i) => s + i.qty, 0)} item{o.items?.reduce((s, i) => s + i.qty, 0) !== 1 ? 's' : ''}
                            </div>
                          </div>
                          <div className="md:text-right">
                            <div className="text-lg font-bold">${o.total?.toFixed(2)}</div>
                            <div className="text-[12px] text-neutral-400 mt-1">View details →</div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'security' && (
                <form onSubmit={handlePasswordChange} className="glass rounded-2xl p-6 max-w-xl flex flex-col gap-4" data-testid="account-security-form">
                  <h3 className="font-semibold tracking-tight text-[15px]">Change password</h3>
                  <input type="password" placeholder="Current password" className="input" value={pwForm.currentPassword} onChange={(e) => setPwForm(f => ({ ...f, currentPassword: e.target.value }))} required />
                  <input type="password" placeholder="New password (min 8 chars, 1 uppercase, 1 number)" className="input" value={pwForm.newPassword} onChange={(e) => setPwForm(f => ({ ...f, newPassword: e.target.value }))} required minLength={8} />
                  <input type="password" placeholder="Confirm new password" className="input" value={pwForm.confirmPassword} onChange={(e) => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))} required />
                  <button type="submit" disabled={saving} className="btn-primary self-start flex items-center gap-2">
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    Save changes
                  </button>
                </form>
              )}

              {tab === 'settings' && (
                <form onSubmit={handleProfileSave} className="glass rounded-2xl p-6 max-w-xl flex flex-col gap-4" data-testid="account-settings-form">
                  <h3 className="font-semibold tracking-tight text-[15px]">Profile settings</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <input placeholder="First name" className="input" value={profileForm.firstName} onChange={(e) => setProfileForm(f => ({ ...f, firstName: e.target.value }))} />
                    <input placeholder="Last name" className="input" value={profileForm.lastName} onChange={(e) => setProfileForm(f => ({ ...f, lastName: e.target.value }))} />
                  </div>
                  <input type="email" placeholder="Email" className="input" value={user?.email || ''} disabled />
                  <input placeholder="Phone number" className="input" value={profileForm.phone} onChange={(e) => setProfileForm(f => ({ ...f, phone: e.target.value }))} />
                  <button type="submit" disabled={saving} className="btn-primary self-start flex items-center gap-2">
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    Save changes
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}

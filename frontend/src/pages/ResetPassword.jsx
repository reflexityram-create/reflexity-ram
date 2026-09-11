import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { authApi } from '@/lib/api';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authApi.resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <main className="container-tight pt-28 pb-20 min-h-screen flex items-start justify-center">
        <div className="glass rounded-2xl p-8 w-full max-w-md">
          {!token ? (
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Invalid reset link</p>
                <p className="text-[13px] text-neutral-400 mt-1">
                  This link is missing a token. Please request a new password reset.
                </p>
                <Link to="/account" className="btn-primary mt-4 inline-flex">Back to account</Link>
              </div>
            </div>
          ) : success ? (
            <div className="flex flex-col items-center gap-4 text-center py-4">
              <CheckCircle size={40} className="text-emerald-400" />
              <div>
                <p className="font-semibold text-lg">Password reset!</p>
                <p className="text-[13px] text-neutral-400 mt-1">
                  Your password has been updated. You can now sign in.
                </p>
              </div>
              <Link to="/account" className="btn-primary">Sign in</Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold tracking-tight mb-2">Set new password</h2>
              <p className="text-[13px] text-neutral-500 mb-6">
                Choose a strong password for your Reflexity RAM account.
              </p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="New password (min 8 chars, 1 uppercase, 1 number)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input pr-10"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="input"
                  required
                />
                {error && (
                  <div className="flex items-center gap-2 text-[12px] text-red-400">
                    <AlertTriangle size={13} />
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary flex items-center justify-center gap-2 mt-1"
                >
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  Reset password
                </button>
              </form>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

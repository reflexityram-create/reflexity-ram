import { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import useAuthStore from '@/lib/authStore';
import { authApi } from '@/lib/api';
import useCartStore from '@/lib/cartStore';

const TABS = { signin: 'signin', signup: 'signup', forgot: 'forgot' };

export default function AuthModal({ open, onClose, initialTab = 'signin' }) {
  const [tab, setTab] = useState(initialTab);
  const [showPw, setShowPw] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  // Sync the active tab when the modal opens or the trigger requests a
  // different tab. Without this, useState(initialTab) only applies once on
  // mount, so clicking "Create account" after "Sign in" kept showing signin.
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = document.activeElement;
    const focusTimer = window.setTimeout(() => dialogRef.current?.querySelector('button,input')?.focus(), 0);
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button,input,a')].filter((el) => !el.disabled && el.tabIndex !== -1);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      triggerRef.current?.focus?.();
    };
  }, [open, onClose]);

  const { login, signup, isLoading } = useAuthStore();
  const { fetchCart } = useCartStore();

  const [form, setFormState] = useState({
    email: '', password: '', firstName: '', lastName: '', forgotEmail: '',
  });

  const setField = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const handleSignin = async (e) => {
    e.preventDefault();
    const result = await login({ email: form.email, password: form.password });
    if (result.success) {
      toast.success('Welcome back!');
      await fetchCart();
      onClose();
    } else {
      toast.error(result.message);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    const result = await signup({
      email: form.email,
      password: form.password,
      firstName: form.firstName,
      lastName: form.lastName,
    });
    if (result.success) {
      toast.success(result.message || 'Account created! Check your email to verify.');
      await fetchCart();
      onClose();
    } else {
      if (result.details) {
        result.details.forEach((d) => toast.error(d.message));
      } else {
        toast.error(result.message);
      }
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setForgotLoading(true);
    try {
      await authApi.forgotPassword(form.forgotEmail);
      setForgotSent(true);
    } catch {
      toast.error('Failed to send reset email. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      data-testid="auth-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      ref={dialogRef}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-md glass rounded-2xl p-8 shadow-2xl fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
          data-testid="auth-modal-close"
          aria-label="Close sign-in dialog"
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div className="mb-6">
          <h2 id="auth-modal-title" className="text-xl font-bold tracking-tight">
            {tab === TABS.signin && 'Welcome back'}
            {tab === TABS.signup && 'Create account'}
            {tab === TABS.forgot && 'Reset password'}
          </h2>
          <p className="text-[13px] text-neutral-500 mt-1">
            {tab === TABS.signin && 'Sign in to access your orders and account'}
            {tab === TABS.signup && 'Join Reflexity RAM — track orders, get alerts'}
            {tab === TABS.forgot && "We'll send a reset link to your email"}
          </p>
        </div>

        {/* Tab switcher */}
        {tab !== TABS.forgot && (
          <div className="flex gap-1 mb-6 p-1 glass rounded-xl">
            {[TABS.signin, TABS.signup].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-all ${
                  tab === t
                    ? 'bg-white/8 text-white border border-white/12'
                    : 'text-neutral-400 hover:text-white'
                }`}
                data-testid={`auth-tab-${t}`}
              >
                {t === TABS.signin ? 'Sign in' : 'Sign up'}
              </button>
            ))}
          </div>
        )}

        {/* Google OAuth */}
        {tab !== TABS.forgot && (
          <>
            <a
              href={`${import.meta.env.VITE_API_URL?.replace('/api', '') || 'https://reflexity-ram.onrender.com'}/api/auth/google`}
              className="flex items-center justify-center gap-3 w-full py-2.5 px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-medium mb-4"
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19.1 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.5 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-8H6.1C9.5 35.6 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.6l6.2 5.2C36.9 39.5 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/>
              </svg>
              Continue with Google
            </a>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-white/8" />
              <span className="text-[11px] text-neutral-600">or</span>
              <div className="flex-1 h-px bg-white/8" />
            </div>
          </>
        )}

        {/* Sign In Form */}
        {tab === TABS.signin && (
          <form onSubmit={handleSignin} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email address"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              className="input"
              required
              autoComplete="email"
              data-testid="signin-email"
            />
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="Password"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                className="input pr-10"
                required
                autoComplete="current-password"
                data-testid="signin-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setTab(TABS.forgot)}
              className="text-[12px] text-neutral-400 hover:text-white text-left transition-colors"
            >
              Forgot password?
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary mt-1 flex items-center justify-center gap-2"
              data-testid="signin-submit"
            >
              {isLoading && <Loader2 size={15} className="animate-spin" />}
              Sign in
            </button>
          </form>
        )}

        {/* Sign Up Form */}
        {tab === TABS.signup && (
          <form onSubmit={handleSignup} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="First name"
                value={form.firstName}
                onChange={(e) => setField('firstName', e.target.value)}
                className="input"
                required
                data-testid="signup-firstname"
              />
              <input
                type="text"
                placeholder="Last name"
                value={form.lastName}
                onChange={(e) => setField('lastName', e.target.value)}
                className="input"
                required
                data-testid="signup-lastname"
              />
            </div>
            <input
              type="email"
              placeholder="Email address"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              className="input"
              required
              autoComplete="email"
              data-testid="signup-email"
            />
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="Password (min 8 chars, 1 uppercase, 1 number)"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                className="input pr-10"
                required
                minLength={8}
                autoComplete="new-password"
                data-testid="signup-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-[11px] text-neutral-600">
              By creating an account you agree to our{' '}
              <a href="/terms" className="text-neutral-400 hover:text-white underline">Terms</a>{' '}
              and{' '}
              <a href="/privacy" className="text-neutral-400 hover:text-white underline">Privacy Policy</a>.
            </p>
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary mt-1 flex items-center justify-center gap-2"
              data-testid="signup-submit"
            >
              {isLoading && <Loader2 size={15} className="animate-spin" />}
              Create account
            </button>
          </form>
        )}

        {/* Forgot Password */}
        {tab === TABS.forgot && (
          <>
            {forgotSent ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <CheckCircle size={40} className="text-emerald-400" />
                <div>
                  <p className="font-semibold">Check your inbox</p>
                  <p className="text-[13px] text-neutral-400 mt-1">
                    If an account exists for <strong>{form.forgotEmail}</strong>, a reset link has been sent. Check your spam folder too.
                  </p>
                </div>
                <button
                  onClick={() => { setTab(TABS.signin); setForgotSent(false); }}
                  className="btn-secondary text-[13px]"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="flex flex-col gap-3">
                <input
                  type="email"
                  placeholder="Email address"
                  value={form.forgotEmail}
                  onChange={(e) => setField('forgotEmail', e.target.value)}
                  className="input"
                  required
                  data-testid="forgot-email"
                />
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="btn-primary flex items-center justify-center gap-2"
                  data-testid="forgot-submit"
                >
                  {forgotLoading && <Loader2 size={15} className="animate-spin" />}
                  Send reset link
                </button>
                <button
                  type="button"
                  onClick={() => setTab(TABS.signin)}
                  className="btn-ghost text-[13px]"
                >
                  Back to sign in
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

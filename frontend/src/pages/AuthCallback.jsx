import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import useAuthStore from '@/lib/authStore';
import { authApi } from '@/lib/api';
import useCartStore from '@/lib/cartStore';

const ERROR_MESSAGES = {
  google_denied:         'Google sign-in was cancelled.',
  token_exchange_failed: 'Google sign-in failed. Please try again.',
  no_email:              'Could not retrieve your email from Google.',
  account_deactivated:   'This account has been deactivated.',
  state_mismatch:        'Security check failed. Please try signing in again.',
  server_error:          'Something went wrong. Please try again.',
};

export default function AuthCallback() {
  const navigate = useNavigate();
  const setAuthToken = useAuthStore((s) => s.setAuthToken);
  const setAuthenticatedUser = useAuthStore((s) => s.setAuthenticatedUser);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const fetchCart = useCartStore((s) => s.fetchCart);

  useEffect(() => {
    // Success payload arrives in the URL fragment so it never reaches
    // server/CDN access logs. The token authenticates /me; no user object
    // supplied by the browser is trusted for identity or role decisions.
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    window.history.replaceState({}, '', '/auth/callback');

    const authError = query.get('auth_error');
    if (authError) {
      toast.error(ERROR_MESSAGES[authError] || 'Authentication failed.');
      navigate('/', { replace: true });
      return;
    }

    const token = hash.get('token');

    if (!token) {
      toast.error('Authentication failed. Please try again.');
      navigate('/', { replace: true });
      return;
    }

    let active = true;
    void (async () => {
      try {
        setAuthToken(token);
        const { data } = await authApi.me();
        if (!active || !data?.user) throw new Error('Missing authenticated user');
        setAuthenticatedUser(data.user);
        fetchCart();
        toast.success(`Welcome, ${data.user.firstName || 'back'}!`);
        navigate('/', { replace: true });
      } catch {
        if (!active) return;
        clearAuth();
        toast.error('Authentication failed. Please try again.');
        navigate('/', { replace: true });
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-neutral-400">Signing you in with Google...</p>
      </div>
    </div>
  );
}

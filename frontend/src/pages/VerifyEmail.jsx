import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import useAuthStore from '@/lib/authStore';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState('loading'); // 'loading' | 'success' | 'error'
  const [message, setMessage] = useState('');
  const { initialize } = useAuthStore();

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token found in URL.');
      return;
    }
    authApi.verifyEmail(token)
      .then(async () => {
        await initialize(); // Refresh user state
        setStatus('success');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Verification failed. The link may have expired.');
      });
  }, [token]);

  return (
    <>
      <Header />
      <main className="container-tight pt-28 pb-20 min-h-screen flex items-start justify-center">
        <div className="glass rounded-2xl p-8 w-full max-w-md text-center">
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 size={32} className="animate-spin text-neutral-400" />
              <p className="text-neutral-400">Verifying your email…</p>
            </div>
          )}
          {status === 'success' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle size={40} className="text-emerald-400" />
              <div>
                <p className="font-semibold text-lg">Email verified!</p>
                <p className="text-[13px] text-neutral-400 mt-1">
                  Your email address has been confirmed. Your account is fully active.
                </p>
              </div>
              <Link to="/account" className="btn-primary">Go to account</Link>
            </div>
          )}
          {status === 'error' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <AlertTriangle size={40} className="text-amber-400" />
              <div>
                <p className="font-semibold text-lg">Verification failed</p>
                <p className="text-[13px] text-neutral-400 mt-1">{message}</p>
              </div>
              <div className="flex gap-3">
                <Link to="/account" className="btn-secondary">Back to account</Link>
                <Link to="/shop" className="btn-primary">Browse memory</Link>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

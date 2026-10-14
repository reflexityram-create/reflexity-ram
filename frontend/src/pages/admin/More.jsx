import { ChevronRight, Eye, LogOut, Settings, Shield, Store, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import ConfirmButton from '@/components/admin/ConfirmButton';
import useAuthStore from '@/lib/authStore';
import { appVersion, isAdminApp } from '@/lib/appBridge';

const ROWS = [
  { to: '/admin/users', icon: Users, title: 'Users', text: 'Customers and admins' },
  { to: '/admin/visitors', icon: Eye, title: 'Visitors', text: 'Who is looking at the sites: IP address, place, device, pages' },
  { to: '/admin/security', icon: Shield, title: 'Security and phone app', text: 'Your password, pair a phone, the phones that get alerts' },
  { to: '/account?tab=settings', icon: Settings, title: 'Account settings', text: 'Your name' },
  { to: '/', icon: Store, title: 'View the store', text: 'The website the way customers see it' },
];

// The places that do not need a tab of their own. (On a desktop the sidebar lists them.)
export default function AdminMore() {
  const logout = useAuthStore((state) => state.logout);
  const inApp = isAdminApp();
  const version = appVersion();
  return (
    <AppLayout requireAdmin>
      <div className="p-4 md:p-8 max-w-2xl">
        <h1 className="text-2xl font-bold tracking-tight mb-4 md:mb-6">More</h1>
        <ul className="space-y-2.5" data-testid="more-list">
          {ROWS.map(({ to, icon: Icon, title, text }) => (
            <li key={to}>
              <Link to={to} className="admin-card admin-card-row" data-testid={`more-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--pill-bg)', border: '1px solid var(--pill-border)' }}><Icon size={18} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{title}</span>
                  <span className="block text-[12.5px] text-neutral-500">{text}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-neutral-500" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        {inApp ? (
          <p className="mt-6 text-[12px] text-neutral-500" data-testid="more-app-version">Reflexity Admin app{version ? ` ${version}` : ''}. It keeps you signed in, so there is nothing to sign out of here.</p>
        ) : (
          <div className="mt-6">
            <ConfirmButton
              variant="secondary"
              label="Sign out"
              confirmLabel="Yes, sign out"
              message="Sign out of the admin on this device?"
              onConfirm={async () => { await logout(); toast.success('Signed out'); }}
              className="w-full sm:w-auto"
              testId="more-sign-out"
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
}

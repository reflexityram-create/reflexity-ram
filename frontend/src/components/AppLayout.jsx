import { Link, useLocation, Navigate } from 'react-router-dom';
import { User, ShoppingBag, Shield, Settings as SettingsIcon, Package, Boxes, Users, LogOut, ChevronRight, Cpu } from 'lucide-react';
import useAuthStore from '@/lib/authStore';
import { toast } from 'sonner';

// ─── Unified sidebar — one nav for the entire signed-in experience ─────────────
// Items are filtered by role so each user sees a single, non-duplicated nav.
// `tab` is matched against the ?tab= query string (Account uses tab-based content
// switching); items without `tab` match by pathname.
const USER_ITEMS = [
  { to: '/account', tab: null, label: 'Profile', icon: User },
  // Personal order history — only customers (non-admins) see this. Admins
  // get the store-wide Orders entry in the Admin section instead, so there's
  // never two "Orders" rows for the same user.
  { to: '/account?tab=orders', tab: 'orders', label: 'Orders', icon: ShoppingBag, customerOnly: true },
  { to: '/account?tab=security', tab: 'security', label: 'Security', icon: Shield },
  { to: '/account?tab=settings', tab: 'settings', label: 'Settings', icon: SettingsIcon },
];

const ADMIN_ITEMS = [
  { to: '/admin/products', label: 'Retail products', icon: Package, group: 'Products' },
  { to: '/admin/wholesale', label: 'Wholesale lots', icon: Boxes, group: 'Products' },
  { to: '/admin/orders', label: 'Orders', icon: ShoppingBag, group: 'Operations' },
  { to: '/admin/users', label: 'Users', icon: Users, group: 'Operations' },
];

export default function AppLayout({ children, requireAdmin = false }) {
  const { user, logout, isInitialized } = useAuthStore();
  const location = useLocation();

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-white/20 border-t-white rounded-full" />
      </div>
    );
  }

  if (!user) return <Navigate to="/" replace />;
  if (requireAdmin && user.role !== 'admin') return <Navigate to="/account" replace />;

  const isAdmin = user.role === 'admin';
  const handleLogout = async () => { await logout(); toast.success('Logged out'); };

  // Active = same pathname AND same tab (matching `null` for items with no tab).
  const currentTab = new URLSearchParams(location.search).get('tab');
  const isActive = (item) => {
    if (item.tab !== undefined) {
      // Account-style item: match pathname + tab
      return location.pathname === '/account' && currentTab === item.tab;
    }
    // Admin-style item: pathname startsWith
    return location.pathname === item.to || location.pathname.startsWith(item.to + '/');
  };

  // User items — skip the customer-only personal Orders entry for admins
  const visibleUserItems = USER_ITEMS.filter((i) => !(i.customerOnly && isAdmin));

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="app-layout-aside sticky top-0 z-40 flex w-full shrink-0 flex-col border-b md:static md:z-auto md:w-56 md:border-b-0 md:border-r"
        style={{ background: "var(--bg-elev)", borderColor: "var(--border)" }}>
        {/* Brand */}
        <div className="flex items-center justify-between border-b p-3 md:block md:p-5" style={{ borderColor: 'var(--border)' }}>
          <Link to="/" className="flex items-center gap-2">
            <Cpu size={16} style={{ color: 'var(--fg-muted)' }} />
            <span className="font-bold text-[13px] tracking-tight">Reflexity RAM</span>
          </Link>
          <div className="mt-0.5 text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-faint)' }}>
            {isAdmin ? 'Admin panel' : 'My account'}
          </div>
        </div>

        <nav className="flex flex-1 gap-1 overflow-x-auto p-2 md:block md:space-y-0.5 md:overflow-y-auto md:p-3">
          {visibleUserItems.map((item) => <SidebarLink key={item.label} item={item} active={isActive(item)} />)}

          {isAdmin && (
            <>
              <div className="app-nav-group hidden px-3 pb-1 pt-4 text-[10px] uppercase tracking-widest md:block">Products</div>
              {ADMIN_ITEMS.filter((item) => item.group === 'Products').map((item) => (
                <SidebarLink key={item.to} item={item} active={isActive(item)} />
              ))}
              <div className="app-nav-group hidden px-3 pb-1 pt-4 text-[10px] uppercase tracking-widest md:block">Operations</div>
              {ADMIN_ITEMS.filter((item) => item.group === 'Operations').map((item) => (
                <SidebarLink key={item.to} item={item} active={isActive(item)} />
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="hidden border-t p-3 md:block" style={{ borderColor: 'var(--border)' }}>
          <div className="px-3 py-2 text-[12px] text-neutral-500 mb-1 truncate" title={user.email}>
            {user.email}
          </div>
          <Link
            to="/"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] text-neutral-400 hover:text-white hover:bg-white/4 transition-all"
          >
            <ChevronRight size={13} />
            View store
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] text-neutral-400 hover:text-red-400 hover:bg-red-500/5 transition-all w-full"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function SidebarLink({ item, active }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={`app-sidebar-link flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-[12px] transition-all md:py-2.5 md:text-[13px] ${active ? 'is-active' : ''}`}
    >
      <Icon size={14} /> {item.label}
    </Link>
  );
}

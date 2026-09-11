import { Link, useLocation, Navigate } from 'react-router-dom';
import { LayoutDashboard, Package, ShoppingBag, Users, Shield, LogOut, ChevronRight, Cpu } from 'lucide-react';
import useAuthStore from '@/lib/authStore';
import { toast } from 'sonner';

const NAV_ITEMS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/admin/products', label: 'Products', icon: Package },
  { to: '/admin/orders', label: 'Orders', icon: ShoppingBag },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/security', label: 'Security', icon: Shield },
];

export default function AdminLayout({ children }) {
  const { user, logout, isInitialized } = useAuthStore();
  const location = useLocation();

  // Wait for auth to initialize
  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-white/20 border-t-white rounded-full" />
      </div>
    );
  }

  // Redirect non-admins
  if (!user || user.role !== 'admin') {
    return <Navigate to="/account" replace />;
  }

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out');
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r flex flex-col"
        style={{ background: "var(--bg-elev)", borderColor: "var(--border)" }}>
        <div className="p-5 border-b border-white/5">
          <Link to="/" className="flex items-center gap-2">
            <Cpu size={16} className="text-neutral-300" />
            <span className="font-bold text-[13px] tracking-tight">Reflexity RAM</span>
          </Link>
          <div className="text-[10px] text-neutral-600 mt-0.5 uppercase tracking-widest">Admin</div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon, exact }) => {
            const active = exact
              ? location.pathname === to
              : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] transition-all ${
                  active
                    ? 'bg-white/8 text-white border border-white/10'
                    : 'text-neutral-400 hover:text-white hover:bg-white/4'
                }`}
              >
                <Icon size={14} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/5">
          <div className="px-3 py-2 text-[12px] text-neutral-500 mb-1">
            {user.firstName} {user.lastName}
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
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}

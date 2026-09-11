import { Boxes, LogOut, Package, Shield, ShoppingBag, Users } from "lucide-react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import useAuthStore from "@/lib/authStore";

const ADMIN_ITEMS = [
  { to: "/admin/products", label: "Catalog inventory", icon: Package },
  { to: "/admin/wholesale", label: "Wholesale lots", icon: Boxes },
  { to: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/security", label: "Security", icon: Shield },
];

export default function AppLayout({ children, requireAdmin = false }) {
  const { user, logout, isInitialized } = useAuthStore(); const location = useLocation();
  if (!isInitialized) return <div className="min-h-screen grid place-items-center"><div className="animate-spin w-6 h-6 border-2 border-white/20 border-t-white rounded-full" /></div>;
  if (!user) return <Navigate to="/admin/sign-in" replace />;
  if (requireAdmin && user.role !== "admin") return <Navigate to="/" replace />;
  const active = (to) => location.pathname === to || location.pathname.startsWith(`${to}/`);
  return <div className="min-h-screen flex flex-col md:flex-row"><aside className="app-layout-aside sticky top-0 z-40 flex w-full shrink-0 flex-col border-b md:static md:z-auto md:w-56 md:border-b-0 md:border-r" style={{ background: "var(--bg-elev)", borderColor: "var(--border)" }}><div className="border-b p-4" style={{ borderColor: "var(--border)" }}><Link to="/" className="font-bold text-[13px]">Reflexity Wholesale</Link><div className="mt-1 mono text-[10px]">ADMIN</div></div><nav className="flex flex-1 gap-1 overflow-x-auto p-2 md:block md:space-y-1">{ADMIN_ITEMS.map(({ to, label, icon: Icon }) => <Link className={`app-sidebar-link flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-[12px] md:py-2.5 ${active(to) ? "is-active" : ""}`} key={to} to={to}><Icon size={14} />{label}</Link>)}</nav><div className="hidden border-t p-3 md:block" style={{ borderColor: "var(--border)" }}><div className="mb-1 truncate px-3 py-2 text-[12px] text-neutral-500">{user.email}</div><Link className="flex items-center gap-2 px-3 py-2 text-[12px] text-neutral-400" to="/">View website</Link><button className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-neutral-400" onClick={async () => { await logout(); toast.success("Signed out"); }}><LogOut size={14} />Sign out</button></div></aside><main className="min-w-0 flex-1 overflow-auto">{children}</main></div>;
}

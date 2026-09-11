import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  ShoppingCart, User, Menu, X,
  ChevronDown, LayoutDashboard, LogOut, Settings as SettingsIcon,
} from "lucide-react";
import { toast } from "sonner";
import ReflexityMark from "@/components/ReflexityMark";
import ThemeToggle from "@/components/ThemeToggle";
import AuthModal from "@/components/AuthModal";
import useCartStore from "@/lib/cartStore";
import useAuthStore from "@/lib/authStore";

const NAV = [
  { to: "/categories", label: "Shop RAM" },
  { to: "/wholesale", label: "Wholesale" },
  { to: "/liquidators", label: "Liquidation" },
  { to: "/support", label: "Support" },
  { to: "/guides", label: "Guides" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState("signin");
  const [accountOpen, setAccountOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const { itemCount } = useCartStore();
  const { user, logout, isAuthenticated } = useAuthStore();

  useEffect(() => {
    setOpen(false);
    setAccountOpen(false);
  }, [location.pathname, location.search]);

  const openAuth = (tab) => {
    setAuthTab(tab);
    setAuthOpen(true);
  };

  const handleLogout = async () => {
    setAccountOpen(false);
    await logout();
    toast.success("Logged out");
  };

  return (
    <>
      <header
        className="header-blur fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06]"
        data-testid="site-header"
      >
        <div className="container-tight flex items-center h-14">

          {/* ── Logo ───────────────────────────────────── */}
          <Link
            to="/"
            className="flex items-center gap-3 shrink-0 mr-8"
            data-testid="header-logo-link"
          >
            <ReflexityMark size={22} />
            <div className="leading-tight">
              <div className="brand-wordmark text-[15px]">
                reflexity<span className="brand-dot">.</span>
                <span className="brand-sub">RAM</span>
              </div>
              <div className="brand-eyebrow hidden sm:block">
                by reflexity.io
              </div>
            </div>
          </Link>

          {/* ── Desktop nav ────────────────────────────── */}
          <nav className="hidden lg:flex items-center gap-0.5 flex-1" data-testid="header-nav">
            {NAV.map((n) => (
              <Link
                key={n.label}
                to={n.to}
                className="px-4 py-2 text-[13px] font-medium text-neutral-400 hover:text-white transition-colors duration-150 rounded-lg hover:bg-white/[0.05]"
                data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          {/* ── Right side ─────────────────────────────── */}
          <div className="flex items-center gap-1.5 ml-auto">

            {/* Theme toggle — desktop only */}
            <div className="hidden md:flex items-center">
              <ThemeToggle />
            </div>

            {/* Divider */}
            <div className="hidden md:block w-px h-5 bg-white/10 mx-2" />

            {/* Account dropdown */}
            <div className="hidden md:block relative">
              <button
                onClick={() => setAccountOpen(!accountOpen)}
                className="inline-flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-neutral-400 hover:text-white transition-colors duration-150 rounded-lg hover:bg-white/[0.05]"
                data-testid="header-account-btn"
              >
                <User size={15} />
                {isAuthenticated() ? (
                  <span className="text-[12px] max-w-[80px] truncate">{user.firstName}</span>
                ) : (
                  <span className="text-[12px]">Account</span>
                )}
                <ChevronDown size={11} className="opacity-50" />
              </button>

              {accountOpen && (
                <div
                  className="absolute right-0 mt-1.5 w-48 bg-neutral-900/98 backdrop-blur border border-white/10 rounded-xl shadow-2xl overflow-hidden z-40"
                  data-testid="header-account-dropdown"
                >
                  {isAuthenticated() ? (
                    <>
                      <div className="px-4 py-3 border-b border-white/5">
                        <div className="text-[12px] font-semibold text-white truncate">
                          {user.email}
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          {user.firstName} {user.lastName}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          navigate(user.role === "admin" ? "/admin" : "/account");
                          setAccountOpen(false);
                        }}
                        className="w-full text-left px-4 py-2.5 text-[13px] text-neutral-300 hover:text-white hover:bg-white/5 transition-colors flex items-center gap-2"
                        data-testid="account-dropdown-settings"
                      >
                        <SettingsIcon size={13} /> {user.role === "admin" ? "Open admin panel" : "Open settings"}
                      </button>
                      <div className="border-t border-white/5" />
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-2.5 text-[13px] text-red-400 hover:bg-red-500/5 transition-colors flex items-center gap-2"
                        data-testid="account-dropdown-signout"
                      >
                        <LogOut size={13} /> Sign out
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { openAuth("signin"); setAccountOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-[13px] text-neutral-300 hover:text-white hover:bg-white/5 transition-colors"
                        data-testid="account-dropdown-signin"
                      >
                        Sign in
                      </button>
                      <button
                        onClick={() => { openAuth("signup"); setAccountOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-[13px] text-neutral-300 hover:text-white hover:bg-white/5 transition-colors"
                        data-testid="account-dropdown-signup"
                      >
                        Create account
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Cart */}
            <Link
              to="/cart"
              aria-label={itemCount > 0 ? `Cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}` : "Cart"}
              className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-white/[0.05] transition-colors duration-150"
              data-testid="header-cart-link"
            >
              <ShoppingCart size={17} className="text-neutral-300" />
              {itemCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-white text-black text-[9px] font-bold flex items-center justify-center"
                  data-testid="header-cart-count"
                >
                  {itemCount}
                </span>
              )}
            </Link>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setOpen((v) => !v)}
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-white/[0.05] transition-colors duration-150"
              data-testid="header-menu-toggle"
              aria-label="Menu"
            >
              {open ? <X size={17} /> : <Menu size={17} />}
            </button>
          </div>
        </div>

        {/* ── Mobile drawer ──────────────────────────────── */}
        {open && (
          <div
            className="lg:hidden border-t backdrop-blur-xl"
            style={{ background: "var(--bg-elev)", borderColor: "var(--border)" }}
            data-testid="header-mobile-drawer"
          >
            <div className="container-tight py-4 flex flex-col gap-0.5">
              {NAV.map((n) => (
                <Link
                  key={n.label}
                  to={n.to}
                  className="px-3 py-2.5 text-[14px] font-medium text-neutral-300 hover:text-white rounded-lg hover:bg-white/[0.05] transition-colors"
                >
                  {n.label}
                </Link>
              ))}
              <div className="border-t border-white/5 my-2 pt-2">
                {isAuthenticated() ? (
                  <>
                    <Link
                      to="/account"
                      className="px-3 py-2.5 text-[14px] text-neutral-300 hover:text-white flex items-center gap-2 rounded-lg hover:bg-white/[0.05] transition-colors"
                    >
                      <User size={15} /> {user.firstName}'s account
                    </Link>
                    {user.role === "admin" && (
                      <Link
                        to="/admin"
                        className="px-3 py-2.5 text-[14px] text-neutral-300 hover:text-white flex items-center gap-2 rounded-lg hover:bg-white/[0.05] transition-colors"
                      >
                        <LayoutDashboard size={15} /> Admin
                      </Link>
                    )}
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-3 py-2.5 text-[14px] text-red-400 hover:text-red-300 flex items-center gap-2 rounded-lg hover:bg-red-500/5 transition-colors"
                    >
                      <LogOut size={15} /> Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => openAuth("signin")}
                      className="w-full text-left px-3 py-2.5 text-[14px] text-neutral-300 hover:text-white flex items-center gap-2 rounded-lg hover:bg-white/[0.05] transition-colors"
                      data-testid="mobile-signin-btn"
                    >
                      Sign in
                    </button>
                    <button
                      onClick={() => openAuth("signup")}
                      className="w-full text-left px-3 py-2.5 text-[14px] text-neutral-300 hover:text-white flex items-center gap-2 rounded-lg hover:bg-white/[0.05] transition-colors"
                    >
                      Create account
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center justify-between px-3 py-2.5 border-t border-white/5 mt-1">
                <span className="text-[14px] text-neutral-400">Theme</span>
                <ThemeToggle compact />
              </div>
            </div>
          </div>
        )}
      </header>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialTab={authTab} />
    </>
  );
}

import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Ellipsis, Package, ShoppingBag, Store } from 'lucide-react';
import useAuthStore from '@/lib/authStore';
import { ADMIN_TAB_DEFS } from '@/lib/adminTabs';

// The admin's bottom tab bar on a phone: the same four places on every page, the store included, so the owner can look at the
// website as a customer sees it and get back in one tap. Orders first (it is what the alerts open). Customers never see it.
// Which tab is lit comes from lib/adminTabs.js.
const ICONS = { orders: ShoppingBag, products: Package, store: Store, more: Ellipsis };

export default function AdminTabBar() {
  const { user, isInitialized } = useAuthStore();
  const { pathname } = useLocation();
  const show = isInitialized && user?.role === 'admin';

  // Room for the bar under every page, toasts above it, and out of the way while a field has the keyboard open.
  useEffect(() => {
    if (!show) return undefined;
    const root = document.documentElement;
    root.dataset.adminShell = '1';
    document.body.classList.add('has-admin-bar');
    const isTextField = (el) => Boolean(el) && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
      || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file', 'range'].includes(el.type)));
    const onFocusIn = (event) => { if (isTextField(event.target)) root.dataset.kbd = '1'; };
    const onFocusOut = () => window.setTimeout(() => { if (!isTextField(document.activeElement)) delete root.dataset.kbd; }, 60);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.body.classList.remove('has-admin-bar');
      delete root.dataset.adminShell;
      delete root.dataset.kbd;
    };
  }, [show]);

  if (!show) return null;
  return (
    <nav className="admin-tabbar md:hidden" aria-label="Admin and store" data-testid="admin-tabbar">
      {ADMIN_TAB_DEFS.map((tab) => {
        const Icon = ICONS[tab.key];
        const active = tab.isActive(pathname);
        return (
          <Link key={tab.label} to={tab.to} className={`admin-tab ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} data-testid={`admin-tab-${tab.label.toLowerCase()}`}>
            <Icon aria-hidden="true" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

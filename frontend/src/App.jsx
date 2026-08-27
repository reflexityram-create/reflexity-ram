import "@/App.css";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster, toast } from "sonner";

import ScrollToTop from "@/components/ScrollToTop";
import { useApplyTheme, useTheme } from "@/lib/theme";
import useAuthStore from "@/lib/authStore";
import { AUTH_TOKEN_KEY } from "@/lib/authSession";

// Public pages
import Home from "@/pages/Home";
import Wholesale from "@/pages/Wholesale";
import WholesaleLot from "@/pages/WholesaleLot";
import Liquidators from "@/pages/Liquidators";
import Guides from "@/pages/Guides";
import Shop from "@/pages/Shop";
import Product from "@/pages/Product";
import Cart from "@/pages/Cart";
import Checkout from "@/pages/Checkout";
import OrderSuccess from "@/pages/OrderSuccess";
import CheckoutReturn from "@/pages/CheckoutReturn";
import Account from "@/pages/Account";
import ResetPassword from "@/pages/ResetPassword";
import VerifyEmail from "@/pages/VerifyEmail";
import NotFound from "@/pages/NotFound";
import AuthCallback from "@/pages/AuthCallback";
import Categories from "@/pages/Categories";

const WholesaleLab = import.meta.env.DEV
  ? lazy(() => import("@/pages/WholesaleLab"))
  : null;
const WholesaleAdminLab = import.meta.env.DEV
  ? lazy(() => import("@/pages/WholesaleAdminLab"))
  : null;

// Policy pages
import Shipping from "@/pages/policies/Shipping";
import Returns from "@/pages/policies/Returns";
import Warranty from "@/pages/policies/Warranty";
import Privacy from "@/pages/policies/Privacy";
import Terms from "@/pages/policies/Terms";
import Support from "@/pages/policies/Support";
import FAQ from "@/pages/policies/FAQ";
import International from "@/pages/policies/International";
import BusinessInfo from "@/pages/policies/BusinessInfo";

// Admin pages
import AdminProducts from "@/pages/admin/Products";
import AdminWholesale from "@/pages/admin/WholesaleAdmin";
import AdminOrders from "@/pages/admin/Orders";
import AdminUsers from "@/pages/admin/Users";
import AdminSecurity from "@/pages/admin/Security";

export default function App() {
  useApplyTheme();
  const theme = useTheme((s) => s.theme);
  const { initialize, clearAuth } = useAuthStore();

  // Initialize auth state on app load
  useEffect(() => {
    initialize();
  }, []);

  // Listen for token expiry events
  useEffect(() => {
    const handler = () => {
      // The API interceptor removes persisted storage synchronously. Clear the
      // in-memory Zustand state too, so protected routes cannot render stale
      // administrator data between the rejected request and a reload.
      clearAuth();
      toast.info("Your session has expired. Please sign in again.");
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, [clearAuth]);

  // localStorage expiry/logout events are delivered to the other open tabs.
  // Clear their hydrated administrator immediately instead of leaving a stale
  // protected screen visible until its next API request fails.
  useEffect(() => {
    const syncAuthTab = (event) => {
      if (event.key !== AUTH_TOKEN_KEY) return;
      const current = useAuthStore.getState();
      const nextToken = event.newValue;
      if (!nextToken) {
        if (current.user || current.token) clearAuth();
        return;
      }
      // A login in another tab replaces the bearer. Revalidate /me so the
      // visible principal and role always belong to the current token.
      if (current.token !== nextToken) void current.initialize();
    };
    window.addEventListener("storage", syncAuthTab);
    return () => window.removeEventListener("storage", syncAuthTab);
  }, [clearAuth]);

  return (
    <div className="App">
      <BrowserRouter>
        <ScrollToTop />
        <AnalyticsTracker />
        <Routes>
          {/* Store */}
          <Route path="/" element={<Home />} />
          <Route
            path="/wholesale"
            element={<Wholesale />}
          />
          <Route path="/wholesale/:lotId" element={<WholesaleLot />} />
          {WholesaleLab && (
            <Route
              path="/wholesale-lab"
              element={<Suspense fallback={null}><WholesaleLab /></Suspense>}
            />
          )}
          {WholesaleAdminLab && (
            <Route
              path="/wholesale-admin-lab"
              element={<Suspense fallback={null}><WholesaleAdminLab /></Suspense>}
            />
          )}
          <Route path="/liquidators" element={<Liquidators />} />
          <Route path="/guides" element={<Guides />} />
          <Route path="/guides/:slug" element={<Guides />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/shop/:slug" element={<Product />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order/success" element={<CheckoutReturn />} />
          <Route path="/order/:orderNumber" element={<OrderSuccess />} />
          <Route path="/account" element={<Account />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          {/* Policies */}
          <Route path="/shipping" element={<Shipping />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/warranty" element={<Warranty />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/support" element={<Support />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/international" element={<International />} />
          <Route path="/business-info" element={<BusinessInfo />} />

          {/* Admin (each page uses AppLayout requireAdmin) */}
          <Route path="/admin" element={<Navigate to="/admin/products" replace />} />
          <Route path="/admin/products" element={<AdminProducts />} />
          <Route path="/admin/wholesale" element={<AdminWholesale />} />
          <Route path="/admin/orders" element={<AdminOrders />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/security" element={<AdminSecurity />} />

          <Route path="/categories" element={<Categories />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="*" element={<NotFound />} />
        </Routes>

        <Toaster
          position="bottom-left"
          theme="dark"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "rgba(14,14,18,0.92)",
              backdropFilter: "blur(14px)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#f5f5f7",
              fontFamily: "Instrument Sans, sans-serif",
            },
            className: "reflexity-toast",
          }}
        />
      </BrowserRouter>
    </div>
  );
}

function AnalyticsTracker() {
  const location = useLocation();
  useEffect(() => {
    if (typeof window.gtag !== "function") return;
    // Never include search or hash: OAuth and order flows may carry sensitive
    // one-time values there before the router replaces the URL.
    const safePath = location.pathname;
    window.gtag("event", "page_view", {
      page_title: document.title,
      page_location: `${window.location.origin}${safePath}`,
      page_path: location.pathname,
    });
  }, [location.pathname]);
  return null;
}
// Triggering redeploy at Thu May 21 19:32:15 UTC 2026

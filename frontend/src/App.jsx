import "@/App.css";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster, toast } from "sonner";

import ScrollToTop from "@/components/ScrollToTop";
import { useApplyTheme, useTheme } from "@/lib/theme";
import useAuthStore from "@/lib/authStore";

// Public pages
import Home from "@/pages/Home";
import Wholesale from "@/pages/Wholesale";
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
import AdminOrders from "@/pages/admin/Orders";
import AdminUsers from "@/pages/admin/Users";
import AdminSecurity from "@/pages/admin/Security";

export default function App() {
  useApplyTheme();
  const theme = useTheme((s) => s.theme);
  const { initialize } = useAuthStore();

  // Initialize auth state on app load
  useEffect(() => {
    initialize();
  }, []);

  // Listen for token expiry events
  useEffect(() => {
    const handler = () => {
      // Auth store already clears token; optionally show a toast
      toast.info("Your session has expired. Please sign in again.");
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, []);

  return (
    <div className="App">
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          {/* Store */}
          <Route path="/" element={<Home />} />
          <Route path="/wholesale" element={<Wholesale />} />
          {WholesaleLab && (
            <Route
              path="/wholesale-lab"
              element={<Suspense fallback={null}><WholesaleLab /></Suspense>}
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

          {/* Admin (protected by AdminLayout) */}
          <Route path="/admin" element={<Navigate to="/admin/products" replace />} />
          <Route path="/admin/products" element={<AdminProducts />} />
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
// Triggering redeploy at Thu May 21 19:32:15 UTC 2026

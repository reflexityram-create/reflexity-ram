import "@/App.css";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster, toast } from "sonner";

import ScrollToTop from "@/components/ScrollToTop";
import AdminTabBar from "@/components/AdminTabBar";
import { useApplyTheme, useTheme } from "@/lib/theme";
import useAuthStore from "@/lib/authStore";
import useCartStore from "@/lib/cartStore";
import { CART_SESSION_KEY } from "@/lib/api";
import { AUTH_TOKEN_KEY } from "@/lib/authSession";
import {
  markAnalyticsOwner,
  shouldTrackLocation,
  trackPageEngagement,
  trackPageExit,
  trackPageView,
  trackVisit,
} from "@/lib/analytics";

// Public pages
import Home from "@/pages/Home";
const Wholesale = lazy(() => import("@/pages/Wholesale"));
const WholesaleLot = lazy(() => import("@/pages/WholesaleLot"));
const Liquidators = lazy(() => import("@/pages/Liquidators"));
const Guides = lazy(() => import("@/pages/Guides"));
const Shop = lazy(() => import("@/pages/Shop"));
const Product = lazy(() => import("@/pages/Product"));
const Cart = lazy(() => import("@/pages/Cart"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const CheckoutEtransfer = lazy(() => import("@/pages/CheckoutEtransfer"));
const OrderSuccess = lazy(() => import("@/pages/OrderSuccess"));
const ReviewOrder = lazy(() => import("@/pages/ReviewOrder"));
const CheckoutReturn = lazy(() => import("@/pages/CheckoutReturn"));
const Account = lazy(() => import("@/pages/Account"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const VerifyEmail = lazy(() => import("@/pages/VerifyEmail"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const Categories = lazy(() => import("@/pages/Categories"));

const WholesaleLab = import.meta.env.DEV
  ? lazy(() => import("@/pages/WholesaleLab"))
  : null;
const WholesaleLabLot = import.meta.env.DEV
  ? lazy(() => import("@/pages/WholesaleLabLot"))
  : null;
const WholesaleAdminLab = import.meta.env.DEV
  ? lazy(() => import("@/pages/WholesaleAdminLab"))
  : null;

// Policy pages
const Shipping = lazy(() => import("@/pages/policies/Shipping"));
const Returns = lazy(() => import("@/pages/policies/Returns"));
const Warranty = lazy(() => import("@/pages/policies/Warranty"));
const Privacy = lazy(() => import("@/pages/policies/Privacy"));
const Terms = lazy(() => import("@/pages/policies/Terms"));
const Support = lazy(() => import("@/pages/policies/Support"));
const FAQ = lazy(() => import("@/pages/policies/FAQ"));
const International = lazy(() => import("@/pages/policies/International"));
const BusinessInfo = lazy(() => import("@/pages/policies/BusinessInfo"));

// Admin pages
const AdminProducts = lazy(() => import("@/pages/admin/Products"));
const AdminOrders = lazy(() => import("@/pages/admin/Orders"));
const AdminUsers = lazy(() => import("@/pages/admin/Users"));
const AdminSecurity = lazy(() => import("@/pages/admin/Security"));
const AdminVisitors = lazy(() => import("@/pages/admin/Visitors"));
const AdminMore = lazy(() => import("@/pages/admin/More"));

export default function App() {
  useApplyTheme();
  const theme = useTheme((s) => s.theme);
  const { initialize, clearAuth } = useAuthStore();

  // Initialize auth state on app load
  useEffect(() => {
    initialize();
  }, []);

  // The cart lives on the server and only the cart pages read it, so a returning buyer's header showed no count until they
  // opened the cart. Read it once at start for anyone who has a cart session or is signed in (a first visit has no cart).
  useEffect(() => {
    let returning = false;
    try {
      returning = Boolean(localStorage.getItem(CART_SESSION_KEY) || localStorage.getItem(AUTH_TOKEN_KEY));
    } catch {
      /* storage blocked: the cart pages still read the cart */
    }
    if (returning) useCartStore.getState().fetchCart();
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
        <AdminTabBar />
        <Suspense fallback={null}><Routes>
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
          {WholesaleLabLot && (
            <Route
              path="/wholesale-lab/:lotId"
              element={<Suspense fallback={null}><WholesaleLabLot /></Suspense>}
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
          <Route path="/checkout/e-transfer" element={<CheckoutEtransfer />} />
          <Route path="/order/success" element={<CheckoutReturn />} />
          <Route path="/order/:orderNumber" element={<OrderSuccess />} />
          <Route path="/review" element={<ReviewOrder />} />
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
          {/* Wholesale lots now sit on the Products page; old links land there. */}
          <Route path="/admin/wholesale" element={<Navigate to="/admin/products#wholesale" replace />} />
          <Route path="/admin/orders" element={<AdminOrders />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/visitors" element={<AdminVisitors />} />
          <Route path="/admin/security" element={<AdminSecurity />} />
          <Route path="/admin/more" element={<AdminMore />} />

          <Route path="/categories" element={<Categories />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="*" element={<NotFound />} />
        </Routes></Suspense>

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
    const safePath = location.pathname || "/";
    // page_location: `${window.location.origin}${safePath}`
    // page_path: location.pathname
    // Safe location remains query-free; the
    // helper deliberately omits search and hash values.
    if (/^\/admin(?:\/|$)/.test(safePath)) markAnalyticsOwner();
    // Our own visit log (IP address, place, device: see lib/analytics.js); it does not depend on GA4 having loaded. After a tick, like the
    // GA page view below, so the page has set its title by then.
    const visitTimer = window.setTimeout(() => trackVisit(safePath), 0);
    if (!shouldTrackLocation(window.location) || typeof window.gtag !== "function") {
      return () => window.clearTimeout(visitTimer);
    }

    let engagedMs = 0;
    let reportedEngagedMs = 0;
    let lastVisibleAt = document.visibilityState === "hidden" ? null : Date.now();
    let exited = false;
    const accumulate = () => {
      if (lastVisibleAt !== null) {
        engagedMs += Math.max(0, Date.now() - lastVisibleAt);
        lastVisibleAt = Date.now();
      }
    };
    const exit = (reason) => {
      if (exited) return;
      accumulate();
      exited = true;
      trackPageExit({ pathname: safePath, engagedMs, reason });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        accumulate();
        if (!exited && engagedMs > reportedEngagedMs) {
          trackPageEngagement({ pathname: safePath, engagedMs: engagedMs - reportedEngagedMs });
          reportedEngagedMs = engagedMs;
        }
        lastVisibleAt = null;
      } else if (!exited) {
        lastVisibleAt = Date.now();
      }
    };
    const onPageHide = (event) => exit(event.persisted ? "bfcache" : "pagehide");
    const onPageShow = (event) => {
      if (event.persisted && !exited) return;
      if (event.persisted) {
        exited = false;
        engagedMs = 0;
        reportedEngagedMs = 0;
        lastVisibleAt = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    const engagementTimer = window.setInterval(() => {
      if (exited || document.visibilityState === "hidden") return;
      accumulate();
      if (engagedMs - reportedEngagedMs >= 15000) {
        trackPageEngagement({ pathname: safePath, engagedMs: engagedMs - reportedEngagedMs });
        reportedEngagedMs = engagedMs;
      }
    }, 15000);

    const viewTimer = window.setTimeout(() => {
      if (!exited) trackPageView(safePath);
    }, 0);
    return () => {
      window.clearTimeout(visitTimer);
      window.clearTimeout(viewTimer);
      window.clearInterval(engagementTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      exit("route_change");
    };
  }, [location.pathname]);
  return null;
}
// Triggering redeploy at Thu May 21 19:32:15 UTC 2026

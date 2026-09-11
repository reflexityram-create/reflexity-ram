import "@/App.css";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster, toast } from "sonner";
import ScrollToTop from "@/components/ScrollToTop";
import { useApplyTheme } from "@/lib/theme";
import useAuthStore from "@/lib/authStore";
import { AUTH_TOKEN_KEY } from "@/lib/authSession";
import { shouldTrackLocation } from "@/lib/analytics";
import Home from "@/pages/Home";

const Inventory = lazy(() => import("@/pages/Shop"));
const InventoryItem = lazy(() => import("@/pages/Product"));
const Wholesale = lazy(() => import("@/pages/Wholesale"));
const WholesaleLot = lazy(() => import("@/pages/WholesaleLot"));
const SellToUs = lazy(() => import("@/pages/SellToUs"));
const Contact = lazy(() => import("@/pages/Contact"));
const About = lazy(() => import("@/pages/About"));
const AdminSignIn = lazy(() => import("@/pages/AdminSignIn"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Guides = lazy(() => import("@/pages/Guides"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const Shipping = lazy(() => import("@/pages/policies/Shipping"));
const Returns = lazy(() => import("@/pages/policies/Returns"));
const Warranty = lazy(() => import("@/pages/policies/Warranty"));
const Privacy = lazy(() => import("@/pages/policies/Privacy"));
const Terms = lazy(() => import("@/pages/policies/Terms"));
const FAQ = lazy(() => import("@/pages/policies/FAQ"));
const International = lazy(() => import("@/pages/policies/International"));
const AdminProducts = lazy(() => import("@/pages/admin/Products"));
const AdminWholesale = lazy(() => import("@/pages/admin/WholesaleAdmin"));
const AdminOrders = lazy(() => import("@/pages/admin/Orders"));
const AdminUsers = lazy(() => import("@/pages/admin/Users"));
const AdminSecurity = lazy(() => import("@/pages/admin/Security"));
const WholesaleLab = import.meta.env.DEV ? lazy(() => import("@/pages/WholesaleLab")) : null;
const WholesaleLabLot = import.meta.env.DEV ? lazy(() => import("@/pages/WholesaleLabLot")) : null;
const WholesaleAdminLab = import.meta.env.DEV ? lazy(() => import("@/pages/WholesaleAdminLab")) : null;

function LegacyInventoryRedirect() { const location = useLocation(); return <Navigate replace to={`/inventory${location.search}`} />; }
function LegacyProductRedirect() { const { pathname, search } = useLocation(); return <Navigate replace to={pathname.replace(/^\/shop/, "/inventory") + search} />; }
function LegacyCategoriesRedirect() { const location = useLocation(); return <Navigate replace to={`/inventory${location.search}`} />; }

export default function App() {
  useApplyTheme(); const { initialize, clearAuth } = useAuthStore();
  useEffect(() => { initialize(); }, [initialize]);
  useEffect(() => { const handler = () => { clearAuth(); toast.info("Your administrator session has expired."); }; window.addEventListener("auth:expired", handler); return () => window.removeEventListener("auth:expired", handler); }, [clearAuth]);
  useEffect(() => {
    const syncAuthTab = (event) => {
      if (event.key !== AUTH_TOKEN_KEY) return;
      const current = useAuthStore.getState();
      const nextToken = event.newValue;
      if (!nextToken) { if (current.user || current.token) clearAuth(); return; }
      if (current.token !== nextToken) void current.initialize();
    };
    window.addEventListener("storage", syncAuthTab);
    return () => window.removeEventListener("storage", syncAuthTab);
  }, [clearAuth]);
  return <div className="App"><BrowserRouter><ScrollToTop /><AnalyticsTracker /><Suspense fallback={null}><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/inventory" element={<Inventory />} /><Route path="/inventory/:slug" element={<InventoryItem />} />
    <Route path="/categories" element={<LegacyCategoriesRedirect />} />
    <Route path="/shop" element={<LegacyInventoryRedirect />} /><Route path="/shop/:slug" element={<LegacyProductRedirect />} />
    <Route path="/wholesale" element={<Wholesale />} /><Route path="/wholesale/:lotId" element={<WholesaleLot />} />
    {WholesaleLab && <Route path="/wholesale-lab" element={<WholesaleLab />} />}{WholesaleLabLot && <Route path="/wholesale-lab/:lotId" element={<WholesaleLabLot />} />}{WholesaleAdminLab && <Route path="/wholesale-admin-lab" element={<WholesaleAdminLab />} />}
    <Route path="/sell-to-us" element={<SellToUs />} /><Route path="/liquidators" element={<Navigate replace to="/sell-to-us" />} />
    <Route path="/contact" element={<Contact />} /><Route path="/about" element={<About />} /><Route path="/business-info" element={<Navigate replace to="/about" />} />
    <Route path="/guides" element={<Guides />} /><Route path="/guides/:slug" element={<Guides />} />
    <Route path="/shipping" element={<Shipping />} /><Route path="/returns" element={<Returns />} /><Route path="/warranty" element={<Warranty />} /><Route path="/privacy" element={<Privacy />} /><Route path="/terms" element={<Terms />} /><Route path="/faq" element={<FAQ />} /><Route path="/international" element={<International />} />
    <Route path="/support" element={<Navigate replace to="/contact" />} />
    <Route path="/admin/sign-in" element={<AdminSignIn />} /><Route path="/auth/callback" element={<AuthCallback />} /><Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/admin" element={<Navigate to="/admin/products" replace />} /><Route path="/admin/products" element={<AdminProducts />} /><Route path="/admin/wholesale" element={<AdminWholesale />} /><Route path="/admin/orders" element={<AdminOrders />} /><Route path="/admin/users" element={<AdminUsers />} /><Route path="/admin/security" element={<AdminSecurity />} />
    <Route path="*" element={<NotFound />} />
  </Routes></Suspense><Toaster position="bottom-left" theme="dark" closeButton /></BrowserRouter></div>;
}

function AnalyticsTracker() { const location = useLocation(); useEffect(() => { if (shouldTrackLocation(window.location) && typeof window.gtag === "function") window.gtag("event", "page_view", { page_title: document.title, page_location: `${window.location.origin}${location.pathname}`, page_path: location.pathname }); }, [location.pathname]); return null; }

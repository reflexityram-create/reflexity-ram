import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import useAuthStore from "@/lib/authStore";
import { authApi } from "@/lib/api";

export default function AuthCallback() {
  const navigate = useNavigate(); const { setAuthToken, setAuthenticatedUser, clearAuth } = useAuthStore();
  useEffect(() => { const query = new URLSearchParams(window.location.search); const hash = new URLSearchParams(window.location.hash.replace(/^#/, "")); window.history.replaceState({}, "", "/auth/callback"); const token = hash.get("token"); if (query.get("auth_error") || !token) { toast.error("Administrator sign-in failed."); navigate("/admin/sign-in", { replace: true }); return; } let active = true; void (async () => { try { setAuthToken(token); const { data } = await authApi.me(); if (!active || data?.user?.role !== "admin") throw new Error("not administrator"); setAuthenticatedUser(data.user); navigate("/admin", { replace: true }); } catch { if (!active) return; clearAuth(); toast.error("Administrator sign-in failed."); navigate("/admin/sign-in", { replace: true }); } })(); return () => { active = false; }; }, [clearAuth, navigate, setAuthToken, setAuthenticatedUser]);
  return <main className="page grid min-h-screen place-items-center"><p>Signing in to Reflexity administration…</p></main>;
}

import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import useAuthStore from "@/lib/authStore";
import { authApi } from "@/lib/api";

const apiOrigin = (import.meta.env.VITE_API_URL || "https://reflexity-ram.onrender.com/api").replace(/\/api$/, "");

export default function AdminSignIn() {
  const navigate = useNavigate(); const { user, login, isLoading } = useAuthStore();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [showPassword, setShowPassword] = useState(false); const [error, setError] = useState(""); const [sent, setSent] = useState(false);
  if (user?.role === "admin") return <Navigate to="/admin" replace />;
  const submit = async (event) => { event.preventDefault(); setError(""); const result = await login({ email, password }); if (!result.success) { setError(result.message); return; } if (useAuthStore.getState().user?.role !== "admin") { useAuthStore.getState().clearAuth(); setError("This sign-in is restricted to Reflexity administrators."); return; } navigate("/admin", { replace: true }); };
  const forgot = async () => { if (!email) { setError("Enter your administrator email first."); return; } setError(""); try { await authApi.forgotPassword(email); setSent(true); } catch (requestError) { setError(requestError?.response?.data?.error || "Could not send a reset link."); } };
  return <main className="page"><section className="container-tight admin-signin"><div className="lead-form"><p className="mono">REFLEXITY / ADMINISTRATOR</p><h1>Sign in to manage inventory.</h1><p>Administrator access only. Public registration is not available here.</p><a className="admin-google" href={`${apiOrigin}/api/auth/google?intent=admin`}>Continue with Google</a><div className="admin-divider">or email and password</div><form onSubmit={submit}><label htmlFor="admin-email">Administrator email</label><input id="admin-email" className="input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /><label htmlFor="admin-password">Password</label><div className="relative"><input id="admin-password" className="input pr-10" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button className="absolute right-3 top-3 text-neutral-400" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>{error && <p role="alert" className="lead-error">{error}</p>}{sent && <p role="status">If the email is recognized, a reset link has been sent.</p>}<button className="btn-primary" disabled={isLoading} type="submit">{isLoading && <Loader2 className="animate-spin" size={15} />}Sign in</button><button className="admin-forgot" type="button" onClick={forgot}>Forgot password?</button></form><Link to="/" className="text-link">Back to website</Link></div></section></main>;
}

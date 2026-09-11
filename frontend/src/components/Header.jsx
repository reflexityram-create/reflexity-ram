import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import ReflexityMark from "@/components/ReflexityMark";

const NAV = [["/", "Home"], ["/inventory", "Inventory"], ["/sell-to-us", "Sell to Us"], ["/wholesale", "Wholesale"], ["/about", "About"], ["/contact", "Contact"]];

export default function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current = (to) => to === "/" ? location.pathname === "/" : location.pathname === to || location.pathname.startsWith(`${to}/`);
  return <header className="header-blur fixed top-0 left-0 right-0 z-50 border-b" data-testid="site-header"><div className="container-tight header-inner">
    <Link to="/" className="header-brand" onClick={() => setOpen(false)} data-testid="header-logo-link"><ReflexityMark size={23} /><span className="brand-wordmark">reflexity<span className="brand-dot">.</span><span className="brand-sub">WHOLESALE</span></span></Link>
    <nav className="header-nav" aria-label="Primary navigation" data-testid="header-nav">{NAV.map(([to, label]) => <Link key={to} to={to} className={current(to) ? "is-current" : ""}>{label}</Link>)}</nav>
    <Link className="header-quote" to="/contact?intent=buy&productType=RAM">Request a quote</Link>
    <button className="header-menu" aria-expanded={open} aria-label="Toggle navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
    {open && <nav className="header-mobile" aria-label="Mobile navigation">{NAV.map(([to, label]) => <Link key={to} to={to} onClick={() => setOpen(false)}>{label}</Link>)}</nav>}
  </div></header>;
}

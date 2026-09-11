import { Link } from "react-router-dom";
import ReflexityMark from "@/components/ReflexityMark";

export default function Footer() {
  return <footer className="site-footer"><div className="container-tight footer-grid"><div><div className="header-brand"><ReflexityMark size={21} /><span className="brand-wordmark">reflexity<span className="brand-dot">.</span><span className="brand-sub">WHOLESALE</span></span></div><p>Bulk computer memory and related IT hardware inquiries from Toronto, Ontario, Canada.</p><a href="mailto:reflexityram@gmail.com">reflexityram@gmail.com</a></div><div><h2>Business</h2><Link to="/inventory">Inventory</Link><Link to="/wholesale">Wholesale buyers</Link><Link to="/sell-to-us">Sell hardware</Link><Link to="/contact">Request a quote</Link></div><div><h2>Information</h2><Link to="/about">About</Link><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/shipping">Shipping &amp; terms</Link><Link to="/faq">FAQ</Link><Link to="/admin/sign-in">Admin sign-in</Link></div></div><div className="container-tight footer-bottom">© {new Date().getFullYear()} Reflexity RAM. Catalog availability is subject to confirmation.</div></footer>;
}

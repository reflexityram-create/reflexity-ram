import { Link } from "react-router-dom";
import ReflexityMark from "@/components/ReflexityMark";
import { trackEvent } from "@/lib/analytics";

export default function Footer() {
  return (
    <footer
      className="relative z-10 border-t border-white/5 mt-24 pt-16 pb-10"
      data-testid="site-footer"
    >
      <div className="container-tight grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
        {/* LEFT: Brand */}
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <ReflexityMark size={28} />
            <div>
              <div className="font-semibold tracking-tight text-[14px]">Reflexity RAM</div>
            </div>
          </div>
          <p className="text-[12px] text-neutral-400 leading-relaxed mb-3">
            Independent online memory retailer based in Toronto, Ontario, Canada.
          </p>
          <p className="text-[12px] text-neutral-500">
            DDR4 · DDR5 · Server · Laptop
          </p>
        </div>

        {/* CENTER: Support */}
        <div>
          <div className="mono text-[10px] text-neutral-500 uppercase tracking-widest mb-4">
            Support
          </div>
          <div className="flex flex-col gap-2.5 text-[13px]">
            <Link to="/shipping" className="text-neutral-300 hover:text-white transition-colors">Shipping</Link>
            <Link to="/international" className="text-neutral-300 hover:text-white transition-colors">International Orders</Link>
            <Link to="/returns" className="text-neutral-300 hover:text-white transition-colors">Returns</Link>
            <Link to="/warranty" className="text-neutral-300 hover:text-white transition-colors">Warranty</Link>
            <Link to="/faq" className="text-neutral-300 hover:text-white transition-colors">FAQ</Link>
            <Link to="/business-info" className="text-neutral-300 hover:text-white transition-colors">Business information</Link>
          </div>
        </div>

        {/* RIGHT: Contact & Status */}
        <div>
          <a
            href="mailto:reflexityram@gmail.com"
            onClick={() => trackEvent("contact", { contact_method: "email", contact_context: "footer" })}
            className="text-[13px] text-neutral-300 hover:text-white transition-colors font-medium"
            data-testid="footer-email"
          >
            reflexityram@gmail.com
          </a>
          <div className="mt-4 flex items-center gap-2 text-[11px] mono text-neutral-500" data-testid="footer-status">
            <span className="dot dot-green pulse-dot" />
            Operational
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[12px]">
            <Link to="/terms" className="text-neutral-400 hover:text-white transition-colors">Terms</Link>
            <Link to="/privacy" className="text-neutral-400 hover:text-white transition-colors">Privacy</Link>
          </div>
        </div>
      </div>

      {/* BOTTOM: Copyright + License */}
      <div className="container-tight pt-6 border-t border-white/5 mono text-[11px] flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between" style={{ color: "var(--fg-muted)" }}>
        <div>© 2026 Reflexity RAM.</div>
        <div>
          Licensed under the{" "}
          <a
            href="/LICENSE.txt"
            className="text-neutral-400 hover:text-white transition-colors underline underline-offset-4"
          >
            Apache License 2.0
          </a>
          .
        </div>
      </div>
    </footer>
  );
}

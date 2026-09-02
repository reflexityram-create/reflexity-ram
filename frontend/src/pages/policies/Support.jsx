import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Truck,
  RotateCcw,
  Shield,
  HelpCircle,
  Mail,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SectionLabel from "@/components/SectionLabel";
import { useSEO } from "@/lib/seo";
import { trackEvent } from "@/lib/analytics";

const SUPPORT_EMAIL = "reflexityram@gmail.com";
const GMAIL_COMPOSE_URL =
  "https://mail.google.com/mail/u/0/?fs=1&to=reflexityram@gmail.com&su=Reflexity+RAM+%E2%80%94+Support&tf=cm";

const CARDS = [
  { icon: HelpCircle, title: "FAQ", caption: "Compatibility, orders, wholesale.", to: "/faq" },
  { icon: Truck, title: "Shipping", caption: "Rates, transit times, packaging.", to: "/shipping" },
  { icon: RotateCcw, title: "Returns", caption: "Return eligibility and process.", to: "/returns" },
  { icon: Shield, title: "Warranty", caption: "Coverage and claim process.", to: "/warranty" },
];

export default function Support() {
  useSEO({ title: "Support Center", description: "Get help with orders, shipping, returns, and warranty." });
  const [copied, setCopied] = useState(false);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
    } catch {
      const t = document.createElement("textarea");
      t.value = SUPPORT_EMAIL;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      document.body.removeChild(t);
    }
    setCopied(true);
    toast.success("Email copied", {
      description: SUPPORT_EMAIL,
      icon: <Check size={16} className="text-emerald-400" />,
    });
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <>
      <Header />
      <main className="page" data-testid="support-page">
        <div className="container-tight pt-12 pb-16">
          <SectionLabel num="04">Support</SectionLabel>
          <h1 className="display-2 display-grad mt-4 mb-4">Support Center</h1>
          <p className="text-neutral-400 max-w-2xl leading-relaxed">
            Find answers to common questions or contact us directly.
          </p>

          {/* Help topics */}
          <div className="mt-12">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="support-cards">
              {CARDS.map((c, i) => (
                <Link
                  key={c.title}
                  to={c.to}
                  className="glass card-hover rounded-xl p-5 fade-up"
                  style={{ animationDelay: `${i * 0.04}s` }}
                  data-testid={`support-card-${c.title.toLowerCase()}`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                      <c.icon size={16} className="text-neutral-300" />
                    </div>
                    <div className="text-[15px] font-semibold tracking-tight">{c.title}</div>
                  </div>
                  <div className="text-[13px] text-neutral-400">{c.caption}</div>
                </Link>
              ))}
            </div>
          </div>

          {/* Contact section */}
          <div className="mt-16 pt-12 border-t border-white/5">
            <h2 className="display-3 mb-6">Need more help?</h2>
            <div className="glass rounded-2xl p-8 md:p-10" data-testid="support-email-card">
              <div className="mono text-[10px] text-neutral-500 tracking-widest mb-3">EMAIL</div>
              <div className="text-2xl md:text-3xl font-bold tracking-tight break-all mb-6" data-testid="support-email-display">
                {SUPPORT_EMAIL}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={copyEmail}
                  className="btn-secondary"
                  data-testid="support-copy-email-btn"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? "Copied" : "Copy email"}
                </button>
                <a
                  href={GMAIL_COMPOSE_URL}
                  onClick={() => trackEvent("contact", { contact_method: "email", contact_context: "support" })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                  data-testid="support-send-email-btn"
                >
                  <Mail size={15} /> Send via Gmail
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

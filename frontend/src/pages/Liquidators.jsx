import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Mail, Copy, Check, ArrowRight,
  Server, HardDrive, Network, Laptop, MemoryStick,
} from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useSEO } from "@/lib/seo";
import { trackEvent } from "@/lib/analytics";

/**
 * Reflexity Liquidators — IT asset liquidation landing page.
 *
 * Sibling to /wholesale, positioned as the sourcing side of Reflexity RAM —
 * liquidated server memory feeds the RAM resale pipeline.
 */

const SUPPORT_EMAIL = "reflexityram@gmail.com";
const GMAIL_COMPOSE_URL =
  "https://mail.google.com/mail/u/0/?fs=1&to=reflexityram@gmail.com&su=Reflexity+Liquidators+%E2%80%94+Asset+list&tf=cm";

const STATS = [
  { label: "Focus", value: "Retired IT hardware" },
  { label: "Quote turnaround", value: "48 hours" },
  { label: "Payout", value: "Wire · e-transfer" },
  { label: "Pickup", value: "GTA + prepaid shipping" },
];

const WHAT_WE_TAKE = [
  {
    icon: Server,
    title: "Servers & blades",
    sub: "Racks · chassis",
    body: "Full racks, blade servers, and chassis pulls — running or dead, single units or whole rooms.",
    primary: true,
  },
  {
    icon: MemoryStick,
    title: "Server & DIMM memory",
    sub: "RDIMM · LRDIMM · ECC",
    body: "Any quantity, any condition. This is what feeds directly into the Reflexity RAM test-and-resell line.",
  },
  {
    icon: HardDrive,
    title: "Drives",
    sub: "HDD · SSD · NVMe",
    body: "Certified data destruction available before resale or recycling.",
  },
  {
    icon: Network,
    title: "Networking gear",
    sub: "Switches · NICs",
    body: "Enterprise switches, network cards, and rack cabling pulled during a refresh.",
  },
  {
    icon: Laptop,
    title: "Laptop & desktop fleets",
    sub: "Bulk retired fleets",
    body: "End-of-lease or refresh-cycle fleets, picked up and quoted as one lot.",
  },
];

const TERMS = [
  {
    title: "Send the inventory list",
    body: "Photos, asset tags, or just a rough count and model — whatever you have. No spreadsheet template required.",
  },
  {
    title: "One lump-sum quote",
    body: "We price the lot as a whole. No per-item haggling, no consignment, no public auction.",
  },
  {
    title: "Pickup or prepaid shipping",
    body: "GTA gets a truck. Outside the GTA ships prepaid on a label we send.",
  },
  {
    title: "Data destruction on request",
    body: "Drives and anything with onboard storage can be certified-wiped or shredded before resale.",
  },
  {
    title: "Paid on receipt",
    body: "Payout goes out once the lot is received and matches what was quoted — no net-30, no waiting on resale.",
  },
  {
    title: "Feeds Reflexity RAM directly",
    body: "Memory pulled from liquidated lots gets tested and listed on Reflexity RAM — the same pipeline you'd buy from as a customer.",
  },
];

export default function Liquidators() {
  useSEO({
    title: "IT Asset Liquidation — Reflexity Liquidators",
    description:
      "Sell decommissioned servers, RAM, drives, and networking gear in bulk. One quote, one pickup, paid on receipt. IT asset liquidation out of Toronto, Canada.",
  });
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
    toast.success("Email copied", { description: SUPPORT_EMAIL });
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <>
      <Header />
      <main className="page" data-testid="liquidators-page">
        {/* Hero */}
        <section className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="container-tight pt-16 pb-14">
            <div className="section-label mb-5">
              <span className="num">01</span> IT ASSET LIQUIDATION
            </div>
            <h1 className="display-2 max-w-[18ch]">
              Retiring hardware? Turn it into <span className="hl">cash</span>, fast.
            </h1>
            <p className="mt-5 text-[17px] max-w-[56ch]" style={{ color: "var(--fg-muted)" }}>
              We buy decommissioned servers, memory, drives, and networking gear in
              bulk — straight from data centers and IT departments out of Toronto.
              One quote against the whole lot, one pickup, paid on receipt.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href={GMAIL_COMPOSE_URL} onClick={() => trackEvent("generate_lead", { lead_type: "liquidation_quote" })} target="_blank" rel="noopener noreferrer" className="btn-primary">
                <Mail size={16} /> Send your inventory list
              </a>
              <a href="#what-we-take" className="btn-secondary">
                See what we buy <ArrowRight size={15} />
              </a>
            </div>

            <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-px rounded-xl overflow-hidden"
                 style={{ background: "var(--border)" }}>
              {STATS.map((s) => (
                <div key={s.label} className="px-5 py-4" style={{ background: "var(--bg)" }}>
                  <div className="mono text-[10.5px] uppercase" style={{ color: "var(--fg-faint)" }}>
                    {s.label}
                  </div>
                  <div className="mt-1 font-semibold text-[15px]">{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What we take */}
        <section id="what-we-take" className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="container-tight pt-16 pb-14">
            <div className="section-label mb-6">
              <span className="num">02</span> WHAT WE TAKE
            </div>
            <h2 className="display-3 mb-8">Not sure it's worth listing? Send it anyway.</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {WHAT_WE_TAKE.map(({ icon: Icon, title, sub, body, primary }) => (
                <div
                  key={title}
                  className="glass card-hover rounded-xl p-6 flex flex-col"
                  style={{
                    gridColumn: primary ? "span 2" : undefined,
                    borderTop: primary ? "3px solid var(--brand-yellow)" : undefined,
                  }}
                >
                  <Icon
                    size={primary ? 30 : 24}
                    style={{ color: primary ? "var(--brand-yellow-deep)" : "var(--fg-muted)" }}
                  />
                  <div className="mt-4 font-semibold" style={{ fontSize: primary ? 21 : 17 }}>
                    {title}
                  </div>
                  <div className="mono text-[11px] mt-1" style={{ color: "var(--fg-faint)" }}>
                    {sub}
                  </div>
                  <p className="text-[14px] mt-3 flex-1" style={{ color: "var(--fg-muted)" }}>
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How liquidation works */}
        <section className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="container-tight pt-16 pb-14">
            <div className="section-label mb-6">
              <span className="num">03</span> HOW LIQUIDATION WORKS
            </div>
            <h2 className="display-3 mb-8">Terms, plainly</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {TERMS.map((t) => (
                <div key={t.title} className="glass card-hover rounded-xl p-6">
                  <div className="font-semibold text-[15px] mb-2">{t.title}</div>
                  <div className="text-[14px]" style={{ color: "var(--fg-muted)" }}>{t.body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact */}
        <section>
          <div className="container-tight pt-16 pb-16">
            <div className="section-label mb-6">
              <span className="num">04</span> GET A QUOTE
            </div>
            <h2 className="display-3 mb-3">Send us the list</h2>
            <p className="text-[15px] mb-8" style={{ color: "var(--fg-muted)" }}>
              A rough count and model is enough to start. We answer the same business day.
            </p>
            <div className="glass rounded-xl p-8">
              <div className="mono text-xl md:text-2xl font-medium break-all mb-6">
                {SUPPORT_EMAIL}
              </div>
              <div className="flex flex-wrap gap-3">
                <button onClick={copyEmail} className="btn-secondary" data-testid="liquidators-copy-email-btn">
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? "Copied" : "Copy email"}
                </button>
                <a
                  href={GMAIL_COMPOSE_URL}
                  onClick={() => trackEvent("generate_lead", { lead_type: "liquidation_quote" })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                  data-testid="liquidators-send-email-btn"
                >
                  <Mail size={15} /> Send via Gmail
                </a>
              </div>
              <div className="mt-6 pt-6 border-t text-[13px]" style={{ borderColor: "var(--border)", color: "var(--fg-faint)" }}>
                Buying instead of selling? <Link to="/wholesale" className="underline" style={{ color: "var(--fg-muted)" }}>Check wholesale pricing on tested stock</Link>.
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

import { Link, useParams } from "react-router-dom";
import { ArrowRight, BookOpen, CheckCircle2 } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useSEO } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";

const GUIDES = [
  {
    slug: "ddr4-vs-ddr5",
    title: "DDR4 or DDR5? Compatibility, Speed, and Upgrade Guide",
    description: "Compare DDR4 and DDR5 speed, compatibility, price, and upgrade value before buying desktop or laptop RAM in Canada.",
    keywords: "DDR4 vs DDR5, DDR5 RAM Canada, DDR4 upgrade",
    cta: { label: "Browse RAM by generation", to: "/categories" },
    sections: [
      ["The short answer", "DDR4 and DDR5 are not interchangeable. Your motherboard and processor determine which generation you can install. If your system supports DDR5, it offers higher bandwidth and newer platforms. If it uses DDR4, a tested DDR4 upgrade is usually the best value."],
      ["Compatibility comes first", "DDR4 modules have a different key notch and electrical design from DDR5 modules, so they cannot be installed in the wrong slot. Check the motherboard model, CPU generation, and official memory support list before ordering. Laptop buyers should also confirm whether memory is upgradeable or soldered."],
      ["When DDR4 makes sense", "DDR4 is widely available, cost-effective, and a strong choice for office PCs, older gaming systems, workstations, and servers. For many upgrades, adding capacity matters more than chasing a higher transfer rate."],
      ["When DDR5 makes sense", "Choose DDR5 when you are building a compatible new system or need the bandwidth of a current platform. For stability, use a matched kit and enable XMP or EXPO only after the system boots at its base speed."],
    ],
  },
  {
    slug: "ecc-rdimm-udimm-explained",
    title: "RDIMM vs UDIMM: ECC, LRDIMM, and Server RAM Explained",
    description: "Learn the difference between ECC, registered RDIMM, load-reduced LRDIMM, and unbuffered UDIMM server memory.",
    keywords: "ECC RAM, RDIMM vs UDIMM, LRDIMM server memory",
    cta: { label: "Shop tested server RAM", to: "/shop" },
    sections: [
      ["ECC memory", "ECC adds error detection and correction for many single-bit memory errors. It is common in servers, workstations, and systems where reliability matters. ECC support depends on the motherboard and CPU; an ECC module is not automatically compatible with every desktop platform."],
      ["UDIMM", "Unbuffered DIMMs are common in desktops and many entry-level systems. They communicate directly with the memory controller and are the usual choice for consumer motherboards. Do not substitute a registered DIMM for a UDIMM unless the platform documentation explicitly supports it."],
      ["RDIMM", "Registered DIMMs place a register between the memory controller and the memory chips. This reduces electrical load and lets supported servers use more modules and larger capacities. RDIMM is primarily a server format and must match the server CPU and board."],
      ["LRDIMM", "Load-reduced DIMMs use additional buffering to support very high capacities in compatible servers. LRDIMM and RDIMM are not interchangeable in most systems. Check the server manufacturer's memory population rules before buying."],
    ],
  },
  {
    slug: "how-to-identify-ram",
    title: "How to Identify RAM: Read a RAM Label and Part Number",
    description: "Use the label and model number to identify RAM capacity, DDR generation, speed, form factor, ECC type, and rank.",
    keywords: "identify RAM part number, Samsung RAM model number, server RAM label",
    cta: { label: "Search the RAM catalog", to: "/shop" },
    sections: [
      ["Start with the exact model", "Search the complete label number, including letters and suffixes. A model such as M471A2K43DB1-CTD can identify a specific Samsung module more reliably than a generic search for 16GB DDR4."],
      ["Read the key specifications", "Look for capacity, DDR generation, transfer rate, and the PC4 or PC5 speed code. SO-DIMM usually indicates laptop memory, while DIMM or UDIMM usually indicates desktop memory. RDIMM, LRDIMM, ECC, and REG point toward server memory."],
      ["Check rank and organization", "Markings such as 1Rx8, 2Rx8, or 4Rx4 describe the module's rank and chip organization. Servers can have strict rules for rank, population order, and mixing. Match the existing module or follow the platform QVL."],
      ["Verify before ordering", "Use the motherboard or server service manual as the final authority. Product photos and labels help identify a module, but the system's supported capacity, voltage, rank, and memory type determine whether it will work."],
    ],
  },
  {
    slug: "how-much-ram-do-i-need",
    title: "How Much RAM Do I Need? A Practical Capacity Guide",
    description: "Choose the right RAM capacity for office work, gaming, content creation, virtual machines, and server workloads.",
    keywords: "how much RAM do I need, 16GB vs 32GB RAM, server memory capacity",
    cta: { label: "Browse RAM by use case", to: "/categories" },
    sections: [
      ["Everyday laptops and desktops", "16GB is a practical baseline for office work, web browsing, school, and general multitasking. Choose 32GB if you regularly use large spreadsheets, development tools, many browser tabs, or photo and video applications."],
      ["Gaming and creative work", "Capacity needs depend on the game and the rest of the system, but 32GB gives modern gaming PCs useful headroom. Video editing, 3D work, and large creative projects may benefit from 64GB or more, especially when several applications are open."],
      ["Servers and virtual machines", "Server capacity depends on the number of virtual machines, databases, caches, and services. ECC RDIMM or LRDIMM capacity is more important than consumer speed ratings. Follow the server's supported population rules and install matched modules where possible."],
      ["Capacity versus speed", "If a system is paging to disk, adding capacity usually produces a larger improvement than a small speed increase. Confirm compatibility first, then choose the fastest supported memory that fits the budget."],
    ],
  },
];

function GuideSchema({ guide }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    keywords: guide.keywords,
    author: { "@type": "Organization", name: "Reflexity RAM" },
    publisher: { "@type": "Organization", name: "Reflexity RAM" },
    mainEntityOfPage: `https://reflexityram.com/guides/${guide.slug}`,
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

export default function Guides() {
  const { slug } = useParams();
  const guide = GUIDES.find((item) => item.slug === slug);
  const title = guide ? guide.title : "RAM Buying Guides";
  const description = guide?.description || "Practical guides to DDR4, DDR5, ECC, RDIMM, LRDIMM, laptop, desktop, and server RAM.";

  useSEO({ title, description });

  if (guide) {
    return (
      <>
        <Header />
        <main className="page" data-testid="guide-page">
          <article className="container-tight pt-14 pb-16 max-w-4xl">
            <Link to="/guides" className="inline-flex items-center gap-2 text-[13px] text-neutral-400 hover:text-white mb-8">
              <ArrowRight size={14} className="rotate-180" /> All guides
            </Link>
            <div className="section-label mb-5"><span className="num">GUIDE</span> RAM BUYING GUIDE</div>
            <h1 className="display-2 max-w-[22ch]">{guide.title}</h1>
            <p className="mt-5 text-[17px] max-w-[62ch]" style={{ color: "var(--fg-muted)" }}>{guide.description}</p>
            <div className="mt-10 grid gap-5">
              {guide.sections.map(([heading, body]) => (
                <section key={heading} className="border-t pt-5" style={{ borderColor: "var(--border)" }}>
                  <h2 className="text-xl font-semibold">{heading}</h2>
                  <p className="mt-2 text-[15px] leading-7" style={{ color: "var(--fg-muted)" }}>{body}</p>
                </section>
              ))}
            </div>
            <div className="mt-12 border-t pt-8" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap gap-3">
                <Link to={guide.cta.to} className="btn-primary"><CheckCircle2 size={15} /> {guide.cta.label}</Link>
                <Link to="/support" className="btn-secondary">Ask us to confirm compatibility</Link>
              </div>
            </div>
          </article>
          <GuideSchema guide={guide} />
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="page" data-testid="guides-page">
        <div className="container-tight pt-14 pb-16">
          <div className="section-label mb-5"><BookOpen size={14} /> RAM BUYING GUIDES</div>
          <h1 className="display-2 max-w-[18ch]">Choose the right memory with confidence.</h1>
          <p className="mt-5 text-[17px] max-w-[60ch]" style={{ color: "var(--fg-muted)" }}>
            Straightforward answers about DDR4, DDR5, ECC, server memory, laptop upgrades, and capacity.
          </p>
          <div className="mt-12 grid md:grid-cols-2 gap-5">
            {GUIDES.map((item) => (
              <Link key={item.slug} to={`/guides/${item.slug}`} className="glass card-hover rounded-xl p-6 group">
                <div className="mono text-[10px] uppercase" style={{ color: "var(--fg-faint)" }}>{item.keywords}</div>
                <h2 className="mt-3 text-xl font-semibold group-hover:text-white">{item.title}</h2>
                <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>{item.description}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-[13px] font-medium">Read guide <ArrowRight size={14} /></span>
              </Link>
            ))}
          </div>
          <div className="mt-12 border-t pt-8" style={{ borderColor: "var(--border)" }}>
            <p className="text-[14px]" style={{ color: "var(--fg-muted)" }}>
              Know the part number already? <Link to="/shop" className="underline">Search the RAM catalog</Link> or <Link to="/support" className="underline">ask us to confirm compatibility</Link>.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

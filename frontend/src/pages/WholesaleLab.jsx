import { WholesaleMarket } from "@/pages/Wholesale";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { publishedWholesaleDemoLots } from "@/lib/wholesaleDemoStore";
import { useWholesaleDemoLots } from "@/lib/useWholesaleDemoLots";
import { useSEO } from "@/lib/seo";

export default function WholesaleLab() {
  const { error, lots } = useWholesaleDemoLots();
  useSEO({ title: "Local wholesale inventory preview" });
  return (
    <><Header /><main className="page" data-testid="wholesale-lab-page"><section className="container-tight catalog-status"><p className="mono">LOCAL DEMO</p><h1>Local wholesale inventory preview</h1><p>LOCAL DEMO data is local to this browser and never changes production inventory.</p></section><WholesaleMarket detailBasePath="/wholesale-lab" postedLots={error ? [] : publishedWholesaleDemoLots(lots)} stockError={error} /></main><Footer /></>
  );
}

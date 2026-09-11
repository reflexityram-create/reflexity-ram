import { WholesaleMarket } from "@/pages/Wholesale";
import { publishedWholesaleDemoLots } from "@/lib/wholesaleDemoStore";
import { useWholesaleDemoLots } from "@/lib/useWholesaleDemoLots";

export default function WholesaleLab() {
  const { error, lots } = useWholesaleDemoLots();
  return (
    <WholesaleMarket
      badgeLabel="LOCAL DEMO"
      detailBasePath="/wholesale-lab"
      errorEyebrow="LOCAL DEMO DATA UNAVAILABLE"
      errorTitle="The stock preview is safely empty."
      inventoryEyebrow="LOCAL CUSTOMER PREVIEW"
      inventoryNote="Example lots published from the Stock Studio. Regular shop products never enter this preview."
      postedLots={error ? [] : publishedWholesaleDemoLots(lots)}
      seoTitle="Wholesale RAM market | Reflexity local preview"
      stockError={error}
    />
  );
}

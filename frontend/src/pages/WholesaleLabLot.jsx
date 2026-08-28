import { useParams } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { publishedWholesaleDemoLots } from "@/lib/wholesaleDemoStore";
import { useWholesaleDemoLots } from "@/lib/useWholesaleDemoLots";
import { LotUnavailable, WholesaleLotDetail } from "@/pages/WholesaleLot";

export default function WholesaleLabLot() {
  const { lotId } = useParams();
  const { error, lots } = useWholesaleDemoLots();
  const lot = error ? null : publishedWholesaleDemoLots(lots).find((item) => item.id === lotId);

  return (
    <>
      <Header />
      <main className="page pb-16" data-testid="wholesale-lab-detail-page">
        <div className="container-tight pt-8">
          {lot ? <WholesaleLotDetail backTo="/wholesale-lab" lot={lot} /> : <LotUnavailable loading={false} />}
        </div>
      </main>
      <Footer />
    </>
  );
}

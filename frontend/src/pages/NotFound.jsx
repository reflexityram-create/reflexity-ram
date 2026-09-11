import { Link } from "react-router-dom";
import { Home, ArrowLeft, Search } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useSEO } from "@/lib/seo";

export default function NotFound() {
  useSEO({ title: "Page not found", noindex: true });
  return (
    <>
      <Header />
      <main className="page pb-16 flex items-center" data-testid="not-found-page">
        <div className="container-tight pt-10 w-full">
          <div className="glass rounded-2xl p-10 md:p-16 text-center max-w-2xl mx-auto">
            <div className="mono text-[11px] text-neutral-500 tracking-widest mb-3">ERROR 404</div>
            <h1 className="display-1 display-grad mb-5">Not in stock.</h1>
            <p className="text-[15px] text-neutral-400 leading-relaxed mb-8">
              That page isn't in our catalog. Could be a moved SKU, a dead link, or a typo. Head back home or browse the shop.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link to="/" className="btn-primary" data-testid="notfound-home-btn">
                <Home size={15} /> Back to home
              </Link>
              <Link to="/shop" className="btn-secondary" data-testid="notfound-shop-btn">
                <Search size={15} /> Browse shop
              </Link>
              <button onClick={() => window.history.back()} className="btn-ghost" data-testid="notfound-back-btn">
                <ArrowLeft size={14} /> Go back
              </button>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

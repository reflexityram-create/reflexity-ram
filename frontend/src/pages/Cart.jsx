import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Plus, Minus, ShoppingCart, Loader2, ArrowRight } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import EmptyState from '@/components/EmptyState';
import useCartStore from '@/lib/cartStore';
import { imageUrl } from '@/lib/imageUrl';
import { formatStorePrice, STORE_CURRENCY_CODE, STORE_CURRENCY_NAME } from '@/lib/currency';
import { useSEO } from '@/lib/seo';
import { ecommerceItem, trackEvent } from '@/lib/analytics';

export default function Cart() {
  useSEO({ title: 'Cart', description: 'Review your Reflexity RAM order before checkout.' });
  const { items, subtotal, itemCount, isLoading, fetchCart, updateItem, removeItem } = useCartStore();

  useEffect(() => {
    fetchCart();
  }, []);

  return (
    <>
      <Header />
      <main className="container-tight pt-28 pb-20 min-h-screen" data-testid="cart-page">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Cart</h1>
          {itemCount > 0 && (
            <p className="text-neutral-400 text-[14px] mt-1">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
          )}
        </div>

        {isLoading && items.length === 0 ? (
          <div className="flex items-center gap-2 text-neutral-400 py-12">
            <Loader2 size={16} className="animate-spin" />
            Loading cart…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="Your cart is empty"
            description="Browse our memory modules and add some to your cart."
            ctaLabel="Browse memory"
            ctaTo="/shop"
            testId="cart-empty"
          />
        ) : (
          <div className="grid lg:grid-cols-[1fr_360px] gap-8">
            {/* Items */}
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <div key={item.slug} className="glass rounded-xl p-5 flex gap-4" data-testid={`cart-item-${item.slug}`}>
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-white/5 shrink-0">
                    {item.image && <img src={imageUrl(item.image, { width: 160 })} alt={item.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link to={`/shop/${item.slug}`} className="text-[14px] font-semibold hover:text-white/80 line-clamp-2">
                      {item.name}
                    </Link>
                    <div className="mono text-[11px] text-neutral-500 mt-0.5">{item.sku}</div>
                    <div className="text-[15px] font-bold mt-2">{formatStorePrice(item.price)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-3">
                    <button
                      onClick={() => removeItem(item.slug)}
                      className="p-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      data-testid={`cart-remove-${item.slug}`}
                    >
                      <Trash2 size={14} />
                    </button>
                    <div className="flex items-center glass rounded-full overflow-hidden">
                      <button
                        onClick={() => updateItem(item.slug, item.qty - 1)}
                        className="px-3 py-1.5 hover:bg-white/5 transition-colors"
                        disabled={item.qty <= 1}
                      >
                        <Minus size={11} />
                      </button>
                      <span className="px-2 mono text-[12px] min-w-[2ch] text-center">{item.qty}</span>
                      <button
                        onClick={() => updateItem(item.slug, item.qty + 1)}
                        className="px-3 py-1.5 hover:bg-white/5 transition-colors"
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                    <div className="mono text-[13px] text-neutral-300">
                      {formatStorePrice(item.price * item.qty)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <aside className="glass rounded-2xl p-6 lg:sticky lg:top-24 h-fit" data-testid="cart-summary">
              <h3 className="font-semibold tracking-tight mb-5">Order summary</h3>
              <p className="text-[11px] text-neutral-500 -mt-3 mb-4">All prices are in {STORE_CURRENCY_NAME}.</p>
              <div className="space-y-3 text-[13px] mb-5">
                <div className="flex justify-between text-neutral-300">
                  <span>Subtotal ({itemCount} item{itemCount !== 1 ? 's' : ''})</span>
                  <span className="mono">{formatStorePrice(subtotal)}</span>
                </div>
                <div className="flex justify-between text-neutral-400">
                  <span>Shipping</span>
                  <span className="mono text-[11px]">Calculated at checkout</span>
                </div>
                <div className="flex justify-between text-neutral-400">
                  <span>Tax</span>
                  <span className="mono text-[11px]">Calculated at checkout</span>
                </div>
              </div>
              <div className="border-t border-white/5 pt-4 mb-5">
                <div className="flex justify-between items-baseline">
                  <span className="text-[13px] text-neutral-400">Estimated total</span>
                  <span className="text-2xl font-bold">{formatStorePrice(subtotal)}</span>
                </div>
              </div>
              <Link
                to="/checkout"
                onClick={() => trackEvent('begin_checkout', {
                  currency: STORE_CURRENCY_CODE,
                  value: Number(subtotal || 0),
                  items: items.map((item) => ecommerceItem(item, item.qty)),
                })}
                className="btn-primary w-full flex items-center justify-center gap-2"
                data-testid="cart-checkout-btn"
              >
                Proceed to checkout <ArrowRight size={15} />
              </Link>
              <Link
                to="/shop"
                className="btn-ghost w-full text-center mt-3 text-[13px]"
              >
                Continue shopping
              </Link>
            </aside>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

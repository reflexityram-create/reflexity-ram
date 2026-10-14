import { RefreshCw } from 'lucide-react';

// The cart could not be read (a timeout while the server wakes up, no connection). These pages used to say "Your cart is
// empty" then, and a buyer took that to mean the cart was gone.
export default function CartLoadError({ onRetry }) {
  return (
    <div className="glass rounded-2xl p-8 max-w-lg" role="alert" data-testid="cart-load-error">
      <p className="font-semibold">We could not load your cart</p>
      <p className="text-[14px] text-neutral-400 mt-1">This is usually a slow connection or our server waking up. Nothing in your cart has changed.</p>
      <button type="button" onClick={onRetry} className="btn-primary mt-4 inline-flex items-center gap-2" data-testid="cart-load-retry">
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}

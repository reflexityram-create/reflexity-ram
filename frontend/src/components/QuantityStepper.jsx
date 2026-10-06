import { useEffect, useId, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { clampQuantity } from "@/lib/quantity";

const SIZES = {
  md: { button: "px-4 py-2.5", icon: 14, input: "w-12 text-sm" },
  sm: { button: "px-3 py-2", icon: 12, input: "w-9 text-[13px]" },
};

/**
 * Quantity picker: a minus button, a number the buyer can type, and a plus button. It never goes
 * past `limit` (the stock on hand). Reaching the limit says why ("Only 2 available"); pressing plus
 * again, or typing a bigger number, turns that message and the border red.
 *
 * notePlacement "after" returns the pill and its message as two siblings, so put it inside a
 * flex-wrap row (give the message `order-last basis-full` to put it on its own line under the row).
 * "above" floats the message over the pill, for the sticky phone bar.
 */
export default function QuantityStepper({
  value,
  onChange,
  limit,
  note,
  size = "md",
  notePlacement = "after",
  noteClassName = "",
  testId = "qty",
  className = "",
}) {
  const s = SIZES[size] || SIZES.md;
  const noteId = useId();
  const [draft, setDraft] = useState(null); // the digits being typed; null when not editing
  const [warn, setWarn] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const soldOut = !(limit >= 1);
  const atLimit = !soldOut && value >= limit;
  const showNote = !soldOut && (atLimit || warn);

  const flash = () => {
    setWarn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setWarn(false), 2600);
  };
  const apply = (requested) => {
    const { qty, capped } = clampQuantity(requested, limit);
    if (capped) flash();
    else if (qty !== value) setWarn(false);
    if (qty !== value) onChange(qty);
    return qty;
  };

  const onType = (event) => {
    const digits = event.target.value.replace(/\D/g, "").slice(0, 3);
    if (digits === "" || Number(digits) < 1) {
      setDraft(digits); // keep typing; a blur puts the current quantity back
      return;
    }
    setDraft(String(apply(Number(digits))));
  };
  const onKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setDraft(null);
      apply(value + (event.key === "ArrowUp" ? 1 : -1));
    }
  };

  const floating = notePlacement === "above";
  const tone = warn
    ? floating
      ? "bg-[#dc2626] text-[#ffffff]" // not text-white: light mode remaps that class to dark ink
      : "text-red-600 dark:text-red-400"
    : floating
      ? "bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200"
      : "text-amber-700 dark:text-amber-300";
  // Always in the page so a screen reader announces the text when it appears.
  const message = (
    <p
      id={noteId}
      role="status"
      data-testid={`${testId}-note`}
      data-state={showNote ? (warn ? "warn" : "limit") : "hidden"}
      className={
        showNote
          ? `text-[12.5px] font-semibold leading-snug ${tone} ${
              floating ? "absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-full px-3 py-1 shadow-lg" : noteClassName
            }`
          : "sr-only"
      }
    >
      {showNote ? note : ""}
    </p>
  );

  const pill = (
    <div
      className={`flex items-stretch glass rounded-full overflow-hidden ${soldOut ? "opacity-50 pointer-events-none" : ""} ${className}`}
      style={warn ? { borderColor: "#dc2626" } : undefined}
      data-testid={`${testId}-stepper`}
      data-warn={warn ? "true" : undefined}
    >
      <button
        type="button"
        onClick={() => {
          setDraft(null);
          apply(value - 1);
        }}
        disabled={soldOut || value <= 1}
        className={`${s.button} hover:bg-white/5 disabled:opacity-40`}
        aria-label="Decrease quantity"
        data-testid={`${testId}-decrease`}
      >
        <Minus size={s.icon} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={3}
        value={draft ?? String(soldOut ? 0 : value)}
        onChange={onType}
        onFocus={(event) => event.target.select()}
        onBlur={() => setDraft(null)}
        onKeyDown={onKeyDown}
        disabled={soldOut}
        aria-label="Quantity"
        className={`${s.input} mono bg-transparent text-center tabular-nums outline-none focus-visible:bg-black/5 dark:focus-visible:bg-white/5`}
        data-testid={`${testId}-value`}
      />
      <button
        type="button"
        onClick={() => {
          setDraft(null);
          apply(value + 1);
        }}
        disabled={soldOut}
        aria-describedby={noteId}
        className={`${s.button} hover:bg-white/5 ${atLimit ? "opacity-40" : ""}`}
        aria-label="Increase quantity"
        data-testid={`${testId}-increase`}
      >
        <Plus size={s.icon} />
      </button>
    </div>
  );

  if (floating) {
    return (
      <div className="relative">
        {pill}
        {message}
      </div>
    );
  }
  return (
    <>
      {pill}
      {message}
    </>
  );
}

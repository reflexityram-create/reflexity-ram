import { useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { addressApi } from '@/lib/api';
import { DEBOUNCE_MS, QUIET_AFTER_PROBLEM_MS, nextActive, resultsAnnouncement, worthSearching } from '@/lib/addressSuggest';

// The street-address field of the e-Transfer form, with a list of suggested Canadian addresses under it as the buyer types
// (Canada Post's address data, asked through our own server). Picking one fills the street, city, province and postal code and
// shows that the address was checked. It is only ever a help: if the service is off, slow or broken the field is a plain input and
// the buyer types the address, and nothing here can stop the order. Keyboard: Down/Up to move, Enter to pick, Escape to close.
// A suggestion that is a building or a street (it says "12 addresses") is opened with the same keys to choose the unit inside it.

export default function AddressSuggest({ id, label, value, onChange, onPick, enabled = false, error, verified = false, inputProps = {} }) {
  const listId = useId();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef(null);
  const latest = useRef(0);                 // only the newest search may show its answer
  const controller = useRef(null);
  const quietUntil = useRef(0);
  const typed = useRef('');                  // what the buyer typed (a building's units are searched with it)

  useEffect(() => () => { window.clearTimeout(timer.current); controller.current?.abort(); }, []);

  const close = () => { window.clearTimeout(timer.current); setOpen(false); setActive(-1); };

  const search = async (text, lastId) => {
    const request = ++latest.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy(true);
    try {
      const { data } = await addressApi.suggest(text, lastId, controller.current.signal);
      if (request !== latest.current) return;
      if (data?.unavailable) { quietUntil.current = Date.now() + QUIET_AFTER_PROBLEM_MS; setItems([]); close(); return; }
      const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
      setItems(list);
      setActive(-1);
      setOpen(true);
    } catch (err) {
      if (request !== latest.current || err?.code === 'ERR_CANCELED') return;
      quietUntil.current = Date.now() + QUIET_AFTER_PROBLEM_MS;
      setItems([]);
      close();
    } finally {
      if (request === latest.current) setBusy(false);
    }
  };

  const typedInto = (event) => {
    const text = event.target.value;
    typed.current = text;
    setNote('');
    onChange(text);
    window.clearTimeout(timer.current);
    if (!enabled || Date.now() < quietUntil.current || !worthSearching(text)) { latest.current += 1; controller.current?.abort(); setBusy(false); close(); return; }
    timer.current = window.setTimeout(() => search(text, ''), DEBOUNCE_MS);
  };

  const pick = async (suggestion) => {
    if (!suggestion) return;
    if (suggestion.next !== 'retrieve') {
      // a building or a street: show what is inside it, and keep the list open
      onChange(suggestion.text);
      search(typed.current || suggestion.text, suggestion.id);
      return;
    }
    const request = ++latest.current;
    controller.current?.abort();
    controller.current = new AbortController();
    close();
    setBusy(true);
    try {
      const { data } = await addressApi.retrieve(suggestion.id, controller.current.signal);
      if (request !== latest.current) return;
      if (data?.address) { onPick(data.address); setNote(''); }
      else setNote('We could not check that address just now. Please fill it in below.');
    } catch (err) {
      if (request !== latest.current || err?.code === 'ERR_CANCELED') return;
      setNote('We could not check that address just now. Please fill it in below.');
    } finally {
      if (request === latest.current) setBusy(false);
    }
  };

  const onKeyDown = (event) => {
    if (!open || items.length === 0) { if (event.key === 'Escape') close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => nextActive(current, event.key, items.length)); }
    else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(items[active]); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Tab') close();
  };

  const showList = enabled && open && items.length > 0;
  const optionId = (index) => `${listId}-option-${index}`;

  return (
    <div className="block">
      <label htmlFor={id} className="block text-[13px] text-neutral-400 mb-1">{label}</label>
      <div className="relative">
        <input
          id={id}
          className="input"
          value={value}
          onChange={typedInto}
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(close, 150)}
          aria-invalid={Boolean(error)}
          {...(enabled ? {
            role: 'combobox',
            'aria-expanded': showList,
            'aria-controls': listId,
            'aria-autocomplete': 'list',
            'aria-activedescendant': showList && active >= 0 ? optionId(active) : undefined,
          } : {})}
          {...inputProps}
        />
        {enabled && busy && <Loader2 size={14} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500" aria-hidden="true" />}
        {showList && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Suggested addresses"
            data-testid="address-suggestions"
            className="absolute z-30 left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-lg max-h-72 overflow-y-auto"
            style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)' }}
          >
            {items.map((suggestion, index) => (
              <li
                key={suggestion.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                data-testid="address-suggestion"
                className="px-3 py-2.5 cursor-pointer text-[14px] border-t first:border-t-0"
                style={{ borderColor: 'var(--border-strong)', background: index === active ? 'var(--glass-bg-hover)' : undefined }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(suggestion)}
                onMouseEnter={() => setActive(index)}
              >
                <span className="block font-medium">{suggestion.text}</span>
                {suggestion.description && <span className="block text-[12px] text-neutral-500">{suggestion.description}</span>}
                {suggestion.next !== 'retrieve' && <span className="block text-[11px] text-neutral-500">Choose to see the units</span>}
              </li>
            ))}
            <li role="presentation" className="px-3 py-1.5 text-[11px] text-neutral-500 border-t" style={{ borderColor: 'var(--border-strong)' }}>Suggestions from Canada Post. You can always type the address yourself.</li>
          </ul>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">{showList ? resultsAnnouncement(items.length) : ''}</span>
      {error && <span className="block text-[12px] text-amber-500 mt-1" role="alert">{error}</span>}
      {verified && !error && (
        <span className="mt-1 flex items-center gap-1.5 text-[12px] text-emerald-500" data-testid="address-verified">
          <Check size={13} aria-hidden="true" /> Address checked against Canada Post’s address data
        </span>
      )}
      {note && <span className="block text-[12px] text-neutral-500 mt-1" role="status" data-testid="address-note">{note}</span>}
    </div>
  );
}

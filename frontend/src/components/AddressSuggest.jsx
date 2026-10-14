import { useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { addressApi } from '@/lib/api';
import { DEBOUNCE_MS, OSM_COPYRIGHT_URL, QUIET_AFTER_PROBLEM_MS, dropsOnDismiss, nextActive, pickFailedNote, resultsAnnouncement, sourceNote, worthSearching } from '@/lib/addressSuggest';

// The street-address field of the e-Transfer form, with a list of suggested Canadian addresses under it as the buyer types, asked
// through our own server: Canada Post's address data (`source` 'canadapost': picking one fills the street, city, province and postal
// code and shows that the address was checked) or OpenStreetMap's (`source` 'photon', free: it fills the street, city and province only,
// says where they came from, and never claims a check). It is only ever a help: if the service is off, slow or broken the field is a plain input and
// the buyer types the address, and nothing here can stop the order. Keyboard: Down/Up to move, Enter to pick, Escape to close.
// A suggestion that is a building or a street (it says "12 addresses") is opened with the same keys to choose the unit inside it.

export default function AddressSuggest({ id, label, value, onChange, onPick, enabled = false, source = 'canadapost', error, verified = false, inputProps = {} }) {
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
  const inflight = useRef(null);             // 'find' while a search is on its way, 'pick' while a finished address is being fetched

  useEffect(() => () => { window.clearTimeout(timer.current); controller.current?.abort(); }, []);

  const close = () => { window.clearTimeout(timer.current); setOpen(false); setActive(-1); };
  // Leaving the field (Tab, Escape, a tap elsewhere) also drops a SEARCH that is still on its way: a slow answer must not reopen the
  // list over the next field. A PICK already on its way is not dropped (the buyer tapping the next field must not lose the address
  // they just chose), and a pick closes the list with plain close() because it starts its own request.
  const dismiss = () => {
    if (dropsOnDismiss(inflight.current)) { latest.current += 1; controller.current?.abort(); inflight.current = null; setBusy(false); }
    close();
  };

  const search = async (text, lastId) => {
    const request = ++latest.current;
    controller.current?.abort();
    controller.current = new AbortController();
    inflight.current = 'find';
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
      if (request === latest.current) { setBusy(false); inflight.current = null; }
    }
  };

  const typedInto = (event) => {
    const text = event.target.value;
    typed.current = text;
    // Typing replaces a pick that is still on its way: the buyer's own text wins over an answer that comes back after it.
    if (inflight.current === 'pick') { latest.current += 1; controller.current?.abort(); inflight.current = null; setBusy(false); }
    setNote('');
    onChange(text);
    window.clearTimeout(timer.current);
    if (!enabled || Date.now() < quietUntil.current || !worthSearching(text, source)) { latest.current += 1; controller.current?.abort(); setBusy(false); close(); return; }
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
    const startedAt = performance.now();
    controller.current?.abort();
    controller.current = new AbortController();
    close();
    inflight.current = 'pick';
    setBusy(true);
    try {
      const { data } = await addressApi.retrieve(suggestion.id, controller.current.signal);
      if (request !== latest.current) return;
      if (data?.address) { onPick(data.address, { startedAt }); setNote(''); }
      else setNote(pickFailedNote(source));
    } catch (err) {
      if (request !== latest.current || err?.code === 'ERR_CANCELED') return;
      setNote(pickFailedNote(source));
    } finally {
      if (request === latest.current) { setBusy(false); inflight.current = null; }
    }
  };

  const onKeyDown = (event) => {
    if (!open || items.length === 0) { if (event.key === 'Escape' || event.key === 'Tab') dismiss(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => nextActive(current, event.key, items.length)); }
    else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(items[active]); }
    else if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    else if (event.key === 'Tab') dismiss();
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
          onBlur={() => window.setTimeout(dismiss, 150)}
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
          <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-lg" style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)' }}>
            <ul
              id={listId}
              role="listbox"
              aria-label="Suggested addresses"
              data-testid="address-suggestions"
              className="max-h-72 overflow-y-auto"
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
            </ul>
            {/* The credit stays under the results, outside the list's own scroll, so it is in view whenever they are (OpenStreetMap's licence
                asks for credit without a click). A press here must not blur the field: the list would close before the link is followed. */}
            <div className="px-3 py-1.5 text-[11px] text-neutral-500 border-t" style={{ borderColor: 'var(--border-strong)' }} onMouseDown={(event) => event.preventDefault()} data-testid="address-credit">
              {source === 'photon'
                ? <>Suggestions © <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer" className="underline" data-testid="address-osm-credit">OpenStreetMap contributors</a>. You can always type the address yourself.</>
                : sourceNote(source)}
            </div>
          </div>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">{showList ? resultsAnnouncement(items.length) : ''}</span>
      {error && <span className="block text-[12px] text-amber-500 mt-1" role="alert">{error}</span>}
      {verified && !error && source === 'photon' && (
        <span className="mt-1 block text-[12px] text-neutral-400" data-testid="address-suggested">
          Street, city and province filled in from <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap</a>. Please check them and type your postal code.
        </span>
      )}
      {verified && !error && source !== 'photon' && (
        <span className="mt-1 flex items-center gap-1.5 text-[12px] text-emerald-500" data-testid="address-verified">
          <Check size={13} aria-hidden="true" /> Address checked against Canada Post’s address data
        </span>
      )}
      {note && <span className="block text-[12px] text-neutral-500 mt-1" role="status" data-testid="address-note">{note}</span>}
    </div>
  );
}

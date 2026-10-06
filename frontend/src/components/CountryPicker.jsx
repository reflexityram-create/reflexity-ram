import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

// Searchable country list for checkout abroad. Type to filter (accents and
// common names like "UK" or "Holland" work), arrows + Enter to pick. Drawn
// with the site's color tokens so it reads in light and dark mode.

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const flag = (code) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
const ALIASES = {
  uk: 'GB', england: 'GB', scotland: 'GB', wales: 'GB', britain: 'GB', 'great britain': 'GB',
  holland: 'NL', korea: 'KR', 'south korea': 'KR', uae: 'AE', emirates: 'AE', czechia: 'CZ',
  'hong kong': 'HK', usa: 'US', america: 'US', 'united states': 'US', us: 'US',
};

export default function CountryPicker({ countries, value, onChange, unavailableNote, loading = false }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const listId = useId();
  const selected = countries.find((c) => c.code === value);

  const matches = useMemo(() => {
    const q = fold(query);
    if (!q) return countries;
    const alias = ALIASES[q];
    const starts = countries.filter((c) => fold(c.name).startsWith(q) || c.code.toLowerCase() === q || c.code === alias);
    const contains = countries.filter((c) => !starts.includes(c) && fold(c.name).includes(q));
    return [...starts, ...contains];
  }, [countries, query]);
  // The note for a buyer typing "United States" only shows while the US is NOT on the list (it is listed once the shop can quote US duties).
  const wantsUnavailable = !countries.some((c) => c.code === 'US')
    && (['US'].includes(ALIASES[fold(query)]) || /^united states/.test(fold(query)));

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (country) => {
    onChange(country.code);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); choose(matches[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px] leading-none" aria-hidden="true">
          {selected && !open ? flag(selected.code) : <Search size={15} style={{ color: 'var(--fg-muted)' }} />}
        </span>
        <input
          className="input pl-10 pr-9"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Country"
          aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].code}` : undefined}
          placeholder={selected ? selected.name : 'Type your country'}
          value={open ? query : (selected?.name || query)}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          data-testid="checkout-country"
          autoComplete="country-name"
        />
        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--fg-muted)' }} />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1.5 w-full max-h-64 overflow-auto rounded-xl border py-1 shadow-xl"
          style={{ background: 'var(--bg-elev)', borderColor: 'var(--border-strong)' }}
          data-testid="checkout-country-list"
        >
          {wantsUnavailable && unavailableNote && (
            <li className="px-3 py-2 text-[13px]" style={{ color: 'var(--fg-muted)' }}>{unavailableNote}</li>
          )}
          {loading && (
            <li className="px-3 py-2 text-[13px]" style={{ color: 'var(--fg-muted)' }}>Loading countries…</li>
          )}
          {matches.length === 0 && !wantsUnavailable && !loading && (
            <li className="px-3 py-2 text-[13px]" style={{ color: 'var(--fg-muted)' }}>Not on the list? Canada Post has no tracked service there right now. Email us and we will check.</li>
          )}
          {matches.map((c, i) => (
            <li
              key={c.code}
              id={`${listId}-${c.code}`}
              role="option"
              aria-selected={c.code === value}
              onMouseDown={(e) => { e.preventDefault(); choose(c); }}
              onMouseEnter={() => setActive(i)}
              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[14px]"
              style={{
                color: 'var(--fg)',
                background: i === active ? 'var(--input-bg-focus)' : 'transparent',
                fontWeight: c.code === value ? 600 : 400,
              }}
            >
              <span className="text-[17px] leading-none" aria-hidden="true">{flag(c.code)}</span>
              <span>{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

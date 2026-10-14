import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Copy, Bot } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { adminApi } from '@/lib/api';
import { PERIODS, agoText, groupVisitors } from '@/lib/visitors';

const LISTS = [
  ['paths', 'Pages'],
  ['countries', 'Countries'],
  ['cities', 'Cities'],
  ['networks', 'Networks'],
  ['referrers', 'Came from'],
  ['sources', 'Campaigns'],
];

// Who is looking at our sites, from our own visit log (docs/visit-log.md): IP address, place, network, device, pages.
// React escapes everything shown here; nothing a visitor's browser sent is ever treated as HTML.
export default function AdminVisitors() {
  const [hours, setHours] = useState(24);
  const [site, setSite] = useState('');
  const [bots, setBots] = useState(false);
  const [summary, setSummary] = useState(null);
  const [visits, setVisits] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setProblem('');
    const params = { hours, ...(site ? { site } : {}), ...(bots ? { bots: '1' } : {}) };
    Promise.all([adminApi.visitsSummary(params), adminApi.listVisits({ ...params, limit: 400 })])
      .then(([sum, list]) => {
        setSummary(sum.data);
        setVisits(list.data.visits || []);
        setSites((known) => [...new Set([...known, ...(sum.data.perSite || []).map((row) => row.name)])]);
      })
      .catch((err) => setProblem(err?.response?.status === 503 ? 'The visit log is not connected to this server yet.' : 'Could not load the visit log.'))
      .finally(() => setLoading(false));
  }, [hours, site, bots]);

  useEffect(() => { load(); }, [load]);

  const visitors = useMemo(() => groupVisitors(visits), [visits]);
  const totals = summary?.totals || {};

  const copy = (ip) => {
    navigator.clipboard?.writeText(ip).then(() => toast.success('IP address copied'), () => toast.error('Could not copy'));
  };

  return (
    <AppLayout requireAdmin>
      <div className="p-4 md:p-8 max-w-4xl">
        <div className="mb-4 md:mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Visitors</h1>
            <p className="text-neutral-500 text-[13px] mt-0.5">From our own visit log, kept 180 days. Visitors who opt out or send Do Not Track are not in it.</p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="admin-card shrink-0 !w-11 !h-11 !p-0 flex items-center justify-center" aria-label="Refresh" data-testid="visitors-refresh">
            {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
          </button>
        </div>

        <div data-testid="visitors-filters">
          <div className="chip-row -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0" role="group" aria-label="Period">
            {PERIODS.map((period) => (
              <button key={period.hours} type="button" className="chip" aria-pressed={hours === period.hours} onClick={() => setHours(period.hours)}>
                {period.label}
              </button>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site" className="admin-card !w-auto !px-3 !py-2 text-[13px]" data-testid="visitors-site">
              <option value="">All sites</option>
              {sites.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[13px] text-neutral-500">
              <input type="checkbox" checked={bots} onChange={(e) => setBots(e.target.checked)} /> include bots
            </label>
          </div>
        </div>

        {problem ? (
          <div className="admin-card text-[14px]" role="alert" data-testid="visitors-problem">{problem}</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-5" data-testid="visitors-totals">
              <div className="admin-card"><div className="text-2xl font-bold">{totals.views ?? '–'}</div><div className="text-[12px] text-neutral-500">page views</div></div>
              <div className="admin-card"><div className="text-2xl font-bold">{totals.ips ?? '–'}</div><div className="text-[12px] text-neutral-500">different IP addresses</div></div>
              <div className="admin-card"><div className="text-2xl font-bold">{totals.sessions ?? '–'}</div><div className="text-[12px] text-neutral-500">visits</div></div>
            </div>

            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">People (by IP address)</h2>
            {!loading && visitors.length === 0 ? (
              <div className="admin-card text-[14px] text-neutral-500" data-testid="visitors-empty">No visits in this period yet.</div>
            ) : (
              <ul className="space-y-2.5 mb-6" data-testid="visitors-list">
                {visitors.map((person) => (
                  <li key={person.ip} className="admin-card" data-testid="visitor-card">
                    <div className="flex items-center gap-2">
                      <code className="text-[14px] font-semibold break-all">{person.ip}</code>
                      <button type="button" onClick={() => copy(person.ip)} className="p-1 text-neutral-500" aria-label={`Copy ${person.ip}`}><Copy size={14} aria-hidden="true" /></button>
                      {person.bot && <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500 border rounded-full px-2 py-0.5"><Bot size={11} aria-hidden="true" />bot</span>}
                      <span className="ml-auto text-[12px] text-neutral-500 whitespace-nowrap">{agoText(person.last)}</span>
                    </div>
                    <div className="text-[13px] mt-1">{person.place}{person.network ? <span className="text-neutral-500"> · {person.network}</span> : null}</div>
                    <div className="text-[12.5px] text-neutral-500">{person.device}{person.referrer ? ` · from ${person.referrer}` : ''}{person.campaign ? ` · campaign ${person.campaign}` : ''}</div>
                    <details className="mt-1.5">
                      <summary className="text-[12.5px] cursor-pointer">{person.views.length} page view{person.views.length === 1 ? '' : 's'}{person.sites.length > 1 ? ` on ${person.sites.length} sites` : ` on ${person.sites[0]}`}</summary>
                      <ul className="mt-1 space-y-0.5 text-[12.5px]">
                        {person.views.slice(0, 30).map((view) => (
                          <li key={view.id} className="flex gap-2"><span className="text-neutral-500 w-16 shrink-0">{new Date(view.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span className="break-all">{person.sites.length > 1 ? `${view.site}` : ''}{view.path}</span></li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid sm:grid-cols-2 gap-2.5">
              {LISTS.filter(([key]) => (summary?.[key] || []).length > 0).map(([key, title]) => (
                <details key={key} className="admin-card" data-testid={`visitors-top-${key}`}>
                  <summary className="text-[13px] font-semibold cursor-pointer">{title}</summary>
                  <ul className="mt-1.5 space-y-0.5 text-[12.5px]">
                    {summary[key].slice(0, 10).map((row) => (
                      <li key={row.name} className="flex justify-between gap-3"><span className="break-all">{row.name}</span><span className="text-neutral-500 whitespace-nowrap">{row.views} views · {row.ips} IP</span></li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Archive,
  Boxes,
  CheckCircle2,
  Eye,
  FilePenLine,
  Image as ImageIcon,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import ProductWorkspaceNav from '@/components/ProductWorkspaceNav';
import { adminApi } from '@/lib/api';
import './wholesale-admin.css';

const GENERATIONS = ['DDR3', 'DDR4', 'DDR5'];
const CONDITIONS = ['New', 'Open Box — Tested', 'Refurbished — Tested', 'Server Pull — Tested', 'Used'];

const EMPTY_LOT = Object.freeze({
  title: '',
  brand: '',
  mpn: '',
  generation: 'DDR4',
  formFactor: 'RDIMM',
  capacityLabel: '',
  speedLabel: '',
  rank: '',
  condition: 'Server Pull — Tested',
  testStatus: 'Tested and verified',
  warranty: '90 Days',
  quantityAvailable: 0,
  minimumOrderQuantity: 1,
  orderIncrement: 1,
  shipFrom: 'Toronto, Canada',
  image: null,
  notes: '',
});

const TEXT_FIELDS = [
  'title', 'brand', 'mpn', 'generation', 'formFactor', 'capacityLabel',
  'speedLabel', 'rank', 'condition', 'testStatus', 'warranty', 'shipFrom', 'notes',
];

const STATUS_STYLES = {
  draft: 'wa-status-draft',
  published: 'wa-status-published',
  archived: 'wa-status-archived',
};

function normalizeLot(lot = {}) {
  return {
    ...EMPTY_LOT,
    ...lot,
    image: lot.image?.url ? lot.image : null,
    quantityAvailable: Number(lot.quantityAvailable ?? 0),
    minimumOrderQuantity: Number(lot.minimumOrderQuantity ?? 1),
    orderIncrement: Number(lot.orderIncrement ?? 1),
  };
}

function lotPayload(form) {
  const payload = {};
  for (const field of TEXT_FIELDS) payload[field] = String(form[field] ?? '').trim();
  payload.quantityAvailable = Math.max(0, Math.floor(Number(form.quantityAvailable) || 0));
  payload.minimumOrderQuantity = Math.max(1, Math.floor(Number(form.minimumOrderQuantity) || 1));
  payload.orderIncrement = Math.max(1, Math.floor(Number(form.orderIncrement) || 1));
  payload.image = form.image?.url ? {
    url: form.image.url,
    publicId: form.image.publicId || '',
    alt: form.image.alt || form.title || '',
  } : null;
  return payload;
}

function apiMessage(error, fallback) {
  const details = error?.response?.data?.details;
  if (Array.isArray(details) && details.length) {
    const messages = details
      .map((item) => (typeof item === 'string' ? item : item?.message))
      .filter(Boolean);
    if (messages.length) return messages.join(' ');
  }
  return error?.response?.data?.error || fallback;
}

function StatusPill({ status }) {
  return (
    <span className={`wa-status inline-flex rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.11em] ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>
      {status}
    </span>
  );
}

function Field({ label, hint, wide = false, children }) {
  return (
    <label className={wide ? 'sm:col-span-2' : ''}>
      <span className="admin-label">{label}</span>
      {children}
      {hint && <span className="wa-faint mt-1.5 block text-[10px] leading-4">{hint}</span>}
    </label>
  );
}

function WholesaleImageField({ disabled, image, onBusyChange, onError, onRemove, onStatus, onUpload }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    onBusyChange(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const { data } = await adminApi.uploadWholesaleImage(formData);
      const uploaded = data.image || data.images?.[0];
      if (!uploaded?.url || !uploaded?.publicId) throw new Error('Upload response did not include a complete image');
      const accepted = await onUpload(uploaded);
      if (accepted !== false) onStatus('Wholesale image uploaded');
    } catch (error) {
      onError(apiMessage(error, 'Image upload failed'));
    } finally {
      setUploading(false);
      onBusyChange(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="wa-image-field flex min-h-28 items-center gap-3 rounded-xl border border-dashed p-3">
      <div className="wa-image-preview grid h-20 w-24 shrink-0 place-items-center overflow-hidden rounded-lg">
        {image?.url ? <img alt={image.alt || ''} className="h-full w-full object-contain" src={image.url} /> : <ImageIcon aria-hidden="true" size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="wa-muted text-[11px] leading-4">One clean product or lot photo. It stays detached until you save.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn-secondary flex items-center gap-1.5 py-2 text-[11px]" disabled={disabled || uploading} onClick={() => inputRef.current?.click()} type="button">
            {uploading ? <Loader2 className="animate-spin" size={13} /> : <Upload size={13} />}
            {image ? 'Replace image' : 'Upload image'}
          </button>
          {image && (
            <button className="btn-ghost py-2 text-[11px]" disabled={disabled || uploading} onClick={onRemove} type="button">Remove</button>
          )}
        </div>
      </div>
      <input
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(event) => upload(event.target.files?.[0])}
        ref={inputRef}
        type="file"
      />
    </div>
  );
}

function LotEditor({ initialLot, onClose, onPersisted, onSaved, onStale }) {
  const [form, setForm] = useState(() => normalizeLot(initialLot));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [editorStatus, setEditorStatus] = useState('');
  const dialogRef = useRef(null);
  const sessionUploadsRef = useRef(new Set());
  const attachedPublicIdRef = useRef(initialLot?.image?.publicId || null);
  const aliveRef = useRef(true);
  const busyRef = useRef(false);
  const requestCloseRef = useRef(null);
  const isEdit = Boolean(form.id);
  const busy = saving || uploading || closing;
  busyRef.current = busy;

  useEffect(() => {
    aliveRef.current = true;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    // The editor is portalled to body so the complete signed-in shell (including
    // AppLayout's sidebar) can be made inert without also disabling the dialog.
    const appRoot = document.getElementById('root');
    const rootWasInert = appRoot?.hasAttribute('inert');
    const previousRootAriaHidden = appRoot?.getAttribute('aria-hidden');
    document.body.style.overflow = 'hidden';
    if (appRoot) {
      appRoot.setAttribute('inert', '');
      appRoot.setAttribute('aria-hidden', 'true');
    }

    const focusEditor = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector('[autofocus]')?.focus();
    });
    const containFocus = (event) => {
      if (event.key === 'Escape') {
        if (!busyRef.current) void requestCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hidden && element.tabIndex >= 0 && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', containFocus);
    return () => {
      aliveRef.current = false;
      window.cancelAnimationFrame(focusEditor);
      window.removeEventListener('keydown', containFocus);
      document.body.style.overflow = previousOverflow;
      if (appRoot) {
        if (rootWasInert) appRoot.setAttribute('inert', '');
        else appRoot.removeAttribute('inert');
        if (previousRootAriaHidden === null) appRoot.removeAttribute('aria-hidden');
        else appRoot.setAttribute('aria-hidden', previousRootAriaHidden);
      }
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
      const abandoned = [...sessionUploadsRef.current];
      sessionUploadsRef.current.clear();
      for (const publicId of abandoned) void adminApi.deleteWholesaleImage(publicId).catch(() => undefined);
    };
  }, []);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  function announceError(message) {
    const value = String(message || 'The wholesale action could not be completed.');
    setEditorStatus('');
    setEditorError(value);
    toast.error(value);
  }

  function announceStatus(message) {
    const value = String(message || 'Wholesale listing updated.');
    setEditorError('');
    setEditorStatus(value);
    toast.success(value);
  }

  async function deleteAsset(publicId, notify = false) {
    if (!publicId) return true;
    try {
      await adminApi.deleteWholesaleImage(publicId);
      return true;
    } catch (error) {
      if ([404, 409].includes(error?.response?.status)) return true;
      if (notify) announceError(apiMessage(error, 'The unused image could not be removed.'));
      return false;
    }
  }

  async function cleanSessionUploads() {
    const publicIds = [...sessionUploadsRef.current];
    const results = await Promise.all(publicIds.map(async (publicId) => {
      const removed = await deleteAsset(publicId);
      if (removed) sessionUploadsRef.current.delete(publicId);
      return removed;
    }));
    return results.every(Boolean);
  }

  async function acceptUpload(uploaded) {
    if (!aliveRef.current) {
      await deleteAsset(uploaded.publicId);
      return false;
    }
    const previous = form.image?.publicId;
    sessionUploadsRef.current.add(uploaded.publicId);
    setField('image', uploaded);
    if (previous && sessionUploadsRef.current.has(previous)) {
      sessionUploadsRef.current.delete(previous);
      const removed = await deleteAsset(previous, true);
      if (!removed) sessionUploadsRef.current.add(previous);
    }
    return true;
  }

  async function removeImage() {
    const previous = form.image?.publicId;
    setField('image', null);
    if (previous && sessionUploadsRef.current.has(previous)) {
      sessionUploadsRef.current.delete(previous);
      const removed = await deleteAsset(previous, true);
      if (!removed) sessionUploadsRef.current.add(previous);
    }
  }

  async function requestClose() {
    if (busyRef.current) return;
    setClosing(true);
    busyRef.current = true;
    const cleaned = await cleanSessionUploads();
    if (!cleaned) announceError('One unused image could not be cleaned up immediately. Cleanup will retry as the editor closes.');
    onClose();
  }
  requestCloseRef.current = requestClose;

  async function persistFields() {
    if (!String(form.title || '').trim()) throw new Error('Give this lot a customer-facing title first.');
    const payload = lotPayload(form);
    const response = form.id
      ? await adminApi.updateWholesaleLot(form.id, { ...payload, version: form.version })
      : await adminApi.createWholesaleLot(payload);
    const lot = response.data.lot;
    const previousAttached = attachedPublicIdRef.current;
    const nextAttached = lot.image?.publicId || null;
    if (nextAttached) sessionUploadsRef.current.delete(nextAttached);
    attachedPublicIdRef.current = nextAttached;
    setForm(normalizeLot(lot));
    if (previousAttached && previousAttached !== nextAttached) {
      void deleteAsset(previousAttached, true);
    }
    return lot;
  }

  async function saveDraft(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const lot = await persistFields();
      announceStatus(lot.status === 'published' ? 'Live listing updated' : 'Draft saved');
      await onSaved(lot);
    } catch (error) {
      announceError(error?.response ? apiMessage(error, 'Could not save this listing') : error.message);
      if (error?.response?.status === 409) await onStale();
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setSaving(true);
    let savedDraft = null;
    try {
      const draft = await persistFields();
      savedDraft = draft;
      if (draft.status === 'published') {
        announceStatus('Live listing updated');
        await onSaved(draft);
        return;
      }
      const { data } = await adminApi.publishWholesaleLot(draft.id, draft.version);
      announceStatus('Wholesale listing published');
      await onSaved(data.lot);
    } catch (error) {
      const message = error?.response ? apiMessage(error, 'Could not publish this listing') : error.message;
      announceError(savedDraft?.status === 'draft' ? `Saved as a private draft. ${message}` : message);
      if (savedDraft) await onPersisted(savedDraft);
      if (error?.response?.status === 409) await onStale();
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div aria-labelledby="wholesale-editor-title" aria-modal="true" className="wholesale-admin fixed inset-0 z-50 flex justify-end" ref={dialogRef} role="dialog">
      <button aria-label="Close wholesale editor" className="absolute inset-0 bg-black/75 backdrop-blur-sm" disabled={busy} onClick={requestClose} tabIndex={-1} type="button" />
      <section className="wa-editor relative z-10 h-full w-full max-w-3xl overflow-y-auto border-l shadow-2xl">
        <p aria-atomic="true" aria-live="assertive" className="sr-only" role="alert">{editorError}</p>
        <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">{editorStatus}</p>
        <div className="wa-editor-bar sticky top-0 z-10 flex items-start justify-between border-b px-5 py-4 backdrop-blur sm:px-7">
          <div>
            <p className="wa-accent-text text-[10px] font-bold uppercase tracking-[0.14em]">{isEdit ? form.lotCode || 'Wholesale lot' : 'New wholesale lot'}</p>
            <h2 className="mt-1 text-xl font-bold tracking-tight" id="wholesale-editor-title">{isEdit ? 'Edit listing' : 'Add special stock'}</h2>
            <p className="wa-muted mt-1 text-[11px]">New work starts private. Publish only when the exact stock is ready.</p>
          </div>
          <button aria-label="Close wholesale editor" className="wa-icon-button rounded-lg p-2" disabled={busy} onClick={requestClose} type="button"><X size={17} /></button>
        </div>

        <form className="space-y-7 p-5 sm:p-7" onSubmit={saveDraft}>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.13em] text-neutral-500">Listing identity</h3>
              {isEdit && <StatusPill status={form.status} />}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer-facing title" wide>
                <input autoFocus className="input" maxLength="160" onChange={(event) => setField('title', event.target.value)} placeholder="Samsung 32GB DDR4 ECC RDIMM lot" value={form.title} />
              </Field>
              <Field label="Brand">
                <input className="input" maxLength="80" onChange={(event) => setField('brand', event.target.value)} placeholder="Samsung" value={form.brand} />
              </Field>
              <Field hint="Required before publishing." label="MPN or SKU">
                <input className="input font-mono" maxLength="96" onChange={(event) => setField('mpn', event.target.value)} placeholder="M393A4K40DB3-CWE" value={form.mpn} />
              </Field>
              <Field label="Listing image" wide>
                <WholesaleImageField
                  disabled={saving || closing}
                  image={form.image}
                  onBusyChange={setUploading}
                  onError={announceError}
                  onRemove={removeImage}
                  onStatus={announceStatus}
                  onUpload={acceptUpload}
                />
              </Field>
            </div>
          </section>

          <section className="wa-divider border-t pt-6">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.13em] text-neutral-500">Memory specification</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Generation">
                <select className="input" onChange={(event) => setField('generation', event.target.value)} value={form.generation}>{GENERATIONS.map((generation) => <option key={generation}>{generation}</option>)}</select>
              </Field>
              <Field label="Form factor">
                <select className="input" onChange={(event) => setField('formFactor', event.target.value)} value={form.formFactor}><option>RDIMM</option><option>LRDIMM</option><option>UDIMM</option><option>SO-DIMM</option></select>
              </Field>
              <Field label="Capacity">
                <input className="input" maxLength="32" onChange={(event) => setField('capacityLabel', event.target.value)} placeholder="32GB" value={form.capacityLabel} />
              </Field>
              <Field label="Speed">
                <input className="input" maxLength="32" onChange={(event) => setField('speedLabel', event.target.value)} placeholder="3200 MT/s" value={form.speedLabel} />
              </Field>
              <Field label="Rank">
                <input className="input" maxLength="32" onChange={(event) => setField('rank', event.target.value)} placeholder="2Rx4" value={form.rank} />
              </Field>
              <Field label="Condition">
                <select className="input" onChange={(event) => setField('condition', event.target.value)} value={form.condition}>{CONDITIONS.map((condition) => <option key={condition}>{condition}</option>)}</select>
              </Field>
            </div>
          </section>

          <section className="wa-divider border-t pt-6">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.13em] text-neutral-500">Stock and quote terms</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Available units">
                <input className="input" min="0" onChange={(event) => setField('quantityAvailable', event.target.value)} type="number" value={form.quantityAvailable} />
              </Field>
              <Field label="Minimum order">
                <input className="input" min="1" onChange={(event) => setField('minimumOrderQuantity', event.target.value)} type="number" value={form.minimumOrderQuantity} />
              </Field>
              <Field label="Order increment">
                <input className="input" min="1" onChange={(event) => setField('orderIncrement', event.target.value)} type="number" value={form.orderIncrement} />
              </Field>
              <Field label="Testing status">
                <input className="input" maxLength="80" onChange={(event) => setField('testStatus', event.target.value)} value={form.testStatus} />
              </Field>
              <Field label="Warranty">
                <input className="input" maxLength="48" onChange={(event) => setField('warranty', event.target.value)} value={form.warranty} />
              </Field>
              <Field label="Ships from">
                <input className="input" maxLength="80" onChange={(event) => setField('shipFrom', event.target.value)} value={form.shipFrom} />
              </Field>
              <Field label="Customer note" wide>
                <textarea className="input min-h-24 resize-y" maxLength="500" onChange={(event) => setField('notes', event.target.value)} placeholder="Matching, condition, packaging, or delivery details shown with this lot." value={form.notes} />
              </Field>
            </div>
          </section>

          <div className="wa-editor-bar sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t px-5 py-4 backdrop-blur sm:-mx-7 sm:flex-row sm:justify-end sm:px-7">
            <button className="btn-ghost" disabled={busy} onClick={requestClose} type="button">Cancel</button>
            <button className="btn-secondary flex items-center justify-center gap-2" disabled={busy} type="submit">
              {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              {form.status === 'published' ? 'Save live changes' : 'Save draft'}
            </button>
            {form.status !== 'published' && (
              <button className="btn-primary flex items-center justify-center gap-2" disabled={busy} onClick={publish} type="button">
                {saving ? <Loader2 className="animate-spin" size={14} /> : <PackageCheck size={14} />}
                Publish listing
              </button>
            )}
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}

export default function WholesaleAdmin() {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [actingId, setActingId] = useState(null);
  const [editorLot, setEditorLot] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestSequence = useRef(0);
  const newRequested = searchParams.get('new') === '1';
  const editRequested = searchParams.get('edit') || '';

  async function loadLots({ quiet = false } = {}) {
    const sequence = ++requestSequence.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError('');
    try {
      const allLots = [];
      let page = 1;
      while (true) {
        // The API remains bounded per request while this workspace deliberately
        // loads every status so the owner can manage the complete inventory.
        // eslint-disable-next-line no-await-in-loop
        const { data } = await adminApi.listWholesaleLots({ page, limit: 100 });
        if (sequence !== requestSequence.current) return;
        allLots.push(...(Array.isArray(data?.lots) ? data.lots : []));
        const pages = Number(data?.pagination?.pages);
        if (!Number.isInteger(pages) || page >= pages) break;
        page += 1;
      }
      setLots(allLots);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setLoadError(apiMessage(error, 'Wholesale inventory could not be loaded.'));
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => { loadLots(); }, []);

  useEffect(() => {
    if (newRequested) {
      setEditorLot({ ...EMPTY_LOT });
      return;
    }
    if (!editRequested) {
      setEditorLot(null);
      return;
    }

    let current = true;
    setEditorLot(null);
    adminApi.getWholesaleLot(editRequested)
      .then(({ data }) => {
        if (current) setEditorLot(data.lot);
      })
      .catch((error) => {
        if (current) {
          toast.error(apiMessage(error, 'Could not load that wholesale listing'));
          setSearchParams({}, { replace: true });
        }
      });
    return () => { current = false; };
  }, [newRequested, editRequested]);

  const summary = useMemo(() => ({
    drafts: lots.filter((lot) => lot.status === 'draft').length,
    published: lots.filter((lot) => lot.status === 'published').length,
    archived: lots.filter((lot) => lot.status === 'archived').length,
    liveUnits: lots.filter((lot) => lot.status === 'published').reduce((total, lot) => total + Number(lot.quantityAvailable || 0), 0),
  }), [lots]);

  const visibleLots = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lots.filter((lot) => {
      if (statusFilter !== 'all' && lot.status !== statusFilter) return false;
      if (!needle) return true;
      return [lot.title, lot.mpn, lot.lotCode, lot.brand, lot.generation, lot.formFactor]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [lots, search, statusFilter]);

  function openNew() {
    setSearchParams({ new: '1' });
  }

  function openEdit(lot) {
    setSearchParams({ edit: lot.id });
  }

  function closeEditor() {
    setEditorLot(null);
    setSearchParams({}, { replace: true });
  }

  async function saved() {
    await loadLots({ quiet: true });
    closeEditor();
  }

  async function persisted() {
    await loadLots({ quiet: true });
  }

  async function stale() {
    await loadLots({ quiet: true });
    closeEditor();
  }

  async function transition(lot, action) {
    if (action === 'archive' && !window.confirm(`Archive wholesale lot “${lot.title || lot.lotCode}”? It will disappear from the public page immediately.`)) return;
    setActingId(lot.id);
    try {
      const operations = {
        publish: () => adminApi.publishWholesaleLot(lot.id, lot.version),
        unpublish: () => adminApi.unpublishWholesaleLot(lot.id, lot.version),
        archive: () => adminApi.archiveWholesaleLot(lot.id, lot.version),
        restore: () => adminApi.restoreWholesaleLot(lot.id, lot.version),
      };
      await operations[action]();
      const messages = { publish: 'Listing published', unpublish: 'Listing moved back to draft', archive: 'Listing archived', restore: 'Listing restored as a draft' };
      toast.success(messages[action]);
      await loadLots({ quiet: true });
      if (editorLot?.id === lot.id) closeEditor();
    } catch (error) {
      if (error?.response?.status === 409) await loadLots({ quiet: true });
      toast.error(apiMessage(error, error?.response?.status === 409 ? 'This listing changed elsewhere. The current version has been reloaded.' : 'Could not update this listing'));
    } finally {
      setActingId(null);
    }
  }

  return (
    <AppLayout requireAdmin>
      <div className="wholesale-admin min-h-full p-5 sm:p-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="wa-accent-text mb-2 text-[10px] font-bold uppercase tracking-[0.15em]">Products / Wholesale</p>
            <h1 className="text-2xl font-bold tracking-tight">Wholesale stock</h1>
            <p className="wa-muted mt-1 max-w-2xl text-[12px] leading-5">All special lots in one place. Draft privately, publish exact stock, and archive without touching the retail catalog.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary flex items-center gap-2" target="_blank" to="/wholesale"><Eye size={14} /> View wholesale page</Link>
            <button className="btn-primary flex items-center gap-2" onClick={openNew} type="button"><Plus size={14} /> Add wholesale listing</button>
          </div>
        </header>

        <ProductWorkspaceNav />

        <section aria-label="Wholesale inventory summary" className="mb-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [FilePenLine, 'Private drafts', summary.drafts],
            [PackageCheck, 'Published lots', summary.published],
            [Boxes, 'Live units', summary.liveUnits],
            [Archive, 'Archived', summary.archived],
          ].map(([Icon, label, value]) => (
            <div className="wa-panel flex items-center gap-3 rounded-xl px-4 py-3" key={label}>
              <span className="wa-summary-icon grid h-9 w-9 place-items-center rounded-lg"><Icon size={16} /></span>
              <span className="min-w-0"><span className="wa-faint block text-[10px] uppercase tracking-wider">{label}</span><strong className="mt-0.5 block font-mono text-lg">{value}</strong></span>
            </div>
          ))}
        </section>

        <section className="wa-panel overflow-hidden rounded-2xl">
          <div className="wa-divider flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-[14px] font-semibold">All wholesale listings</h2>
              <p className="wa-faint mt-0.5 text-[10px]">Draft, live, and archived records stay visible here.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-56">
                <Search className="wa-faint absolute left-3 top-1/2 -translate-y-1/2" size={13} />
                <input aria-label="Search wholesale listings" className="input pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search title, MPN, lot code…" value={search} />
              </div>
              <select aria-label="Filter wholesale listings by status" className="input sm:w-36" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="all">All statuses</option>
                <option value="draft">Drafts</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
              <button aria-label="Refresh wholesale listings" className="btn-secondary grid place-items-center px-3" disabled={refreshing} onClick={() => loadLots({ quiet: true })} type="button"><RefreshCw className={refreshing ? 'animate-spin' : ''} size={14} /></button>
            </div>
          </div>

          {loadError && (
            <div className="wa-error m-4 flex items-center justify-between gap-3 rounded-xl border p-4 text-[12px]" role="alert">
              <span>{loadError}</span><button className="underline" onClick={() => loadLots()} type="button">Retry</button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[12px]">
              <thead>
                <tr className="wa-divider wa-faint border-b text-[10px] uppercase tracking-widest">
                  <th className="p-4 text-left font-normal">Listing</th>
                  <th className="p-4 text-left font-normal">Specification</th>
                  <th className="p-4 text-right font-normal">Available</th>
                  <th className="p-4 text-right font-normal">MOQ / step</th>
                  <th className="p-4 text-left font-normal">Ships from</th>
                  <th className="p-4 text-center font-normal">Status</th>
                  <th className="p-4 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ '--tw-divide-opacity': 1, borderColor: 'var(--border)' }}>
                {loading ? (
                  <tr><td className="wa-muted p-10 text-center" colSpan="7"><Loader2 className="mr-2 inline animate-spin" size={15} /> Loading wholesale records…</td></tr>
                ) : visibleLots.length === 0 ? (
                  <tr>
                    <td className="p-12 text-center" colSpan="7">
                      <Boxes className="wa-faint mx-auto" size={28} />
                      <strong className="wa-strong mt-3 block text-[14px]">{lots.length ? 'No listings match this view' : 'No wholesale listings yet'}</strong>
                      <span className="wa-faint mt-1 block text-[11px]">{lots.length ? 'Change the search or status filter.' : 'Add special stock when it is ready. Nothing has been pre-filled.'}</span>
                      {!lots.length && <button className="btn-primary mx-auto mt-4 flex items-center gap-2" onClick={openNew} type="button"><Plus size={13} /> Add first listing</button>}
                    </td>
                  </tr>
                ) : visibleLots.map((lot) => (
                  <tr className="wa-table-row" key={lot.id}>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="wa-image-preview grid h-11 w-12 shrink-0 place-items-center overflow-hidden rounded-lg">
                          {lot.image?.url ? <img alt="" className="h-full w-full object-contain" src={lot.image.url} /> : <Boxes size={16} />}
                        </div>
                        <div className="min-w-0">
                          <div className="wa-strong max-w-64 truncate font-semibold">{lot.title || 'Untitled draft'}</div>
                          <div className="wa-faint mt-1 flex gap-2 font-mono text-[9px]"><span>{lot.lotCode}</span><span>{lot.mpn || 'MPN pending'}</span></div>
                        </div>
                      </div>
                    </td>
                    <td className="wa-muted p-4">{[lot.capacityLabel, lot.generation, lot.speedLabel, lot.formFactor, lot.rank].filter(Boolean).join(' · ') || 'Not complete'}</td>
                    <td className="p-4 text-right font-mono font-semibold">{lot.quantityAvailable}</td>
                    <td className="wa-muted p-4 text-right font-mono">{lot.minimumOrderQuantity} / {lot.orderIncrement}</td>
                    <td className="wa-muted p-4">{lot.shipFrom || 'Pending'}</td>
                    <td className="p-4 text-center"><StatusPill status={lot.status} /></td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">
                        {lot.status !== 'archived' && (
                          <button aria-label={`Edit ${lot.title}`} className="wa-icon-button rounded-lg p-2" onClick={() => openEdit(lot)} title="Edit listing" type="button"><Pencil size={13} /></button>
                        )}
                        {lot.status === 'draft' && (
                          <button aria-label={`Publish ${lot.title}`} className="wa-icon-button rounded-lg p-2 hover:text-amber-500" disabled={actingId === lot.id} onClick={() => transition(lot, 'publish')} title="Publish listing" type="button"><CheckCircle2 size={13} /></button>
                        )}
                        {lot.status === 'published' && (
                          <button aria-label={`Unpublish ${lot.title}`} className="wa-icon-button rounded-lg p-2" disabled={actingId === lot.id} onClick={() => transition(lot, 'unpublish')} title="Move to draft" type="button"><FilePenLine size={13} /></button>
                        )}
                        {lot.status === 'archived' ? (
                          <button aria-label={`Restore ${lot.title}`} className="wa-icon-button rounded-lg p-2 hover:text-emerald-500" disabled={actingId === lot.id} onClick={() => transition(lot, 'restore')} title="Restore as draft" type="button"><RotateCcw size={13} /></button>
                        ) : (
                          <button aria-label={`Archive ${lot.title}`} className="wa-icon-button rounded-lg p-2 hover:text-red-500" disabled={actingId === lot.id} onClick={() => transition(lot, 'archive')} title="Archive listing" type="button"><Archive size={13} /></button>
                        )}
                        {actingId === lot.id && <Loader2 className="ml-1 animate-spin text-neutral-500" size={12} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {editorLot && <LotEditor initialLot={editorLot} key={editorLot.id || 'new'} onClose={closeEditor} onPersisted={persisted} onSaved={saved} onStale={stale} />}
    </AppLayout>
  );
}

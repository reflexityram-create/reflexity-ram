import { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, Upload, X, Check, Loader2,
  Search, ChevronLeft, ChevronRight, ImageIcon
} from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import ProductWorkspaceNav from '@/components/ProductWorkspaceNav';
import { adminApi } from '@/lib/api';
import { formatStorePrice } from '@/lib/currency';
import { imageUrl } from '@/lib/imageUrl';

const EMPTY_PRODUCT = {
  name: '', line: 'Desktop', generation: 'DDR4',
  brand: '', mpn: '', description: '',
  formFactor: 'UDIMM', capacity: 16, speed: 3200, cas: 'CL16', timings: '', voltage: '1.35V',
  ecc: false,
  condition: 'Used', warranty: '90 Days',
  price: 0, stockQuantity: 0,
  images: [],
};

function ImageUploader({ images, onChange }) {
  const inputRef = useRef();
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append('images', f));
      const { data } = await adminApi.uploadImages(formData);
      onChange([...images, ...data.images]);
      toast.success(`${data.images.length} image${data.images.length !== 1 ? 's' : ''} uploaded`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async (img, idx) => {
    try {
      if (img.publicId) await adminApi.deleteImage(img.publicId);
      onChange(images.filter((_, i) => i !== idx));
    } catch {
      toast.error('Failed to delete image');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {images.map((img, idx) => (
          <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden bg-white/5 group">
            <img src={imageUrl(img)} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => removeImage(img, idx)}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-20 h-20 rounded-lg border border-dashed border-white/20 hover:border-white/40 flex flex-col items-center justify-center gap-1 text-neutral-500 hover:text-white transition-all"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          <span className="text-[10px]">{uploading ? 'Uploading' : 'Add'}</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
    </div>
  );
}

function normalizeProduct(p) {
  if (!p) return EMPTY_PRODUCT;
  return {
    ...EMPTY_PRODUCT,
    ...p,
    // Keep capacity/speed numeric-friendly for inputs
    capacity: p.capacity ?? EMPTY_PRODUCT.capacity,
    speed: p.speed ?? EMPTY_PRODUCT.speed,
  };
}
// Auto-generate slug from product name (server also has a unique index).
const makeSlug = (name) =>
  name ? 'rfx-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) : '';

// Auto-generate SKU from product name.
const makeSku = (name) => {
  const base = (name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return base ? `RFX-${base}` : '';
};

// Form factors valid for a given Line. Server accepts all; laptop only SO-DIMM.
const formFactorsForLine = (line) => {
  if (line === 'Server') return ['RDIMM', 'LRDIMM', 'UDIMM', 'SO-DIMM'];
  if (line === 'Laptop') return ['SO-DIMM'];
  return ['UDIMM'];
};

// Compact labeled field
const Field = ({ label, required, className = '', children }) => (
  <div className={className}>
    <label className="admin-label">{label}{required && ' *'}</label>
    {children}
  </div>
);

function ProductModal({ product, onClose, onSave }) {
  const isEdit = !!product?._id;
  const [form, setForm] = useState(() => normalizeProduct(product));
  const [saving, setSaving] = useState(false);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleLineChange = (line) => {
    setForm(f => {
      const valid = formFactorsForLine(line);
      return { ...f, line, formFactor: valid.includes(f.formFactor) ? f.formFactor : valid[0] };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Product name is required');
    setSaving(true);
    try {
      // Slug + SKU are derived here, never shown in the form. On edit we keep
      // the product's existing slug/sku (the backend ignores slug on update).
      const capacity = Number(form.capacity);
      const speed = Number(form.speed);
      const data = {
        name: form.name.trim(),
        brand: form.brand.trim(),
        mpn: form.mpn.trim(),
        description: form.description.trim(),
        line: form.line,
        generation: form.generation,
        formFactor: form.formFactor,
        capacity,
        capacityLabel: `${capacity}GB`,          // derived
        speed,
        speedLabel: `${speed} MT/s`,             // derived
        cas: form.cas,
        timings: form.timings,
        voltage: form.voltage,
        ecc: Boolean(form.ecc),
        condition: form.condition,
        warranty: form.warranty,
        price: Number(form.price),
        stockQuantity: Number(form.stockQuantity),
        images: form.images,
      };
      if (!isEdit) {
        data.slug = makeSlug(form.name);
        data.sku = makeSku(form.name);
      }
      const result = isEdit
        ? await adminApi.updateProduct(form._id, data)
        : await adminApi.createProduct(data);
      toast.success(isEdit ? 'Product updated' : 'Product created');
      onSave(result.data.product);
    } catch (err) {
      const details = err.response?.data?.details;
      if (details) details.forEach(d => toast.error(d.message));
      else toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const formFactors = formFactorsForLine(form.line);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-auto">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl glass rounded-2xl p-6 my-6">

        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-lg">{isEdit ? 'Edit product' : 'New product'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* PRODUCT */}
          <div>
            <div className="text-[11px] uppercase tracking-widest text-neutral-500 mb-2">Product</div>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Product name" required className="md:col-span-2">
                <input className="input" value={form.name} onChange={e => setField('name', e.target.value)} required autoFocus placeholder="e.g. Samsung 64GB DDR4-3200 ECC RDIMM" />
              </Field>
              <Field label="Manufacturer / brand">
                <input className="input" value={form.brand} onChange={e => setField('brand', e.target.value)} placeholder="e.g. Samsung" />
              </Field>
              <Field label="Manufacturer part number">
                <input className="input" value={form.mpn} onChange={e => setField('mpn', e.target.value)} placeholder="e.g. M386A8K40DM2-CWE" />
              </Field>
              <Field label="Description" className="md:col-span-2">
                <textarea className="input min-h-20 resize-y" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Describe the exact module, condition, and what is included." />
              </Field>
              <Field label="Images" className="md:col-span-2">
                <ImageUploader images={form.images || []} onChange={imgs => setField('images', imgs)} />
              </Field>
            </div>
          </div>

          {/* MEMORY SPECS */}
          <div>
            <div className="text-[11px] uppercase tracking-widest text-neutral-500 mb-2">Memory specifications</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Line">
                <select className="input" value={form.line} onChange={e => handleLineChange(e.target.value)}>
                  <option>Server</option>
                  <option>Desktop</option>
                  <option>Laptop</option>
                </select>
              </Field>
              <Field label="Generation">
                <select className="input" value={form.generation} onChange={e => setField('generation', e.target.value)}>
                  <option>DDR4</option>
                  <option>DDR5</option>
                </select>
              </Field>
              <Field label="Form factor">
                <select className="input" value={form.formFactor} onChange={e => setField('formFactor', e.target.value)}>
                  {formFactors.map(ff => <option key={ff}>{ff}</option>)}
                </select>
              </Field>
              <Field label="Capacity (GB)">
                <input type="number" className="input" value={form.capacity} onChange={e => setField('capacity', e.target.value)} placeholder="16" />
              </Field>
              <Field label="Speed (MT/s)">
                <input type="number" className="input" value={form.speed} onChange={e => setField('speed', e.target.value)} placeholder="3200" />
              </Field>
              <Field label="CAS latency">
                <input className="input" value={form.cas} onChange={e => setField('cas', e.target.value)} placeholder="CL16" />
              </Field>
              <Field label="Timings">
                <input className="input" value={form.timings} onChange={e => setField('timings', e.target.value)} placeholder="16-18-18-38" />
              </Field>
              <Field label="Voltage">
                <input className="input" value={form.voltage} onChange={e => setField('voltage', e.target.value)} placeholder="1.35V" />
              </Field>
              <Field label="ECC">
                <select className="input" value={form.ecc ? 'yes' : 'no'} onChange={e => setField('ecc', e.target.value === 'yes')}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
            </div>
          </div>

          {/* CONDITION + PRICING (side by side) */}
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-neutral-500 mb-2">Condition</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Condition">
                  <select className="input" value={form.condition} onChange={e => setField('condition', e.target.value)}>
                    <option>New</option>
                    <option>Open Box — Tested</option>
                    <option>Refurbished — Tested</option>
                    <option>Used</option>
                  </select>
                </Field>
                <Field label="Warranty">
                  <input className="input" value={form.warranty} onChange={e => setField('warranty', e.target.value)} placeholder="90 Days" />
                </Field>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-neutral-500 mb-2">Pricing &amp; inventory</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Price (CAD)" required>
                  <input type="number" step="0.01" className="input" value={form.price} onChange={e => setField('price', e.target.value)} required placeholder="129.99" />
                </Field>
                <Field label="Stock quantity" required>
                  <input type="number" className="input" value={form.stockQuantity} onChange={e => setField('stockQuantity', e.target.value)} required placeholder="10" />
                </Field>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'Save changes' : 'Create product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminProducts() {
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modalProduct, setModalProduct] = useState(null); // null = closed, {} = new, {...} = edit
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStock = searchParams.get('stock');
  const stockFilter = ['in', 'low', 'out'].includes(requestedStock) ? requestedStock : '';

  // Quick actions via URL params:
  //  ?new=1        → open the Add modal
  //  ?edit=<id>    → open the Edit modal for that product (used by the
  //                  "Edit this product" button on the public store page)
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setModalProduct({});
      setModalOpen(true);
      setSearchParams({}, { replace: true });
      return;
    }
    const editId = searchParams.get('edit');
    if (editId) {
      adminApi.getProduct(editId)
        .then(({ data }) => {
          setModalProduct(data.product);
          setModalOpen(true);
        })
        .catch(() => toast.error('Could not load that product'))
        .finally(() => setSearchParams({}, { replace: true }));
    }
  }, [searchParams]);

  const load = (p = page, q = search, stock = stockFilter) => {
    setLoading(true);
    adminApi.listProducts({
      page: p,
      limit: 15,
      search: q || undefined,
      stock: stock || undefined,
    })
      .then(({ data }) => {
        setProducts(data.products);
        setPagination(data.pagination);
      })
      .catch(() => toast.error('Failed to load products'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, stockFilter]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load(1, search, stockFilter);
  };

  const handleSave = (product) => {
    setModalOpen(false);
    load();
  };

  const handleStatusChange = async (product) => {
    const nextActive = !product.isActive;
    if (!confirm(`${nextActive ? 'Reactivate' : 'Deactivate'} this product?`)) return;
    setDeletingId(product._id);
    try {
      if (nextActive) await adminApi.updateProduct(product._id, { isActive: true });
      else await adminApi.deleteProduct(product._id);
      toast.success(`Product ${nextActive ? 'reactivated' : 'deactivated'}`);
      load();
    } catch {
      toast.error(`Failed to ${nextActive ? 'reactivate' : 'deactivate'} product`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppLayout requireAdmin>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-amber-300">Products / Retail</p>
            <h1 className="text-2xl font-bold tracking-tight">Retail products</h1>
            <p className="text-neutral-500 text-[13px] mt-0.5">{pagination.total} total products</p>
          </div>
          <button
            onClick={() => { setModalProduct({}); setModalOpen(true); }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={14} />
            Add product
          </button>
        </div>

        <ProductWorkspaceNav showWholesaleActions />

        {stockFilter && (
          <div className="mb-4 flex items-center gap-2 text-[12px] text-amber-300">
            Showing {stockFilter} stock products
            <Link to="/admin/products" className="text-neutral-400 hover:text-white underline">
              Clear filter
            </Link>
          </div>
        )}

        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              className="input pl-9"
              placeholder="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-secondary">Search</button>
        </form>

        {/* Table */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-neutral-500 text-[11px] uppercase tracking-widest border-b border-white/5">
                  <th className="text-left p-4 font-normal">Product</th>
                  <th className="text-left p-4 font-normal">SKU</th>
                  <th className="text-left p-4 font-normal">Gen</th>
                  <th className="text-right p-4 font-normal">Price (CAD)</th>
                  <th className="text-right p-4 font-normal">Stock</th>
                  <th className="text-center p-4 font-normal">Status</th>
                  <th className="text-right p-4 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-neutral-500">
                      <Loader2 size={16} className="animate-spin inline mr-2" />
                      Loading…
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-neutral-500">No products found</td>
                  </tr>
                ) : (
                  products.map((p) => (
                    <tr key={p._id} className="hover:bg-white/2 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 shrink-0">
                            {p.images?.[0] ? (
                              <img src={imageUrl(p.images[0])} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-neutral-600">
                                <ImageIcon size={14} />
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="font-medium line-clamp-1">{p.name}</div>
                            <div className="mono text-[10px] text-neutral-500">{p.slug}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 mono text-[11px] text-neutral-400">{p.sku}</td>
                      <td className="p-4">
                        <span className="pill pill-blue text-[10px] py-0.5">{p.generation}</span>
                      </td>
                      <td className="p-4 text-right mono">{formatStorePrice(p.price)}</td>
                      <td className="p-4 text-right">
                        <span className={`font-medium ${p.stockQuantity === 0 ? 'text-red-400' : p.stock === 'low' ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {p.stockQuantity}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        {p.isActive ? (
                          <span className="pill pill-accent text-[10px] py-0.5">Active</span>
                        ) : (
                          <span className="pill text-[10px] py-0.5 text-neutral-500">Inactive</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            to={`/shop/${p.slug}`}
                            target="_blank"
                            className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
                            title="View on store"
                          >
                            <ChevronRight size={13} />
                          </Link>
                          <button
                            onClick={() => { setModalProduct(p); setModalOpen(true); }}
                            className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
                            title="Edit product"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => handleStatusChange(p)}
                            disabled={deletingId === p._id}
                            className={`p-1.5 rounded-lg text-neutral-500 transition-colors ${
                              p.isActive
                                ? 'hover:text-red-400 hover:bg-red-500/10'
                                : 'hover:text-emerald-400 hover:bg-emerald-500/10'
                            }`}
                            title={p.isActive ? 'Deactivate' : 'Reactivate'}
                          >
                            {deletingId === p._id
                              ? <Loader2 size={13} className="animate-spin" />
                              : p.isActive ? <Trash2 size={13} /> : <Check size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-white/5 text-[13px]">
              <span className="text-neutral-500">
                Page {pagination.page} of {pagination.pages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn-ghost py-1.5 px-3 flex items-center gap-1"
                >
                  <ChevronLeft size={13} /> Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                  disabled={page >= pagination.pages}
                  className="btn-ghost py-1.5 px-3 flex items-center gap-1"
                >
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <ProductModal
          product={modalProduct}
          onClose={() => setModalOpen(false)}
          onSave={handleSave}
        />
      )}
    </AppLayout>
  );
}

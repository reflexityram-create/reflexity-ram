import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Box,
  Check,
  CheckCircle2,
  ClipboardList,
  Grid2X2,
  ListFilter,
  Mail,
  Minus,
  PackageSearch,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useStock } from "@/lib/useStock";
import { useSEO } from "@/lib/seo";
import {
  WHOLESALE_CONCEPTS,
  WHOLESALE_FILTERS,
  availableWholesaleReference,
  buildWholesaleQuoteUrl,
  clampQuoteQuantity,
  filterWholesaleReference,
  selectedWholesaleQuoteLines,
  wholesaleStockState,
} from "@/lib/wholesaleLab";
import "@/pages/wholesale-lab.css";

const CONCEPT_ICONS = { board: ListFilter, market: Grid2X2, workbench: ClipboardList };

function ProductIdentity({ product, large = false }) {
  const image = product.images?.[0];
  return (
    <div className={`wl-module${large ? " is-large" : ""}`}>
      <img
        alt={image?.alt || `${product.brand || "Server memory"} ${product.mpn || product.sku}`}
        src={image?.url}
      />
      <div>
        <strong>{product.brand || "Server memory"}</strong>
        <span>{product.mpn || product.sku}</span>
      </div>
    </div>
  );
}

function Filters({ filter, onFilter, query, onQuery }) {
  return (
    <div className="wl-tools">
      <label className="wl-search">
        <Search aria-hidden="true" size={16} />
        <span className="sr-only">Search current stock</span>
        <input
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search MPN, SKU or brand"
          type="search"
          value={query}
        />
        {query && (
          <button aria-label="Clear stock search" onClick={() => onQuery("")} type="button">
            <X size={15} />
          </button>
        )}
      </label>
      <div className="wl-filters" aria-label="Filter inventory">
        {WHOLESALE_FILTERS.map((option) => (
          <button
            aria-pressed={filter === option}
            className={filter === option ? "is-active" : ""}
            key={option}
            onClick={() => onFilter(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ loading, error = false }) {
  const state = wholesaleStockState({ loading, error });
  return (
    <div className="wl-state">
      <PackageSearch aria-hidden="true" />
      <div><strong>{state.title}</strong><p>{state.detail}</p></div>
    </div>
  );
}

function InventoryBoard({ products, loading, error }) {
  return products.length ? (
    <div className="wl-table" role="table" aria-label="Current stock inventory board">
      <div className="wl-row wl-table-head" role="row">
        <span role="columnheader">Module</span>
        <span role="columnheader">Specification</span>
        <span role="columnheader">Condition</span>
        <span role="columnheader">Available</span>
        <span role="columnheader">Quote</span>
      </div>
      {products.map((product) => (
        <article className="wl-row" key={product._id || product.sku} role="row">
          <div role="cell"><ProductIdentity product={product} /></div>
          <div className="wl-spec" role="cell">
            <strong>{product.capacityLabel} · {product.generation}</strong>
            <span>{product.speedLabel} · ECC {product.formFactor}{product.rank ? ` · ${product.rank}` : ""}</span>
          </div>
          <div className="wl-condition" role="cell">
            <span>{product.condition}</span>
            <small>{product.warranty} warranty</small>
          </div>
          <div className="wl-quantity" role="cell"><strong>{product.stockQuantity}</strong><span>units</span></div>
          <div className="wl-quote-cell" role="cell">
            <a
              className="wl-quote"
              href={buildWholesaleQuoteUrl([{ product, quantity: 1 }])}
              rel="noopener noreferrer"
              target="_blank"
            >
              Request quote <ArrowUpRight size={15} />
            </a>
          </div>
        </article>
      ))}
    </div>
  ) : <EmptyState error={error} loading={loading} />;
}

function StockGallery({ products, loading, error }) {
  return products.length ? (
    <div className="wl-gallery" aria-label="Current stock gallery">
      {products.map((product, index) => (
        <article className="wl-card" key={product._id || product.sku} style={{ "--wl-order": index }}>
          <div className="wl-card-image">
            <img
              alt={product.images?.[0]?.alt || `${product.brand || "Server memory"} ${product.mpn || product.sku}`}
              src={product.images?.[0]?.url}
            />
            <span>{product.stockQuantity} available</span>
          </div>
          <div className="wl-card-body">
            <div className="wl-card-label"><span>{product.formFactor}</span><span>{product.condition}</span></div>
            <h3>{product.brand} {product.capacityLabel} {product.generation}</h3>
            <p>{product.mpn || product.sku}</p>
            <dl>
              <div><dt>Speed</dt><dd>{product.speedLabel}</dd></div>
              <div><dt>Type</dt><dd>ECC {product.formFactor}</dd></div>
              <div><dt>Warranty</dt><dd>{product.warranty}</dd></div>
            </dl>
            <a
              className="wl-card-quote"
              href={buildWholesaleQuoteUrl([{ product, quantity: 1 }])}
              rel="noopener noreferrer"
              target="_blank"
            >
              Ask about this stock <ArrowUpRight size={16} />
            </a>
          </div>
        </article>
      ))}
    </div>
  ) : <EmptyState error={error} loading={loading} />;
}

function QuoteWorkbench({ products, allProducts = products, loading, error }) {
  const [quantities, setQuantities] = useState({});
  const selected = selectedWholesaleQuoteLines(allProducts, quantities);
  const selectedUnits = selected.reduce((sum, line) => sum + line.quantity, 0);

  function toggleProduct(product) {
    setQuantities((current) => {
      const next = { ...current };
      if (next[product.sku]) delete next[product.sku];
      else next[product.sku] = 1;
      return next;
    });
  }

  function setQuantity(product, value) {
    setQuantities((current) => ({
      ...current,
      [product.sku]: clampQuoteQuantity(value, product.stockQuantity),
    }));
  }

  if (!allProducts.length) return <EmptyState error={error} loading={loading} />;
  return (
    <div className="wl-workbench">
      <div className="wl-picker" aria-label="Select stock for quote">
        {products.length ? products.map((product) => {
          const quantity = quantities[product.sku] || 0;
          const checked = quantity > 0;
          return (
            <article className={`wl-pick${checked ? " is-selected" : ""}`} key={product._id || product.sku}>
              <button
                aria-label={`${checked ? "Remove" : "Add"} ${product.mpn || product.sku} ${checked ? "from" : "to"} quote`}
                aria-pressed={checked}
                className="wl-pick-toggle"
                onClick={() => toggleProduct(product)}
                type="button"
              >
                {checked ? <Check size={16} /> : <Plus size={16} />}
              </button>
              <ProductIdentity large product={product} />
              <div className="wl-pick-spec">
                <span>{product.capacityLabel} · {product.generation} · {product.speedLabel}</span>
                <small>{product.condition} · {product.stockQuantity} available</small>
              </div>
              {checked && (
                <div className="wl-stepper" aria-label={`Requested quantity for ${product.mpn || product.sku}`} role="group">
                  <button aria-label={`Decrease requested quantity for ${product.mpn || product.sku}`} disabled={quantity <= 1} onClick={() => setQuantity(product, quantity - 1)} type="button"><Minus size={14} /></button>
                  <input
                    aria-label={`Requested quantity for ${product.mpn || product.sku}`}
                    inputMode="numeric"
                    max={product.stockQuantity}
                    min="1"
                    onChange={(event) => setQuantity(product, event.target.value)}
                    type="number"
                    value={quantity}
                  />
                  <button aria-label={`Increase requested quantity for ${product.mpn || product.sku}`} disabled={quantity >= product.stockQuantity} onClick={() => setQuantity(product, quantity + 1)} type="button"><Plus size={14} /></button>
                </div>
              )}
            </article>
          );
        }) : <EmptyState loading={false} />}
      </div>

      <aside className="wl-brief" aria-live="polite">
        <div className="wl-brief-mark"><ClipboardList size={18} /><span>QUOTE BRIEF</span></div>
        <h3>{selected.length ? `${selected.length} SKU${selected.length === 1 ? "" : "s"} selected` : "Start a quote list"}</h3>
        <p>{selected.length ? `${selectedUnits} total unit${selectedUnits === 1 ? "" : "s"} requested` : "Choose one or more modules. Nothing is submitted from this page."}</p>
        <div className="wl-brief-lines">
          {selected.length ? selected.map(({ product, quantity }) => (
            <div key={product.sku}>
              <span>{product.mpn || product.sku}</span>
              <strong>× {quantity}</strong>
            </div>
          )) : (
            <div className="is-empty"><Sparkles size={16} /><span>Your selected SKUs appear here.</span></div>
          )}
        </div>
        {selected.length ? (
          <a href={buildWholesaleQuoteUrl(selected)} rel="noopener noreferrer" target="_blank">
            Review email draft <ArrowUpRight size={16} />
          </a>
        ) : (
          <button disabled type="button">Select stock to continue</button>
        )}
        <small>Availability, pricing, shipping, and payment terms are confirmed personally before any sale.</small>
      </aside>
    </div>
  );
}

export default function WholesaleLab() {
  useSEO({
    title: "Wholesale stock concepts | Reflexity local lab",
    description: "Local-only design concepts for presenting Reflexity wholesale RAM stock.",
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedConcept = searchParams.get("concept");
  const concept = WHOLESALE_CONCEPTS.find(({ id }) => id === requestedConcept) || WHOLESALE_CONCEPTS[0];
  const [filter, setFilter] = useState(WHOLESALE_FILTERS[0]);
  const [query, setQuery] = useState("");
  const { server, loading, error } = useStock(100);
  const inventory = useMemo(() => availableWholesaleReference(server), [server]);
  const visible = useMemo(
    () => filterWholesaleReference(inventory, filter, query),
    [filter, inventory, query],
  );
  const units = inventory.reduce((sum, product) => sum + Number(product.stockQuantity || 0), 0);

  function chooseConcept(id) {
    setSearchParams({ concept: id }, { replace: true });
  }

  return (
    <div className={`wl-shell wl-mode-${concept.id}`}>
      <Header />
      <main className="wl-page">
        <section className="wl-hero">
          <div className="wl-wrap">
            <div className="wl-labbar">
              <div><span>LOCAL DESIGN LAB</span><strong>Not connected to checkout or wholesale records</strong></div>
              <small>Read-only public catalog reference · not a wholesale offer</small>
            </div>

            <nav className="wl-concepts" aria-label="Wholesale design concepts">
              {WHOLESALE_CONCEPTS.map((option) => {
                const Icon = CONCEPT_ICONS[option.id];
                const active = option.id === concept.id;
                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    className={active ? "is-active" : ""}
                    key={option.id}
                    onClick={() => chooseConcept(option.id)}
                    type="button"
                  >
                    <span>{option.number}</span>
                    <Icon aria-hidden="true" size={17} />
                    <div><strong>{option.label}</strong><small>{option.summary}</small></div>
                    {active && <CheckCircle2 aria-hidden="true" className="wl-concept-check" size={17} />}
                  </button>
                );
              })}
            </nav>

            <div className="wl-hero-grid">
              <div className="wl-hero-copy" key={concept.id}>
                <p className="wl-kicker"><span /> {concept.eyebrow}</p>
                <h1>{concept.lead}<br /><em>{concept.accent}</em></h1>
                <p className="wl-lede">{concept.description}</p>
              </div>
              <aside className="wl-signal" aria-label="Current catalog summary">
                <div><strong>{loading || error ? "—" : inventory.length}</strong><span>{error ? "Catalog unavailable" : "Current SKUs"}</span></div>
                <div><strong>{loading || error ? "—" : units}</strong><span>{error ? "Totals withheld" : "Units visible"}</span></div>
                <div><strong>YYZ</strong><span>Ships from Toronto</span></div>
              </aside>
            </div>

            <div className="wl-trustline">
              <span><ShieldCheck size={16} /> Tested condition stated per SKU</span>
              <span><Box size={16} /> Quote terms confirmed before sale</span>
              <Link to="/liquidators">Selling stock instead? <strong>Open liquidation desk</strong></Link>
            </div>
          </div>
        </section>

        <section className="wl-inventory" aria-labelledby="wl-inventory-heading">
          <div className="wl-wrap">
            <div className="wl-section-head">
              <div>
                <p>{concept.id === "workbench" ? "BUILD A REQUIREMENT" : "AVAILABLE NOW"}</p>
                <h2 id="wl-inventory-heading">
                  {concept.id === "board" && "Current catalog stock"}
                  {concept.id === "market" && "Browse every module"}
                  {concept.id === "workbench" && "Create a quote brief"}
                </h2>
              </div>
              <Filters filter={filter} onFilter={setFilter} onQuery={setQuery} query={query} />
            </div>

            {concept.id === "board" && <InventoryBoard error={error} loading={loading} products={visible} />}
            {concept.id === "market" && <StockGallery error={error} loading={loading} products={visible} />}
            {concept.id === "workbench" && <QuoteWorkbench allProducts={inventory} error={error} loading={loading} products={visible} />}

            <div className="wl-bottom-cta">
              <div><span>Can&apos;t see the exact SKU?</span><strong>Send the requirement. Reflexity will confirm whether it can be sourced.</strong></div>
              <a href="https://mail.google.com/mail/?view=cm&fs=1&to=reflexityram@gmail.com&su=Wholesale%20RAM%20sourcing%20request" rel="noopener noreferrer" target="_blank"><Mail size={16} /> Source a SKU</a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

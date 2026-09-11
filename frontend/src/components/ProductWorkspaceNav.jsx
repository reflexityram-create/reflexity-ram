import { ArrowRight, Boxes, Package, Plus } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import './ProductWorkspaceNav.css';

const WORKSPACES = [
  {
    to: '/admin/products',
    end: true,
    label: 'Retail products',
    description: 'Store catalog, prices, checkout stock, and product feeds',
    action: 'Open retail catalog',
    icon: Package,
  },
  {
    to: '/admin/wholesale',
    end: false,
    label: 'Wholesale lots',
    description: 'Special stock, private drafts, and quote-only listings',
    action: 'Manage all listings',
    icon: Boxes,
  },
];

export default function ProductWorkspaceNav({ showWholesaleActions = false }) {
  return (
    <section aria-labelledby="product-workspaces-title" className="product-workspace-panel">
      <div className="product-workspace-heading">
        <div>
          <p>Product workspaces</p>
          <h2 id="product-workspaces-title">Retail and wholesale, clearly separated.</h2>
          <span>Wholesale lots never enter the retail cart, checkout stock, or product feed.</span>
        </div>

        {showWholesaleActions && (
          <div aria-label="Wholesale quick actions" className="product-workspace-actions">
            <Link className="product-workspace-action is-secondary" to="/admin/wholesale">
              Manage all
            </Link>
            <Link className="product-workspace-action is-primary" to="/admin/wholesale?new=1">
              <Plus aria-hidden="true" size={14} /> Add wholesale listing
            </Link>
          </div>
        )}
      </div>

      <nav aria-label="Product workspaces" className="product-workspace-grid">
        {WORKSPACES.map(({ to, end, label, description, action, icon: Icon }) => (
          <NavLink
            className={({ isActive }) => `product-workspace-card${isActive ? ' is-active' : ''}`}
            end={end}
            key={to}
            to={to}
          >
            {({ isActive }) => (
              <>
                <span className="product-workspace-card-top">
                  <span className="product-workspace-icon">
                    <Icon aria-hidden="true" size={16} />
                  </span>
                  <span className="product-workspace-copy">
                    <strong>{label}</strong>
                    <span>{description}</span>
                  </span>
                  {isActive && <span className="product-workspace-current">Current</span>}
                </span>
                <span className="product-workspace-card-action">
                  {action} <ArrowRight aria-hidden="true" size={13} />
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </section>
  );
}

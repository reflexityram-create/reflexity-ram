import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Package, ShoppingBag, Users, AlertTriangle, Loader2 } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import { adminApi } from '@/lib/api';
import { TONE_CLASS, paymentState, showPaymentLabel } from '@/lib/orderPayment';

const STATUS_PILLS = {
  pending: 'pill-amber',
  processing: 'pill-blue',
  shipped: 'pill-accent',
  delivered: 'pill-accent',
  cancelled: '',
  refunded: '',
};

function StatCard({ icon: Icon, label, value, sub, color = 'text-white' }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-white/5 ${color}`}>
          <Icon size={16} />
        </div>
      </div>
      <div className={`text-3xl font-bold tracking-tight ${color}`}>{value}</div>
      <div className="text-[12px] text-neutral-500 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-neutral-600 mt-1">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.stats()
      .then(({ data }) => setData(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-neutral-500 text-[13px] mt-1">Reflexity RAM admin overview</p>
          </div>
          {/* Quick actions — the two things you do most, one click from anywhere */}
          <div className="flex gap-2">
            <Link to="/admin/products?new=1" className="btn-primary text-[13px]">+ Add product</Link>
            <Link to="/admin/orders" className="btn-secondary text-[13px]">View orders</Link>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-neutral-400">
            <Loader2 size={16} className="animate-spin" />
            Loading stats…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard
                icon={TrendingUp}
                label="Total revenue"
                value={`$${(data?.stats.totalRevenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                color="text-emerald-400"
              />
              <StatCard
                icon={ShoppingBag}
                label="Total orders"
                value={data?.stats.totalOrders || 0}
                sub={`${data?.stats.pendingOrders || 0} pending${data?.stats.awaitingPayment > 0 ? ` · ${data.stats.awaitingPayment} awaiting payment` : ''}`}
              />
              <StatCard
                icon={Package}
                label="Active products"
                value={data?.stats.totalProducts || 0}
                sub={data?.stats.lowStockProducts > 0 ? `${data.stats.lowStockProducts} low stock` : undefined}
                color={data?.stats.lowStockProducts > 0 ? 'text-amber-400' : 'text-white'}
              />
              <StatCard
                icon={Users}
                label="Customers"
                value={data?.stats.totalUsers || 0}
              />
            </div>

            {/* Recent orders */}
            <div className="glass rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-semibold tracking-tight text-[15px]">Recent orders</h3>
                <Link to="/admin/orders" className="text-[12px] text-neutral-400 hover:text-white">
                  View all →
                </Link>
              </div>
              {data?.recentOrders?.length === 0 ? (
                <p className="text-[13px] text-neutral-500">No orders yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-neutral-500 text-[11px] uppercase tracking-widest border-b border-white/5">
                        <th className="text-left pb-3 font-normal">Order</th>
                        <th className="text-left pb-3 font-normal">Customer</th>
                        <th className="text-left pb-3 font-normal">Status</th>
                        <th className="text-right pb-3 font-normal">Total</th>
                        <th className="text-right pb-3 font-normal">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data?.recentOrders?.map((o) => (
                        <tr key={o._id} className="hover:bg-white/2 transition-colors">
                          <td className="py-3">
                            <Link to={`/admin/orders/${o._id}`} className="mono text-[11px] hover:text-white/80">
                              {o.orderNumber}
                            </Link>
                          </td>
                          <td className="py-3 text-neutral-400">
                            {o.user?.email || o.guestEmail || '—'}
                          </td>
                          <td className="py-3">
                            <span className={`pill ${STATUS_PILLS[o.status] || 'pill-blue'} text-[10px] py-0.5`}>
                              {o.status}
                            </span>
                            {showPaymentLabel(o) && (
                              <span className={`pill ${TONE_CLASS[paymentState(o).tone]} text-[10px] py-0.5 ml-1.5`} data-testid="order-payment-label">{paymentState(o).label}</span>
                            )}
                          </td>
                          <td className="py-3 text-right mono">${o.total?.toFixed(2)}</td>
                          <td className="py-3 text-right text-neutral-500">
                            {new Date(o.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Low stock alert */}
            {data?.stats.lowStockProducts > 0 && (
              <div className="mt-4 glass rounded-2xl p-4 flex items-center gap-3 border border-amber-500/20">
                <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                <div className="flex-1 text-[13px]">
                  <span className="font-semibold text-amber-400">{data.stats.lowStockProducts} products</span>
                  <span className="text-neutral-400"> are running low on stock.</span>
                </div>
                <Link to="/admin/products?stock=low" className="text-[12px] text-neutral-400 hover:text-white">
                  Review →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

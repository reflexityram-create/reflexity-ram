import { useEffect, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, Shield, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { adminApi } from '@/lib/api';
import useAuthStore from '@/lib/authStore';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [updatingId, setUpdatingId] = useState(null);
  const { user: currentUser } = useAuthStore();

  const load = (p = page) => {
    setLoading(true);
    adminApi.listUsers({ page: p, limit: 20 })
      .then(({ data }) => {
        setUsers(data.users);
        setPagination(data.pagination);
      })
      .catch(() => toast.error('Failed to load users'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page]);

  const toggleRole = async (u) => {
    if (u._id === currentUser?._id) {
      toast.error("You can't change your own role");
      return;
    }
    setUpdatingId(u._id);
    try {
      const newRole = u.role === 'admin' ? 'customer' : 'admin';
      const { data } = await adminApi.updateUser(u._id, { role: newRole });
      setUsers(users.map(usr => usr._id === u._id ? data.user : usr));
      toast.success(`Role updated to ${newRole}`);
    } catch {
      toast.error('Failed to update role');
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleActive = async (u) => {
    if (u._id === currentUser?._id) {
      toast.error("You can't deactivate yourself");
      return;
    }
    setUpdatingId(u._id);
    try {
      const { data } = await adminApi.updateUser(u._id, { isActive: !u.isActive });
      setUsers(users.map(usr => usr._id === u._id ? data.user : usr));
      toast.success(`User ${data.user.isActive ? 'activated' : 'deactivated'}`);
    } catch {
      toast.error('Failed to update user');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <AppLayout requireAdmin>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-neutral-500 text-[13px] mt-0.5">{pagination.total} total users</p>
        </div>

        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-neutral-500 text-[11px] uppercase tracking-widest border-b border-white/5">
                  <th className="text-left p-4 font-normal">User</th>
                  <th className="text-left p-4 font-normal">Email</th>
                  <th className="text-left p-4 font-normal hidden md:table-cell">Phone</th>
                  <th className="text-left p-4 font-normal">Role</th>
                  <th className="text-left p-4 font-normal">Status</th>
                  <th className="text-right p-4 font-normal">Joined</th>
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
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-neutral-500">No users found</td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u._id} className="hover:bg-white/2 transition-colors">
                      <td className="p-4">
                        <div className="font-medium">{u.firstName} {u.lastName}</div>
                        {u._id === currentUser?._id && (
                          <div className="text-[10px] text-neutral-500">You</div>
                        )}
                      </td>
                      <td className="p-4 text-neutral-400">{u.email}</td>
                      <td className="p-4 text-neutral-400 hidden md:table-cell mono text-[12px]">
                        {u.phone || <span className="text-neutral-600">—</span>}
                      </td>
                      <td className="p-4">
                        <span className={`pill text-[10px] py-0.5 ${u.role === 'admin' ? 'pill-accent' : 'pill-blue'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`pill text-[10px] py-0.5 ${u.isActive ? 'pill-accent' : 'text-neutral-500'}`}>
                          {u.isActive ? 'Active' : 'Inactive'}
                        </span>
                        {!u.isEmailVerified && (
                          <span className="ml-1 text-[10px] text-amber-400">⚠ Unverified</span>
                        )}
                      </td>
                      <td className="p-4 text-right text-neutral-500">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => toggleRole(u)}
                            disabled={updatingId === u._id}
                            className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
                            title={u.role === 'admin' ? 'Remove admin' : 'Make admin'}
                          >
                            {updatingId === u._id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : u.role === 'admin' ? (
                              <ShieldOff size={13} />
                            ) : (
                              <Shield size={13} />
                            )}
                          </button>
                          <button
                            onClick={() => toggleActive(u)}
                            disabled={updatingId === u._id}
                            className={`px-2.5 py-1 rounded-lg text-[11px] transition-colors ${
                              u.isActive
                                ? 'text-neutral-500 hover:text-red-400 hover:bg-red-500/10'
                                : 'text-neutral-500 hover:text-emerald-400 hover:bg-emerald-500/10'
                            }`}
                          >
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {pagination.pages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-white/5 text-[13px]">
              <span className="text-neutral-500">Page {pagination.page} of {pagination.pages}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost py-1.5 px-3 flex items-center gap-1">
                  <ChevronLeft size={13} /> Prev
                </button>
                <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages} className="btn-ghost py-1.5 px-3 flex items-center gap-1">
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

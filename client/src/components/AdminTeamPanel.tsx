import React, { useEffect, useMemo, useState } from 'react';
import { adminDeactivateUser, adminInviteUser, adminListUsers, adminUpdateUser, type AppUserRole } from '../services/api';
import { WARD_BOARD_COLUMNS } from '../features/clinical/shared/wardBoardColumns';

type Row = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: AppUserRole;
  halo_user_id: string | null;
  default_ward_column_id?: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
};

export const AdminTeamPanel: React.FC<{ onToast?: (m: string, t: 'success' | 'error' | 'info') => void }> = ({ onToast }) => {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<Row[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AppUserRole>('user');
  const [inviteHaloUserId, setInviteHaloUserId] = useState('');
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; emailSent: boolean; emailError?: string } | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await adminListUsers();
      setUsers(
        r.users.map((u) => ({
          ...(u as Row),
          default_ward_column_id: (u as { default_ward_column_id?: string | null }).default_ward_column_id ?? null,
        }))
      );
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Could not load users.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const submitInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setLoading(true);
    setInviteResult(null);
    try {
      const r = await adminInviteUser({
        email,
        role: inviteRole,
        haloUserId: inviteHaloUserId.trim() || null,
      });
      setInviteResult({ inviteUrl: r.inviteUrl, emailSent: r.emailSent, emailError: r.emailError });
      onToast?.(r.emailSent ? 'Invite sent.' : 'Invite created (copy link).', r.emailSent ? 'success' : 'info');
      setInviteEmail('');
      setInviteHaloUserId('');
      await refresh();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Invite failed.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const activeCount = useMemo(() => users.filter((u) => u.is_active).length, [users]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Team</div>
          <div className="text-sm font-semibold text-slate-800 mt-1">{activeCount} active users</div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-[1.2fr_0.7fr_0.9fr_auto] gap-2 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Invite email</span>
          <input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="user@example.com"
            inputMode="email"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Role</span>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as AppUserRole)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Halo user id (optional)</span>
          <input
            value={inviteHaloUserId}
            onChange={(e) => setInviteHaloUserId(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="e.g. 27825897106"
          />
        </label>
        <button
          type="button"
          onClick={() => void submitInvite()}
          disabled={loading || !inviteEmail.trim()}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          Invite
        </button>
      </div>

      {inviteResult ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-slate-700">
            {inviteResult.emailSent ? 'Email sent' : 'SMTP not configured — copy link'}
          </div>
          {inviteResult.emailError ? <div className="text-[11px] text-rose-600 mt-1">{inviteResult.emailError}</div> : null}
          <div className="mt-2 flex items-center gap-2">
            <input value={inviteResult.inviteUrl} readOnly className="flex-1 rounded border border-slate-200 px-2 py-1 text-[11px] bg-white" />
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold hover:bg-slate-50"
              onClick={() => void navigator.clipboard?.writeText(inviteResult.inviteUrl)}
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-[860px] w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Email</th>
              <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Name</th>
              <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Role</th>
              <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Halo user id</th>
              <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Default ward</th>
              <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Status</th>
              <th className="text-right px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="bg-white">
                <td className="px-3 py-2 text-slate-800">{u.email}</td>
                <td className="px-3 py-2 text-slate-700">{`${u.first_name} ${u.last_name}`.trim() || '—'}</td>
                <td className="px-3 py-2">
                  <select
                    value={u.role}
                    onChange={(e) => {
                      const role = e.target.value as AppUserRole;
                      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role } : x)));
                    }}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-sm"
                    disabled={loading}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    value={u.halo_user_id || ''}
                    onChange={(e) => {
                      const halo_user_id = e.target.value;
                      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, halo_user_id: halo_user_id || null } : x)));
                    }}
                    className="w-44 rounded border border-slate-200 px-2 py-1 text-sm"
                    placeholder="(none)"
                    disabled={loading}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={u.default_ward_column_id ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setUsers((prev) =>
                        prev.map((x) => (x.id === u.id ? { ...x, default_ward_column_id: v ? v : null } : x))
                      );
                    }}
                    className="max-w-[9rem] rounded border border-slate-200 bg-white px-2 py-1 text-sm"
                    disabled={loading}
                  >
                    <option value="">(none)</option>
                    {WARD_BOARD_COLUMNS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${u.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                    {u.is_active ? 'active' : 'disabled'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      disabled={loading}
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold hover:bg-slate-50 disabled:opacity-60"
                      onClick={() => {
                        setLoading(true);
                        adminUpdateUser(u.id, {
                          role: u.role,
                          haloUserId: u.halo_user_id,
                          defaultWardColumnId: u.default_ward_column_id,
                        })
                          .then(() => onToast?.('User updated.', 'success'))
                          .catch((e) => onToast?.(e instanceof Error ? e.message : 'Update failed.', 'error'))
                          .finally(() => setLoading(false));
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={loading || !u.is_active}
                      className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                      onClick={() => {
                        if (!confirm(`Deactivate ${u.email}?`)) return;
                        setLoading(true);
                        adminDeactivateUser(u.id)
                          .then(() => {
                            onToast?.('User deactivated.', 'success');
                            setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_active: false } : x)));
                          })
                          .catch((e) => onToast?.(e instanceof Error ? e.message : 'Deactivate failed.', 'error'))
                          .finally(() => setLoading(false));
                      }}
                    >
                      Deactivate
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-slate-500 text-sm">
                  No users yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
};


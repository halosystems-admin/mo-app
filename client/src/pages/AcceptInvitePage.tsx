import React, { useEffect, useMemo, useState } from 'react';
import { acceptInvite, fetchInvite } from '../services/api';

export const AcceptInvitePage: React.FC<{ token: string; onDone: () => void; onToast?: (m: string, t?: 'success' | 'error' | 'info') => void }> = ({
  token,
  onDone,
  onToast,
}) => {
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchInvite(token)
      .then((r) => {
        if (cancelled) return;
        setInviteEmail(r.invite.email);
        setRole(r.invite.role);
        setFirstName(r.invite.firstName || '');
        setLastName(r.invite.lastName || '');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Invite could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const canSubmit = useMemo(() => Boolean(firstName.trim() && lastName.trim() && password.length >= 8), [firstName, lastName, password]);

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    try {
      await acceptInvite({ token, firstName: firstName.trim(), lastName: lastName.trim(), password });
      onToast?.('Account activated.', 'success');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not activate account.');
    }
  };

  return (
    <div className="min-h-screen w-full bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <img src="/halo-medical-logo.png" alt="HALO" className="w-40 h-auto mx-auto mb-6 select-none" draggable={false} />
        <h1 className="text-2xl font-bold text-slate-800 text-center">Activate your account</h1>
        <p className="text-sm text-slate-500 text-center mt-2">
          {loading ? 'Loading invite…' : inviteEmail ? `Invite for ${inviteEmail}` : 'Invite'}
        </p>
        {role ? (
          <p className="text-[11px] text-slate-400 text-center mt-1">Role: {role}</p>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        ) : null}

        <div className="mt-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none transition"
              autoComplete="given-name"
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none transition"
              autoComplete="family-name"
            />
          </div>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 characters)"
            type="password"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none transition"
            autoComplete="new-password"
          />

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit || loading}
            className="w-full flex items-center justify-center gap-3 bg-teal-600 hover:bg-teal-700 text-white px-6 py-4 rounded-xl transition-all shadow-md hover:shadow-lg font-semibold text-lg active:scale-[0.98] disabled:opacity-60"
          >
            Activate
          </button>
        </div>
      </div>
    </div>
  );
};


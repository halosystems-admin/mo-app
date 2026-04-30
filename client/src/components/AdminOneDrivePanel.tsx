import React, { useEffect, useState } from 'react';
import { adminOneDriveConnectUrl, adminOneDriveStatus } from '../services/api';

export const AdminOneDrivePanel: React.FC<{ onToast?: (m: string, t: 'success' | 'error' | 'info') => void }> = ({ onToast }) => {
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await adminOneDriveStatus();
      setConnected(Boolean(r.connected));
      if (!r.connected && r.error) setErr(r.error);
    } catch (e) {
      setConnected(false);
      setErr(e instanceof Error ? e.message : 'Status check failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const connect = async () => {
    setLoading(true);
    setErr(null);
    try {
      const { url } = await adminOneDriveConnectUrl();
      window.location.href = url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not start OneDrive connect.';
      setErr(msg);
      onToast?.(msg, 'error');
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">OneDrive connection</div>
          <div className="text-sm font-semibold text-slate-800 mt-1">
            {connected == null ? 'Checking…' : connected ? 'Connected' : 'Not connected'}
          </div>
          {err ? <div className="text-xs text-rose-600 mt-1">{err}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={loading}
            className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            Connect
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mt-3">
        All app users share this OneDrive. Connect Mo’s Microsoft account once; tokens are stored server-side and refreshed automatically.
      </p>
    </div>
  );
};


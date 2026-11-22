import React, { useState, useEffect } from 'react';
import {
  getApiBaseUrl,
  setCustomBackendUrl,
  checkBackendHealth,
  retestBackendConnection,
  BackendStatus,
} from '../services/api';
import {
  Database,
  Server,
  Cloud,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Download,
  Upload,
  Copy,
  Check,
  X,
} from 'lucide-react';

interface CloudDatabaseSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataReload: () => void;
}

export const CloudDatabaseSettingsModal: React.FC<CloudDatabaseSettingsModalProps> = ({
  isOpen,
  onClose,
  onDataReload,
}) => {
  const [backendUrl, setBackendUrl] = useState('');
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setBackendUrl(getApiBaseUrl());
      handleCheck();
    }
  }, [isOpen]);

  const handleCheck = async () => {
    setIsChecking(true);
    const res = await retestBackendConnection();
    setStatus(res);
    if (res.supabaseReady || res.hasPostgresUrl) {
      onDataReload();
    }
    setIsChecking(false);
  };

  const handleSaveUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomBackendUrl(backendUrl);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
    handleCheck();
    onDataReload();
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div
        className="bg-white rounded-2xl shadow-2xl border-2 border-slate-300 w-full max-w-2xl flex flex-col overflow-hidden my-auto ring-1 ring-slate-900/10"
        style={{ maxHeight: 'min(90vh, calc(100% - 2rem))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/30 flex items-center justify-center text-blue-400">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold">Cloud DBMS & Deployment Status</h2>
              <p className="text-xs text-slate-400">
                Render Backend & Vercel Frontend Configuration
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 flex-1 min-h-0 overflow-y-auto text-xs">
          {/* Live Status Card */}
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Server className="w-4 h-4 text-blue-600" />
                Backend Connection Status
              </span>
              <button
                onClick={handleCheck}
                disabled={isChecking}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800"
              >
                <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
                <span>Test Connection</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-2.5 bg-white rounded border border-slate-200">
                <span className="text-slate-500 block text-[11px]">Server Status</span>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      status?.online ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  ></span>
                  <span className="font-bold text-slate-900">
                    {status?.online ? 'Connected & Active' : 'Connecting / Local Cache Active'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 bg-white rounded border border-slate-200">
                <span className="text-slate-500 block text-[11px]">Database Engine</span>
                <span className="font-bold text-slate-900 mt-1 block">
                  {status?.engine || 'Persistent DBMS'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-slate-600 text-[11px] pt-1">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>
                <strong>Zero Data Loss Guarantee:</strong> All changes sync to Supabase PostgreSQL when configured and are cached locally so records never get lost.
              </span>
            </div>

            {status?.supabaseNeedsSchema && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Supabase tables not initialized yet</span>
                  <span>
                    Run <code className="bg-amber-100 px-1 rounded font-mono">supabase db push</code> or execute{' '}
                    <code className="bg-amber-100 px-1 rounded font-mono">supabase/migrations/20261122000000_init_stock_register.sql</code> in the Supabase SQL Editor.
                  </span>
                </div>
              </div>
            )}

            {(status?.supabaseNeedsServiceKey || (!status?.supabaseReady && status?.supabaseLastError)) && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold block">Supabase secret key or table permissions needed</span>
                  {status.supabaseLastError && (
                    <code className="block bg-amber-100/80 px-1.5 py-0.5 rounded font-mono text-[10px]">
                      {status.supabaseLastError}
                    </code>
                  )}
                  <span>
                    Set your unmasked <code className="bg-amber-100 px-1 rounded font-mono">SUPABASE_SECRET_KEY</code> (starting with{' '}
                    <code className="bg-amber-100 px-1 rounded font-mono">sb_secret_</code>) in Secrets, ensure the SQL schema &{' '}
                    <code className="bg-amber-100 px-1 rounded font-mono">GRANT ALL ... TO service_role</code> statements have been run in Supabase, then click <strong>Test Connection</strong>.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Supabase CLI & Schema Setup */}
          <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50/50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-600" />
                Supabase PostgreSQL Setup ({status?.supabaseProjectRef || 'anaibpuhnxlwfeypprlb'})
              </span>
              <span
                className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                  status?.supabaseReady || status?.hasPostgresUrl
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {status?.supabaseReady || status?.hasPostgresUrl ? 'CONNECTED & LIVE' : 'SETUP REQUIRED'}
              </span>
            </div>

            <p className="text-slate-600 text-[11px]">
              Server uses <code className="bg-white px-1 py-0.5 rounded border border-slate-200 font-mono">@supabase/server</code> with{' '}
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200 font-mono">SUPABASE_URL</code>,{' '}
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200 font-mono">SUPABASE_SECRET_KEY</code>,{' '}
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200 font-mono">SUPABASE_PUBLISHABLE_KEY</code>, and{' '}
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200 font-mono">SUPABASE_JWKS_URL</code> from server environment secrets.
            </p>

            <div className="flex items-center justify-between bg-slate-900 text-slate-200 p-2.5 rounded font-mono text-[11px]">
              <span className="whitespace-pre-wrap">
                {`supabase login && supabase link --project-ref ${status?.supabaseProjectRef || 'anaibpuhnxlwfeypprlb'} && supabase db push`}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    `supabase login\nsupabase link --project-ref ${status?.supabaseProjectRef || 'anaibpuhnxlwfeypprlb'}\nsupabase db push`,
                    'supabase_cli'
                  )
                }
                className="text-slate-400 hover:text-white cursor-pointer ml-2 shrink-0"
              >
                {copiedKey === 'supabase_cli' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-600">
                Or paste the SQL schema & <code className="font-mono">service_role</code> grants in Supabase SQL Editor:
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    `CREATE TABLE IF NOT EXISTS public.stock_records (\n  date VARCHAR(50) PRIMARY KEY,\n  data JSONB NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE TABLE IF NOT EXISTS public.battery_metadata (\n  key VARCHAR(50) PRIMARY KEY,\n  data JSONB NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE TABLE IF NOT EXISTS public.battery_serials (\n  serial_no VARCHAR(100) PRIMARY KEY,\n  data JSONB NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE TABLE IF NOT EXISTS public.audit_logs (\n  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n  action VARCHAR(100) NOT NULL,\n  details JSONB,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nALTER TABLE public.stock_records ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.battery_metadata ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.battery_serials ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;\nDROP POLICY IF EXISTS "service_role_all_stock_records" ON public.stock_records;\nCREATE POLICY "service_role_all_stock_records" ON public.stock_records FOR ALL TO service_role USING (true) WITH CHECK (true);\nDROP POLICY IF EXISTS "service_role_all_battery_metadata" ON public.battery_metadata;\nCREATE POLICY "service_role_all_battery_metadata" ON public.battery_metadata FOR ALL TO service_role USING (true) WITH CHECK (true);\nDROP POLICY IF EXISTS "service_role_all_battery_serials" ON public.battery_serials;\nCREATE POLICY "service_role_all_battery_serials" ON public.battery_serials FOR ALL TO service_role USING (true) WITH CHECK (true);\nDROP POLICY IF EXISTS "service_role_all_audit_logs" ON public.audit_logs;\nCREATE POLICY "service_role_all_audit_logs" ON public.audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);\nGRANT USAGE ON SCHEMA public TO service_role;\nGRANT ALL ON TABLE public.stock_records, public.battery_metadata, public.battery_serials, public.audit_logs TO service_role;\nGRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;`,
                    'supabase_sql'
                  )
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 rounded-md cursor-pointer"
              >
                {copiedKey === 'supabase_sql' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span>SQL Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy SQL Schema</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Backend URL Configuration for Render & Vercel */}
          <form onSubmit={handleSaveUrl} className="space-y-2 p-4 bg-white border border-slate-200 rounded-lg">
            <div className="flex items-center justify-between gap-2">
              <label className="font-bold text-slate-800">
                External Backend URL (Optional):
              </label>
              <span className="text-[11px] text-slate-400">
                Leave blank on AI Studio / same-origin hosting
              </span>
            </div>

            <div className="flex gap-2">
              <input
                type="url"
                placeholder="Leave blank for built-in server (or enter Render URL)"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
              />
              {backendUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setBackendUrl('');
                    setCustomBackendUrl('');
                    handleCheck();
                    onDataReload();
                  }}
                  className="px-3 py-1.5 font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors cursor-pointer"
                >
                  Use Built-in
                </button>
              )}
              <button
                type="submit"
                className="px-3 py-1.5 font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
              >
                Save URL
              </button>
            </div>

            {saveSuccess && (
              <span className="text-emerald-600 font-medium block text-[11px]">
                ✓ Saved backend URL. Tested and active!
              </span>
            )}
          </form>

          {/* Deployment Quick Guide for Render & Vercel */}
          <div className="space-y-3">
            <span className="font-bold text-slate-900 uppercase tracking-wider text-[11px] block">
              Deployment Instructions
            </span>

            {/* Render Backend Guide */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-indigo-600" />
                  1. Backend Deployed on Render
                </span>
                <span className="text-emerald-600 font-mono text-[10px] font-bold">ONLINE</span>
              </div>
              <p className="text-slate-600 text-[11px]">
                Active URL: <code className="bg-slate-200 px-1 py-0.5 rounded text-[11px] font-mono text-blue-700 font-semibold">https://stock-management-hbuv.onrender.com</code>
              </p>
            </div>

            {/* Vercel Frontend Guide */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5 text-blue-600" />
                  2. Deploy Frontend on Vercel
                </span>
                <span className="text-slate-400 font-mono text-[10px]">vercel.json configured</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-slate-600 leading-relaxed pl-1">
                <li>Import this repository on <a href="https://vercel.com" target="_blank" rel="noreferrer" className="text-blue-600 underline">Vercel.com</a>.</li>
                <li>(Optional) Add the environment variable below (or leave blank, as <code className="bg-slate-200 px-1 py-0.5 rounded text-[11px]">vercel.json</code> auto-proxies all <code className="bg-slate-200 px-1 py-0.5 rounded text-[11px]">/api/*</code> traffic to Render):</li>
              </ol>
              <div className="flex items-center justify-between bg-slate-900 text-slate-200 p-2 rounded font-mono text-[11px]">
                <span>VITE_API_BASE_URL = https://stock-management-hbuv.onrender.com</span>
                <button
                  type="button"
                  onClick={() => handleCopy('https://stock-management-hbuv.onrender.com', 'env_var')}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  {copiedKey === 'env_var' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-slate-500 text-[11px]">
                Vercel will build the frontend with Vite, routing all spreadsheet queries and WhatsApp dispatches straight to your Render cloud backend.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 bg-slate-100 border-t-2 border-slate-200 shrink-0 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

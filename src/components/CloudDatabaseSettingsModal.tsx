import React, { useState, useEffect } from 'react';
import {
  getApiBaseUrl,
  setCustomBackendUrl,
  checkBackendHealth,
  retestBackendConnection,
  apiListCloudinaryBackups,
  apiTriggerCloudinaryBackup,
  apiRestoreCloudinaryBackup,
  CloudBackupSnapshotMeta,
  BackendStatus,
} from '../services/api';
import {
  Database,
  Server,
  Cloud,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Download,
  Upload,
  Copy,
  Check,
  X,
  RotateCcw,
  HardDrive,
  FileSpreadsheet,
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

  // Cloudinary Cloud Space state
  const [backups, setBackups] = useState<CloudBackupSnapshotMeta[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoringId, setIsRestoringId] = useState<string | null>(null);
  const [cloudSpaceMessage, setCloudSpaceMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setBackendUrl(getApiBaseUrl());
      handleCheck();
      loadBackups();
    }
  }, [isOpen]);

  const loadBackups = async () => {
    const res = await apiListCloudinaryBackups();
    setBackups(res.backups || []);
  };

  const handleCheck = async () => {
    setIsChecking(true);
    const res = await retestBackendConnection();
    setStatus(res);
    setBackendUrl(getApiBaseUrl());
    if (res.supabaseReady || res.hasPostgresUrl) {
      onDataReload();
    }
    setIsChecking(false);
  };

  const handleTriggerCloudSpaceBackup = async () => {
    setIsBackingUp(true);
    setCloudSpaceMessage(null);
    const res = await apiTriggerCloudinaryBackup(undefined, undefined, 'settings_modal');
    if (res.uploadedToCloudinary) {
      setCloudSpaceMessage(
        `✓ Backed up both Quantity & Serial History Excels (.xlsx) + DB snapshot (${res.recordCount || 0} ledgers, ${res.serialCount || 0} serials) to Cloudinary (${res.cloudName})`
      );
    } else if (res.success && !res.cloudinaryConfigured) {
      setCloudSpaceMessage(
        `✓ Saved both Excels & JSON snapshot to server disk (${res.recordCount || 0} records). Add CLOUDINARY_* secrets to upload to Cloudinary.`
      );
    } else {
      setCloudSpaceMessage(`⚠ Backup warning: ${res.error || 'Could not reach Cloudinary'}`);
    }
    await loadBackups();
    await handleCheck();
    setIsBackingUp(false);
  };

  const handleRestoreSnapshot = async (snap: CloudBackupSnapshotMeta) => {
    if (
      !window.confirm(
        `Restore snapshot "${snap.fileName}" (${snap.source === 'cloudinary' ? 'Cloudinary Cloud Space' : 'Local Server Disk'})? Newer existing records will be preserved while missing/older dates will be restored.`
      )
    ) {
      return;
    }
    setIsRestoringId(snap.id);
    const res = await apiRestoreCloudinaryBackup({
      source: snap.source,
      secureUrl: snap.secureUrl,
      fileName: snap.fileName,
    });
    if (res.success) {
      setCloudSpaceMessage(
        `✓ Restored ${res.restoredRecords || 0} records & ${res.restoredSerials || 0} serials!`
      );
      onDataReload();
    } else {
      setCloudSpaceMessage(`⚠ Restore failed: ${res.error || 'Unknown error'}`);
    }
    setIsRestoringId(null);
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
        className="bg-white rounded-2xl shadow-2xl border-2 border-slate-300 w-full max-w-2xl flex flex-col overflow-y-auto overscroll-contain my-auto ring-1 ring-slate-900/10"
        style={{ maxHeight: 'min(90vh, calc(100% - 2rem))' }}
      >
        {/* Header */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 bg-slate-900 text-white shrink-0 rounded-t-2xl">
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
        <div className="p-6 space-y-5 flex-1 text-xs">
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

            {status && !status.online && status.error && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-[11px]">
                <span className="font-bold block">Backend unreachable ({status.url || 'same-origin'}):</span>
                <code className="font-mono text-[10px]">{status.error}</code>
              </div>
            )}

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

          {/* Cloudinary Cloud Space Permanent Snapshot Backup */}
          <div className="p-4 rounded-lg border border-indigo-200 bg-indigo-50/50 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Cloud className="w-4 h-4 text-indigo-600" />
                <span>
                  Cloudinary Cloud Space Backups{' '}
                  {status?.cloudinary?.cloudName ? `(${status.cloudinary.cloudName})` : ''}
                </span>
              </span>
              <span
                className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                  status?.cloudinary?.configured
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                {status?.cloudinary?.configured ? 'CLOUD SPACE ACTIVE' : 'ENV KEYS NEEDED'}
              </span>
            </div>

            <p className="text-slate-600 text-[11px]">
              Every stock edit automatically exports the live <strong>Stock Register Excel (.xlsx)</strong> and full database JSON snapshot to server disk and uploads both to your Cloudinary Cloud Space (<code className="bg-white px-1 rounded font-mono">stock-register-backups/</code>) so Excel records are never lost.
            </p>

            {!status?.cloudinary?.configured && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900 space-y-1">
                <span className="font-bold block">Add Cloudinary Secrets in Environment Settings:</span>
                <span>
                  Set <code className="bg-amber-100 px-1 rounded font-mono">CLOUDINARY_CLOUD_NAME</code>,{' '}
                  <code className="bg-amber-100 px-1 rounded font-mono">CLOUDINARY_API_KEY</code>,{' '}
                  <code className="bg-amber-100 px-1 rounded font-mono">CLOUDINARY_API_SECRET</code>, and{' '}
                  <code className="bg-amber-100 px-1 rounded font-mono">CLOUDINARY_URL</code> in Secrets, then restart/retest.
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleTriggerCloudSpaceBackup}
                disabled={isBackingUp}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer shadow-2xs"
              >
                <Upload className={`w-3.5 h-3.5 ${isBackingUp ? 'animate-bounce' : ''}`} />
                <span>{isBackingUp ? 'Backing up Excel + DB...' : 'Backup Excel + DB to Cloudinary'}</span>
              </button>

              <a
                href={`${getApiBaseUrl()}/api/cloud/excel/export`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-colors cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>Quantity Excel (.xlsx)</span>
              </a>

              <a
                href={`${getApiBaseUrl()}/api/cloud/excel/serials/export`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded-lg transition-colors cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-blue-700" />
                <span>Serials & History Excel (.xlsx)</span>
              </a>

              <a
                href={`${getApiBaseUrl()}/api/cloud/snapshot/export`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-slate-600" />
                <span>Download JSON (.json)</span>
              </a>
            </div>

            {cloudSpaceMessage && (
              <div className="p-2 rounded bg-white border border-indigo-200 text-[11px] font-semibold text-slate-800">
                {cloudSpaceMessage}
              </div>
            )}

            {backups.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] font-bold text-slate-700 block">
                  Recent Cloudinary & Disk Backups ({backups.length}):
                </span>
                <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                  {backups.slice(0, 12).map((snap) => {
                    const isExcel = snap.format === 'xlsx' || snap.fileName.endsWith('.xlsx');
                    return (
                      <div
                        key={snap.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-white border border-slate-200 rounded text-[11px]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExcel ? (
                            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : snap.source === 'cloudinary' ? (
                            <Cloud className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          ) : (
                            <HardDrive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          )}
                          <div className="truncate">
                            <span className="font-mono font-semibold text-slate-800">{snap.fileName}</span>
                            <span
                              className={`ml-1.5 px-1 py-0.2 rounded text-[9px] font-bold uppercase ${
                                snap.source === 'cloudinary'
                                  ? 'bg-indigo-50 text-indigo-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {snap.source === 'cloudinary' ? 'Cloudinary' : 'Disk'}
                            </span>
                            <span className="text-slate-400 ml-2">
                              {new Date(snap.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        {isExcel ? (
                          <a
                            href={
                              snap.source === 'cloudinary' && snap.secureUrl
                                ? snap.secureUrl
                                : snap.fileName.includes('serial')
                                ? `${getApiBaseUrl()}/api/cloud/excel/serials/export`
                                : `${getApiBaseUrl()}/api/cloud/excel/export`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded cursor-pointer shrink-0"
                          >
                            <Download className="w-3 h-3" />
                            <span>Download .xlsx</span>
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRestoreSnapshot(snap)}
                            disabled={isRestoringId === snap.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded cursor-pointer shrink-0"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>{isRestoringId === snap.id ? 'Restoring...' : 'Restore'}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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

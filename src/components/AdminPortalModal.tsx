import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  Lock,
  Unlock,
  KeyRound,
  Eye,
  EyeOff,
  BarChart3,
  FileSpreadsheet,
  Database,
  Cloud,
  RotateCcw,
  LogOut,
  RefreshCw,
  Download,
  Upload,
  Search,
  AlertTriangle,
  CheckCircle2,
  X,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
  History,
  Server,
  HardDrive,
  GitBranch,
  ExternalLink,
} from 'lucide-react';
import {
  AdminSessionInfo,
  AdminStatusResponse,
  BackendAnalyticsSnapshot,
  CloudBackupSnapshotMeta,
  GitHubCommitOutcome,
  GitHubSyncStatusInfo,
  apiAdminLogin,
  apiAdminLogout,
  apiBulkUpdateBranchPasswords,
  apiChangeAdminPassword,
  apiClaimAdminPassword,
  apiDownloadAdminFile,
  apiFactoryReset,
  apiFetchAdminAnalytics,
  apiFetchBranchCredentials,
  apiGetAdminStatus,
  apiListCloudinaryBackups,
  apiRestoreCloudinaryBackup,
  apiTriggerCloudinaryBackup,
  apiUpdateBranchPassword,
} from '../services/api';
import {
  BatteryColumn,
  BatterySerialItem,
  BranchCredentialSummary,
  BranchTransfer,
  BRANCHES,
  DayRecord,
} from '../types/stock';
import { exportRecordToExcel, exportSerialHistoryToExcel } from '../utils/excelExport';

export type AdminTabId = 'analytics' | 'exports' | 'backend' | 'backups' | 'passwords' | 'security';

interface AdminPortalModalProps {
  isOpen: boolean;
  onClose: () => void;
  adminToken: string | null;
  adminSession: AdminSessionInfo | null;
  onAuthenticated: (token: string, session: AdminSessionInfo) => void;
  onSignedOut: () => void;
  promptReason?: string | null;
  initialTab?: AdminTabId;
  onDataReload: () => void;
  // Client context for branch-level instant Excel downloads
  currentRecord: DayRecord;
  columns: BatteryColumn[];
  serials: Record<string, BatterySerialItem>;
  records: Record<string, DayRecord>;
  transfers: BranchTransfer[];
  activeBranchId: string;
  onShowToast: (msg: string) => void;
}

export const AdminPortalModal: React.FC<AdminPortalModalProps> = ({
  isOpen,
  onClose,
  adminToken,
  adminSession,
  onAuthenticated,
  onSignedOut,
  promptReason,
  initialTab = 'analytics',
  onDataReload,
  currentRecord,
  columns,
  serials,
  records,
  transfers,
  activeBranchId,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTabId>(initialTab);
  const [statusLoading, setStatusLoading] = useState(false);
  const [adminStatus, setAdminStatus] = useState<AdminStatusResponse | null>(null);

  // Login / First-run Claim form states
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [adminLabelInput, setAdminLabelInput] = useState('Piyush Shivhare (Owner & Admin)');
  const [showPassword, setShowPassword] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Analytics & Backend data states
  const [analytics, setAnalytics] = useState<BackendAnalyticsSnapshot | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  // Backups & Restore states
  const [backups, setBackups] = useState<CloudBackupSnapshotMeta[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [confirmRestoreSnap, setConfirmRestoreSnap] = useState<CloudBackupSnapshotMeta | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Search/Filter states in Backend Data / Audit Logs
  const [movementSearch, setMovementSearch] = useState('');
  const [auditFilter, setAuditFilter] = useState('');
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  // Two-step inline Factory Reset state
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // Change password state (only in claimed mode)
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmNewPwd, setConfirmNewPwd] = useState('');
  const [pwdUpdating, setPwdUpdating] = useState(false);

  // Branch & Master Password Manager states
  const [branchCreds, setBranchCreds] = useState<BranchCredentialSummary[]>([]);
  const [credsLoading, setCredsLoading] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GitHubSyncStatusInfo | null>(null);
  const [lastGithubSync, setLastGithubSync] = useState<GitHubCommitOutcome | null>(null);
  const [pwdDrafts, setPwdDrafts] = useState<Record<string, string>>({});
  const [pwdVisibleMap, setPwdVisibleMap] = useState<Record<string, boolean>>({});
  const [masterBulkPwd, setMasterBulkPwd] = useState('');
  const [savingLoginId, setSavingLoginId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    setAuthError(null);
    setActionMessage(null);
    setConfirmRestoreSnap(null);
    setResetConfirmText('');

    const loadStatus = async () => {
      setStatusLoading(true);
      const st = await apiGetAdminStatus(adminToken);
      setAdminStatus(st);
      setStatusLoading(false);
      if (adminToken && !st.authenticated) {
        onSignedOut();
      }
    };
    loadStatus();
  }, [isOpen, initialTab]);

  const loadAnalyticsAndBackups = async (token: string) => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    setBackupsLoading(true);
    setCredsLoading(true);
    try {
      const [anaRes, bkRes, credsRes] = await Promise.all([
        apiFetchAdminAnalytics(token),
        apiListCloudinaryBackups(token),
        apiFetchBranchCredentials(token),
      ]);
      if (anaRes.unauthorized || bkRes.unauthorized || credsRes.unauthorized) {
        onSignedOut();
        setAuthError('Admin session expired. Please sign in again.');
        return;
      }
      if (anaRes.success && anaRes.data) {
        setAnalytics(anaRes.data);
      } else {
        setAnalyticsError(anaRes.error || 'Could not load backend analytics');
      }
      setBackups(bkRes.backups || []);
      if (credsRes.success && credsRes.credentials) {
        setBranchCreds(credsRes.credentials);
        if (credsRes.githubStatus) {
          setGithubStatus(credsRes.githubStatus);
        }
      }
    } finally {
      setAnalyticsLoading(false);
      setBackupsLoading(false);
      setCredsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && adminToken) {
      loadAnalyticsAndBackups(adminToken);
    }
  }, [isOpen, adminToken]);

  const handleFirstRunClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (password.length < 8) {
      setAuthError('Admin password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }
    setAuthSubmitting(true);
    const res = await apiClaimAdminPassword(password, adminLabelInput);
    setAuthSubmitting(false);
    if (res.success && res.token && res.admin) {
      setPassword('');
      setConfirmPassword('');
      onAuthenticated(res.token, res.admin);
      onShowToast('Admin password configured and signed in.');
    } else {
      setAuthError(res.error || 'Could not configure Admin password.');
    }
  };

  // Immediately unlock & open the Admin Panel as soon as the entered password matches on the server
  useEffect(() => {
    const isAuth = Boolean(adminToken);
    const isClaimMode = Boolean(
      adminStatus && adminStatus.success && !adminStatus.configuredViaEnv && !adminStatus.claimed
    );
    if (!isOpen || isAuth || isClaimMode || authSubmitting) return;
    if (password.length < 8) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await apiAdminLogin(password, { silent: true });
      if (cancelled) return;
      if (res.success && res.token && res.admin) {
        setPassword('');
        setAuthError(null);
        onAuthenticated(res.token, res.admin);
        onShowToast('Signed in as Admin.');
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, adminToken, adminStatus, password, authSubmitting]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!password) {
      setAuthError('Enter your Admin password.');
      return;
    }
    setAuthSubmitting(true);
    const res = await apiAdminLogin(password);
    setAuthSubmitting(false);
    if (res.success && res.token && res.admin) {
      setPassword('');
      onAuthenticated(res.token, res.admin);
      onShowToast('Signed in as Admin.');
    } else {
      if (res.needsClaim) {
        const st = await apiGetAdminStatus(null);
        setAdminStatus(st);
      }
      setAuthError(res.error || 'Invalid Admin password.');
    }
  };

  const handleLogout = async () => {
    if (adminToken) {
      await apiAdminLogout(adminToken);
    }
    setAnalytics(null);
    setBackups([]);
    onSignedOut();
    onShowToast('Signed out of Admin session.');
  };

  const handleServerDownload = async (kind: 'quantity' | 'serials' | 'snapshot') => {
    if (!adminToken) return;
    setDownloadingKey(kind);
    setActionMessage(null);
    const res = await apiDownloadAdminFile(kind, adminToken);
    setDownloadingKey(null);
    if (res.unauthorized) {
      onSignedOut();
      return;
    }
    if (res.success) {
      setActionMessage({ type: 'ok', text: `Downloaded ${res.fileName}` });
      onShowToast(`Downloaded ${res.fileName}`);
      loadAnalyticsAndBackups(adminToken);
    } else {
      setActionMessage({ type: 'err', text: res.error || 'Download failed' });
    }
  };

  const handleTriggerBackup = async () => {
    if (!adminToken) return;
    setIsBackingUp(true);
    setActionMessage(null);
    const res = await apiTriggerCloudinaryBackup(undefined, undefined, 'admin_portal', adminToken);
    setIsBackingUp(false);
    if (res.unauthorized) {
      onSignedOut();
      return;
    }
    if (res.uploadedToCloudinary) {
      setActionMessage({
        type: 'ok',
        text: `Uploaded Quantity & Serial Excels + DB snapshot (${res.recordCount || 0} ledgers, ${res.serialCount || 0} serials) to Cloudinary (${res.cloudName}).`,
      });
    } else if (res.success) {
      setActionMessage({
        type: 'ok',
        text: `Saved Excel workbooks & JSON snapshot to server disk (${res.recordCount || 0} ledgers, ${res.serialCount || 0} serials).`,
      });
    } else {
      setActionMessage({ type: 'err', text: res.error || 'Backup failed' });
    }
    await loadAnalyticsAndBackups(adminToken);
  };

  const handleConfirmRestore = async () => {
    if (!adminToken || !confirmRestoreSnap) return;
    setIsRestoring(true);
    setActionMessage(null);
    const res = await apiRestoreCloudinaryBackup(
      {
        source: confirmRestoreSnap.source,
        secureUrl: confirmRestoreSnap.secureUrl,
        fileName: confirmRestoreSnap.fileName,
      },
      adminToken
    );
    setIsRestoring(false);
    setConfirmRestoreSnap(null);
    if (res.unauthorized) {
      onSignedOut();
      return;
    }
    if (res.success) {
      setActionMessage({
        type: 'ok',
        text: `Restored ${res.restoredRecords || 0} records and ${res.restoredSerials || 0} serials.`,
      });
      onDataReload();
      await loadAnalyticsAndBackups(adminToken);
    } else {
      setActionMessage({ type: 'err', text: res.error || 'Snapshot restore failed' });
    }
  };

  const handleConfirmFactoryReset = async () => {
    if (!adminToken || resetConfirmText.trim().toUpperCase() !== 'RESET') return;
    setIsResetting(true);
    setActionMessage(null);
    const res = await apiFactoryReset(adminToken);
    setIsResetting(false);
    setResetConfirmText('');
    if (res.unauthorized) {
      onSignedOut();
      return;
    }
    if (res.success) {
      setActionMessage({
        type: 'ok',
        text: `Factory reset complete. All history wiped cleanly; fresh register initialized from ${res.todayIST}.`,
      });
      onShowToast(`Factory reset complete — fresh register started from ${res.todayIST}`);
      onDataReload();
      await loadAnalyticsAndBackups(adminToken);
    } else {
      setActionMessage({ type: 'err', text: res.error || 'Factory reset failed' });
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setActionMessage(null);
    if (newPwd.length < 8) {
      setActionMessage({ type: 'err', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPwd !== confirmNewPwd) {
      setActionMessage({ type: 'err', text: 'New passwords do not match.' });
      return;
    }
    setPwdUpdating(true);
    const res = await apiChangeAdminPassword(curPwd, newPwd, adminToken);
    setPwdUpdating(false);
    if (res.success) {
      setCurPwd('');
      setNewPwd('');
      setConfirmNewPwd('');
      setActionMessage({ type: 'ok', text: 'Admin password updated successfully.' });
    } else {
      setActionMessage({ type: 'err', text: res.error || 'Failed to update password.' });
    }
  };

  const handleUpdateSingleBranchPassword = async (loginId: string) => {
    if (!adminToken) return;
    const candidate = (pwdDrafts[loginId] || '').trim();
    if (candidate.length < 4) {
      setActionMessage({
        type: 'err',
        text: `New password for "${loginId}" must be at least 4 characters.`,
      });
      return;
    }

    setSavingLoginId(loginId);
    setActionMessage(null);
    const res = await apiUpdateBranchPassword(loginId, candidate, adminToken);
    setSavingLoginId(null);

    if (res.unauthorized) {
      onSignedOut();
      return;
    }
    if (res.success && res.credential) {
      setBranchCreds((prev) =>
        prev.map((c) => (c.loginId === res.credential!.loginId ? res.credential! : c))
      );
      setPwdDrafts((prev) => ({ ...prev, [loginId]: '' }));
      if (res.githubSync) {
        setLastGithubSync(res.githubSync);
      }
      const ghSuffix = res.githubSync?.synced
        ? ` GitHub committed (${res.githubSync.commitSha?.slice(0, 7)}).`
        : '';
      setActionMessage({
        type: 'ok',
        text: `Updated password for "${loginId}" live (v${res.credential.version}). Old password is immediately invalid.${ghSuffix}`,
      });
      onShowToast(`Updated "${loginId}" password live!`);
    } else {
      setActionMessage({
        type: 'err',
        text: res.error || `Failed to update password for "${loginId}".`,
      });
    }
  };

  const handleBulkUpdatePasswords = async (updatesList?: Array<{ loginId: string; newPassword: string }>) => {
    if (!adminToken) return;
    const updates =
      updatesList ||
      branchCreds
        .map((c) => ({
          loginId: c.loginId,
          newPassword: (pwdDrafts[c.loginId] || '').trim(),
        }))
        .filter((u) => u.newPassword.length > 0);

    if (updates.length === 0) {
      setActionMessage({
        type: 'err',
        text: 'Enter at least one new password before running bulk update.',
      });
      return;
    }
    const invalid = updates.find((u) => u.newPassword.length < 4);
    if (invalid) {
      setActionMessage({
        type: 'err',
        text: `Password for "${invalid.loginId}" must be at least 4 characters.`,
      });
      return;
    }

    setSavingLoginId('__ALL__');
    setActionMessage(null);
    const res = await apiBulkUpdateBranchPasswords(updates, adminToken);
    setSavingLoginId(null);

    if (res.unauthorized) {
      onSignedOut();
      return;
    }
    if (res.success && res.credentials) {
      setBranchCreds(res.credentials);
      setPwdDrafts((prev) => {
        const next = { ...prev };
        updates.forEach((u) => {
          delete next[u.loginId];
        });
        return next;
      });
      setMasterBulkPwd('');
      if (res.githubSync) {
        setLastGithubSync(res.githubSync);
      }
      const ghSuffix = res.githubSync?.synced
        ? ` GitHub committed (${res.githubSync.commitSha?.slice(0, 7)}).`
        : '';
      setActionMessage({
        type: 'ok',
        text: `Updated ${res.updatedIds?.length || updates.length} account password(s) live. Previous passwords removed.${ghSuffix}`,
      });
      onShowToast(`Updated ${res.updatedIds?.length || updates.length} login password(s) live!`);
    } else {
      setActionMessage({
        type: 'err',
        text: res.error || 'Bulk password update failed.',
      });
    }
  };

  const handleApplyOnePasswordToAllAccounts = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = masterBulkPwd.trim();
    if (trimmed.length < 4) {
      setActionMessage({
        type: 'err',
        text: 'Shared password must be at least 4 characters.',
      });
      return;
    }
    const updates = branchCreds.map((c) => ({
      loginId: c.loginId,
      newPassword: trimmed,
    }));
    await handleBulkUpdatePasswords(updates);
  };

  const filteredMovements = useMemo(() => {
    const list = analytics?.recentMovements || [];
    const q = movementSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) =>
        m.serialNo.toLowerCase().includes(q) ||
        m.modelName.toLowerCase().includes(q) ||
        m.branchName.toLowerCase().includes(q) ||
        (m.partner && m.partner.toLowerCase().includes(q)) ||
        (m.cause && m.cause.toLowerCase().includes(q)) ||
        m.date.toLowerCase().includes(q)
    );
  }, [analytics?.recentMovements, movementSearch]);

  const filteredAuditLogs = useMemo(() => {
    const list = analytics?.auditLogs || [];
    const q = auditFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        JSON.stringify(l.details || '').toLowerCase().includes(q)
    );
  }, [analytics?.auditLogs, auditFilter]);

  if (!isOpen) return null;

  const isAuthenticated = Boolean(adminToken);
  const needsFirstRunClaim = Boolean(
    adminStatus && adminStatus.success && !adminStatus.configuredViaEnv && !adminStatus.claimed
  );

  const tabItems: Array<{ id: AdminTabId; label: string; icon: React.ReactNode }> = [
    { id: 'analytics', label: 'Data Analysis', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'exports', label: 'Excel & Exports', icon: <FileSpreadsheet className="w-4 h-4" /> },
    { id: 'backend', label: 'Backend Data', icon: <Database className="w-4 h-4" /> },
    { id: 'backups', label: 'Backups & Audit', icon: <Cloud className="w-4 h-4" /> },
    { id: 'passwords', label: 'Password Manager', icon: <KeyRound className="w-4 h-4" /> },
    { id: 'security', label: 'Factory Reset & Access', icon: <RotateCcw className="w-4 h-4" /> },
  ];

  const activeTabLabel = tabItems.find((t) => t.id === activeTab)?.label || 'Data Analysis';
  const maxDailyVolume = Math.max(
    1,
    ...(analytics?.dailyTrend || []).map((d) => Math.max(d.totalIn, d.totalOut))
  );

  return (
    <div
      className={
        isAuthenticated
          ? 'fixed inset-0 z-50 flex bg-slate-50 overflow-hidden'
          : 'fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-5 bg-slate-950/75 backdrop-blur-xs overflow-y-auto'
      }
    >
      {!isAuthenticated ? (
        /* ===============================================================
           ADMIN LOGIN / FIRST-RUN SETUP VIEW
           =============================================================== */
        <div className="bg-white rounded-xl border border-slate-300 shadow-2xl w-full max-w-md overflow-hidden my-auto">
          <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold tracking-tight">
                  {needsFirstRunClaim ? 'Admin Setup Required' : 'Admin Login'}
                </h2>
                <p className="text-[11px] text-slate-400">
                  Authorized Owner & Administrator Access
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white rounded-md cursor-pointer"
              aria-label="Close Admin Login"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4 text-xs">
            {promptReason && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-950 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Admin Permission Required</span>
                  <span className="text-amber-900">{promptReason}</span>
                </div>
              </div>
            )}

            {statusLoading && !adminStatus ? (
              <div className="py-8 text-center text-slate-500 space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-slate-400" />
                <div>Checking admin security configuration...</div>
              </div>
            ) : needsFirstRunClaim ? (
              <form onSubmit={handleFirstRunClaim} className="space-y-3.5">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 leading-relaxed">
                  No admin password is configured yet. Create your Admin password now to lock Factory Reset, Excel downloads, and Backend Data Analysis. You can also set{' '}
                  <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200 text-slate-900">
                    ADMIN_PASSCODE
                  </code>{' '}
                  in Secrets to override it at any time.
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Administrator Label
                  </label>
                  <input
                    type="text"
                    value={adminLabelInput}
                    onChange={(e) => setAdminLabelInput(e.target.value)}
                    placeholder="Piyush Shivhare (Owner & Admin)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Create Admin Password (min 8 characters)
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter strong admin password"
                      autoFocus
                      className="w-full pl-3 pr-9 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Confirm Admin Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                {authError && (
                  <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-medium">
                    {authError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3.5 py-2 text-slate-600 hover:text-slate-900 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{authSubmitting ? 'Saving...' : 'Set Password & Sign In'}</span>
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-3.5">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
                  Sign in as <strong className="text-slate-900">{adminStatus?.adminLabel || 'Owner & Admin'}</strong> to access Factory Reset, Excel downloads, Backend Data Analysis, and Cloud Backups.
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Admin Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (authError) setAuthError(null);
                      }}
                      placeholder="Enter admin password"
                      autoComplete="current-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoFocus
                      className="w-full pl-3 pr-9 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {authError && (
                  <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-medium">
                    {authError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3.5 py-2 text-slate-600 hover:text-slate-900 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    <span>{authSubmitting ? 'Verifying...' : 'Sign In as Admin'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : (
        /* ===============================================================
           AUTHENTICATED ADMIN CONSOLE (SAAS WORKSPACE ARCHITECTURE)
           =============================================================== */
        <div className="bg-slate-50 w-full h-full flex flex-col overflow-hidden">
          {/* Top Bar Contract */}
          <div className="px-5 py-3.5 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 text-xs min-w-0">
              <div className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-1.5 truncate">
                <span className="font-bold text-slate-900">Admin Console</span>
                <span className="text-slate-400">/</span>
                <span className="font-semibold text-slate-600 truncate">{activeTabLabel}</span>
                <span className="hidden sm:inline text-slate-300 mx-1">·</span>
                <span className="hidden sm:inline text-slate-500 truncate">
                  {adminSession?.label || 'Owner & Admin'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => adminToken && loadAnalyticsAndBackups(adminToken)}
                disabled={analyticsLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${analyticsLoading ? 'animate-spin' : ''}`} />
                <span>Refresh Analysis</span>
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
                aria-label="Close Admin Console"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Mobile Tabs */}
          <div className="lg:hidden flex items-center gap-1 px-4 py-2 bg-white border-b border-slate-200 overflow-x-auto shrink-0">
            {tabItems.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Body: Sidebar + Main Viewport */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Desktop Sidebar (240px) */}
            <aside className="hidden lg:flex flex-col w-60 bg-white border-r border-slate-200 p-3 justify-between shrink-0">
              <div className="space-y-1">
                <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Operations & Control
                </div>
                {tabItems.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer text-left ${
                      activeTab === tab.id
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Sidebar Status Summary */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-[11px]">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-slate-600" />
                  <span>Backend Engine</span>
                </div>
                <div className="text-slate-600 leading-snug">
                  {analytics?.dbStatus?.engine || 'Checking...'}
                </div>
                {analytics && (
                  <div className="pt-1 border-t border-slate-200 space-y-1 font-mono tabular-nums text-slate-700">
                    <div className="flex justify-between">
                      <span>Ledgers</span>
                      <span className="font-bold">{analytics.overview.totalLedgers}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Serials</span>
                      <span className="font-bold">{analytics.overview.totalTrackedSerials}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>IST Date</span>
                      <span className="font-bold">{analytics.todayIST}</span>
                    </div>
                  </div>
                )}
              </div>
            </aside>

            {/* Main Scrollable Viewport */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {actionMessage && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                    actionMessage.type === 'ok'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <span className="font-semibold">{actionMessage.text}</span>
                  <button
                    type="button"
                    onClick={() => setActionMessage(null)}
                    className="text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {analyticsError && (
                <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-900 text-xs flex items-center justify-between">
                  <span>{analyticsError}</span>
                  <button
                    type="button"
                    onClick={() => adminToken && loadAnalyticsAndBackups(adminToken)}
                    className="px-2.5 py-1 bg-white border border-rose-300 rounded font-semibold cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* =========================================================
                  TAB 1: PROPER BACKEND DATA ANALYSIS
                 ========================================================= */}
              {activeTab === 'analytics' && (
                <div className="space-y-5">
                  {analyticsLoading && !analytics ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                      {Array.from({ length: 6 }).map((_, idx) => (
                        <div
                          key={idx}
                          className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse"
                        />
                      ))}
                    </div>
                  ) : analytics ? (
                    <>
                      {/* KPI Strip */}
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
                            All-Branch Closing
                          </span>
                          <span className="text-2xl font-extrabold text-slate-900 tabular-nums font-mono mt-1 block">
                            {analytics.overview.totalGrandBatteryClosing}
                          </span>
                          <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">
                            Std {analytics.overview.totalStandardClosing} · Rep{' '}
                            {analytics.overview.totalRepairClosing} · Svc{' '}
                            {analytics.overview.totalServiceClosing}
                          </span>
                        </div>

                        <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
                            Cumulative Inward
                          </span>
                          <span className="text-2xl font-extrabold text-emerald-700 tabular-nums font-mono mt-1 block">
                            +{analytics.overview.cumulativeInward}
                          </span>
                          <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">
                            Across {analytics.overview.totalLedgers} ledger days
                          </span>
                        </div>

                        <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
                            Cumulative Outward
                          </span>
                          <span className="text-2xl font-extrabold text-rose-700 tabular-nums font-mono mt-1 block">
                            -{analytics.overview.cumulativeOutward}
                          </span>
                          <span className="text-[11px] text-slate-500 mt-0.5 block">
                            Dispatches & sales
                          </span>
                        </div>

                        <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
                            Tracked Serials
                          </span>
                          <span className="text-2xl font-extrabold text-slate-900 tabular-nums font-mono mt-1 block">
                            {analytics.overview.totalTrackedSerials}
                          </span>
                          <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">
                            {analytics.overview.serialStatusCounts.in_stock} in stock ·{' '}
                            {analytics.overview.serialStatusCounts.dispatched} out
                          </span>
                        </div>

                        <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
                            Unserialized Gap
                          </span>
                          <span
                            className={`text-2xl font-extrabold tabular-nums font-mono mt-1 block ${
                              analytics.overview.totalUnserializedGap > 0
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            {analytics.overview.totalUnserializedGap}
                          </span>
                          <span className="text-[11px] text-slate-500 mt-0.5 block">
                            {analytics.overview.totalUnserializedGap === 0
                              ? '100% serialized'
                              : 'Units missing serials'}
                          </span>
                        </div>

                        <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
                            Chargers & Vehicles
                          </span>
                          <span className="text-2xl font-extrabold text-slate-900 tabular-nums font-mono mt-1 block">
                            {analytics.overview.totalChargerModelsLatest} /{' '}
                            {analytics.overview.totalVehicleModelsLatest}
                          </span>
                          <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">
                            {analytics.overview.transfersSummary.pendingUnits} transit units
                          </span>
                        </div>
                      </div>

                      {/* Quick Admin Actions Bar */}
                      <div className="bg-white border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-slate-600">
                          <strong className="text-slate-900">Quick Admin Actions:</strong>{' '}
                          Download verified Excel workbooks or trigger a cloud backup directly from backend data.
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleServerDownload('quantity')}
                            disabled={downloadingKey === 'quantity'}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>
                              {downloadingKey === 'quantity' ? 'Generating...' : 'Quantity Excel (.xlsx)'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleServerDownload('serials')}
                            disabled={downloadingKey === 'serials'}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded-lg cursor-pointer"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            <span>
                              {downloadingKey === 'serials'
                                ? 'Generating...'
                                : 'Serials & History Excel (.xlsx)'}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Branch-Wise Comparison Matrix */}
                      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                          <div>
                            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                              Branch-Wise Inventory Analysis (All 5 Locations)
                            </h3>
                            <p className="text-[11px] text-slate-500">
                              Latest closing balances, cumulative inward/outward throughput, serial coverage, and pending incoming transfers
                            </p>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                                <th className="py-2.5 px-3 text-left">Branch</th>
                                <th className="py-2.5 px-3 text-left">Latest Date</th>
                                <th className="py-2.5 px-3 text-right">Opening</th>
                                <th className="py-2.5 px-3 text-right">Latest IN</th>
                                <th className="py-2.5 px-3 text-right">Latest OUT</th>
                                <th className="py-2.5 px-3 text-right">Std Closing</th>
                                <th className="py-2.5 px-3 text-right">Repair</th>
                                <th className="py-2.5 px-3 text-right">Service</th>
                                <th className="py-2.5 px-3 text-right">Cum. IN / OUT</th>
                                <th className="py-2.5 px-3 text-right">Serials (Stock / Gap)</th>
                                <th className="py-2.5 px-3 text-right">Pending Rcv</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 tabular-nums">
                              {analytics.branchAnalytics.map((b) => (
                                <tr key={b.branchId} className="hover:bg-slate-50">
                                  <td className="py-2.5 px-3 font-semibold text-slate-900 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                      <span>{b.branchName}</span>
                                    </div>
                                    <span className="text-[10px] font-mono text-slate-400">
                                      {b.code} · {b.ledgerDaysCount} day(s)
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                                    {b.latestDate || '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                                    {b.latestOpening}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-emerald-700 font-semibold">
                                    +{b.latestIn}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-rose-700 font-semibold">
                                    {b.latestOut}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                    {b.latestClosing}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-amber-800">
                                    {b.latestRepairClosing}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-indigo-800">
                                    {b.latestServiceClosing}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-slate-700 whitespace-nowrap">
                                    <span className="text-emerald-700">+{b.cumulativeIn}</span>
                                    <span className="text-slate-300 mx-1">/</span>
                                    <span className="text-rose-700">-{b.cumulativeOut}</span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                                    <span className="text-slate-900 font-semibold">
                                      {b.serialsInStock}
                                    </span>
                                    <span className="text-slate-400 mx-1">/</span>
                                    <span
                                      className={
                                        b.unserializedGap > 0
                                          ? 'text-amber-700 font-bold'
                                          : 'text-emerald-700'
                                      }
                                    >
                                      {b.unserializedGap} gap
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                                    {b.incomingPendingUnits > 0 ? (
                                      <span className="text-amber-700 font-bold">
                                        {b.incomingPendingUnits} unit(s)
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">0</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Model / Batch Distribution & Gap Analysis */}
                      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-200">
                          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                            Battery Model Volume, Branch Split & Serial Gap Analysis
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            Model-wise stock distribution across all 5 branches, lifetime IN/OUT velocity, and serial coverage status
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                                <th className="py-2.5 px-3 text-left">Battery Model</th>
                                <th className="py-2.5 px-3 text-left">Health</th>
                                <th className="py-2.5 px-3 text-right">Total Closing</th>
                                {BRANCHES.map((b) => (
                                  <th key={b.id} className="py-2.5 px-2 text-right whitespace-nowrap">
                                    {b.code}
                                  </th>
                                ))}
                                <th className="py-2.5 px-3 text-right">Total IN</th>
                                <th className="py-2.5 px-3 text-right">Total OUT</th>
                                <th className="py-2.5 px-3 text-right">Tracked In Store</th>
                                <th className="py-2.5 px-3 text-right">Dispatched</th>
                                <th className="py-2.5 px-3 text-right">Missing Serials</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 tabular-nums">
                              {analytics.modelAnalytics.map((m) => (
                                <tr key={m.modelId} className="hover:bg-slate-50">
                                  <td className="py-2.5 px-3 font-semibold text-slate-900 whitespace-nowrap">
                                    {m.modelName}
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    {m.stockStatus === 'healthy' ? (
                                      <span className="text-emerald-700 font-semibold">● Healthy</span>
                                    ) : m.stockStatus === 'low' ? (
                                      <span className="text-amber-700 font-semibold">● Low Stock</span>
                                    ) : (
                                      <span className="text-rose-700 font-semibold">● Empty</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                    {m.currentClosingQty}
                                  </td>
                                  {BRANCHES.map((b) => (
                                    <td
                                      key={b.id}
                                      className="py-2.5 px-2 text-right font-mono text-slate-600"
                                    >
                                      {m.branchStockBreakdown[b.id] || 0}
                                    </td>
                                  ))}
                                  <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                                    +{m.cumulativeInQty}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-rose-700">
                                    -{m.cumulativeOutQty}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                                    {m.inStockSerials + m.inRepairSerials + m.serviceStandbySerials}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                                    {m.dispatchedSerials}
                                  </td>
                                  <td
                                    className={`py-2.5 px-3 text-right font-mono font-bold ${
                                      m.unserializedGap > 0 ? 'text-amber-700' : 'text-emerald-700'
                                    }`}
                                  >
                                    {m.unserializedGap}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Daily Trend & Top Dealers/Partners Grid */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Daily Activity Trend */}
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                          <div className="px-4 py-3 border-b border-slate-200">
                            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                              Daily Movement Velocity (All Branches)
                            </h3>
                          </div>
                          {analytics.dailyTrend.length === 0 ? (
                            <div className="p-6 text-center text-xs text-slate-500">
                              No daily ledger activity recorded yet.
                            </div>
                          ) : (
                            <div className="p-4 space-y-2.5 max-h-80 overflow-y-auto">
                              {analytics.dailyTrend
                                .slice()
                                .reverse()
                                .map((day) => (
                                  <div key={day.date} className="space-y-1 text-xs">
                                    <div className="flex items-center justify-between font-mono tabular-nums">
                                      <span className="font-semibold text-slate-800">
                                        {day.date}
                                      </span>
                                      <span className="text-[11px] text-slate-600">
                                        <span className="text-emerald-700 font-semibold">
                                          +{day.totalIn} IN
                                        </span>
                                        <span className="text-slate-300 mx-1.5">·</span>
                                        <span className="text-rose-700 font-semibold">
                                          -{day.totalOut} OUT
                                        </span>
                                        <span className="text-slate-300 mx-1.5">·</span>
                                        <span className="text-slate-900 font-bold">
                                          Closing {day.closingBalance}
                                        </span>
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-1.5 h-2">
                                      <div className="bg-slate-100 rounded-xs overflow-hidden flex justify-end">
                                        <div
                                          className="bg-emerald-600 h-full"
                                          style={{
                                            width: `${Math.round((day.totalIn / maxDailyVolume) * 100)}%`,
                                          }}
                                        />
                                      </div>
                                      <div className="bg-slate-100 rounded-xs overflow-hidden">
                                        <div
                                          className="bg-rose-600 h-full"
                                          style={{
                                            width: `${Math.round((day.totalOut / maxDailyVolume) * 100)}%`,
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>

                        {/* Top Dealers / Customers / Vehicles */}
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                          <div className="px-4 py-3 border-b border-slate-200">
                            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                              Top Dealers, Partners & Customer Vehicles
                            </h3>
                          </div>
                          {analytics.topPartners.length === 0 ? (
                            <div className="p-6 text-center text-xs text-slate-500">
                              Partner breakdown will appear once serial IN/OUT movements include partner or vehicle names.
                            </div>
                          ) : (
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                                  <th className="py-2 px-3 text-left">Dealer / Partner / Vehicle</th>
                                  <th className="py-2 px-3 text-right">IN</th>
                                  <th className="py-2 px-3 text-right">OUT</th>
                                  <th className="py-2 px-3 text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 tabular-nums">
                                {analytics.topPartners.map((p) => (
                                  <tr key={p.name} className="hover:bg-slate-50">
                                    <td className="py-2 px-3 font-medium text-slate-900 truncate max-w-[200px]">
                                      {p.name}
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono text-emerald-700">
                                      {p.inCount}
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono text-rose-700">
                                      {p.outCount}
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                                      {p.totalMovements}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {/* =========================================================
                  TAB 2: ADMIN-ONLY EXCEL & BACKEND SNAPSHOT EXPORTS
                 ========================================================= */}
              {activeTab === 'exports' && (
                <div className="space-y-4">
                  <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Admin Excel Workbooks & Full Backend Exports
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        All Excel downloads and backend database snapshots require Admin authorization and are recorded in the server audit log.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 border border-slate-200 rounded-lg flex flex-col justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-slate-900">
                            1. Complete Multi-Branch Quantity Stock (.xlsx)
                          </div>
                          <p className="text-[11px] text-slate-600 mt-1">
                            Server-compiled Excel workbook across all 5 branches with Opening, Inward (+), Outward (-), Closing Stock, Repair, and Service Battery totals for every recorded day.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleServerDownload('quantity')}
                          disabled={downloadingKey === 'quantity'}
                          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>
                            {downloadingKey === 'quantity'
                              ? 'Generating Workbook...'
                              : 'Download Backend Quantity Excel (.xlsx)'}
                          </span>
                        </button>
                      </div>

                      <div className="p-4 border border-slate-200 rounded-lg flex flex-col justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-slate-900">
                            2. Complete Serials & Movement History (.xlsx)
                          </div>
                          <p className="text-[11px] text-slate-600 mt-1">
                            5-sheet master workbook: In_Stock_Serials, Dispatched_Out_Serials, All_Battery_Serials, Past_Movement_History, and Daily_Transactions_Ledger.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleServerDownload('serials')}
                          disabled={downloadingKey === 'serials'}
                          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>
                            {downloadingKey === 'serials'
                              ? 'Generating Workbook...'
                              : 'Download Backend Serials & History (.xlsx)'}
                          </span>
                        </button>
                      </div>

                      <div className="p-4 border border-slate-200 rounded-lg flex flex-col justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-slate-900">
                            3. Active Branch Instant Sheet ({currentRecord.date})
                          </div>
                          <p className="text-[11px] text-slate-600 mt-1">
                            Exports the currently selected day sheet ({currentRecord.date}) and active branch serial history directly from live memory.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              exportRecordToExcel(currentRecord, columns);
                              onShowToast(`Downloaded Quantity Stock Excel (${currentRecord.date})`);
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Day Sheet .xlsx</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              exportSerialHistoryToExcel(
                                serials,
                                columns,
                                activeBranchId,
                                records,
                                transfers
                              );
                              onShowToast('Downloaded Serials & Movement History Excel (.xlsx)');
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            <span>Branch Serials .xlsx</span>
                          </button>
                        </div>
                      </div>

                      <div className="p-4 border border-slate-200 rounded-lg flex flex-col justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-slate-900">
                            4. Full Backend JSON Database Snapshot (.json)
                          </div>
                          <p className="text-[11px] text-slate-600 mt-1">
                            Raw portable JSON export of all records, serials, chargers, vehicles, transfers, columns, and team configuration.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleServerDownload('snapshot')}
                          disabled={downloadingKey === 'snapshot'}
                          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
                        >
                          <HardDrive className="w-3.5 h-3.5" />
                          <span>
                            {downloadingKey === 'snapshot'
                              ? 'Exporting JSON...'
                              : 'Download Full JSON Snapshot (.json)'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* =========================================================
                  TAB 3: BACKEND DATA EXPLORER (MOVEMENTS, TRANSFERS, SCHEMA)
                 ========================================================= */}
              {activeTab === 'backend' && analytics && (
                <div className="space-y-5">
                  {/* Backend Storage & Collection Counts */}
                  <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Backend Database Collections & Storage State
                      </h3>
                      <span className="text-[11px] font-mono text-slate-500">
                        Engine: {analytics.dbStatus?.engine}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs tabular-nums">
                      {[
                        { label: 'Day Ledgers', val: analytics.rawBackendSummary.recordsCount },
                        { label: 'Battery Serials', val: analytics.rawBackendSummary.serialsCount },
                        { label: 'Charger Sheets', val: analytics.rawBackendSummary.chargersCount },
                        { label: 'Vehicle Sheets', val: analytics.rawBackendSummary.vehiclesCount },
                        { label: 'Transfers', val: analytics.rawBackendSummary.transfersCount },
                        { label: 'Model Columns', val: analytics.rawBackendSummary.columnsCount },
                        { label: 'Cloud Backups', val: analytics.rawBackendSummary.cloudinaryBackupsCount },
                        {
                          label: 'Local Cache',
                          val: `${(analytics.rawBackendSummary.localDbBytes / 1024).toFixed(1)} KB`,
                        },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                        >
                          <span className="text-[10px] text-slate-500 block">{stat.label}</span>
                          <span className="font-mono font-bold text-slate-900 text-sm">
                            {stat.val}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent Serial Movements Table */}
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          Backend Serial Movement History ({filteredMovements.length})
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Every tracked serial movement stored in the backend across all branches
                        </p>
                      </div>
                      <div className="relative w-full sm:w-64">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                        <input
                          type="text"
                          value={movementSearch}
                          onChange={(e) => setMovementSearch(e.target.value)}
                          placeholder="Filter serial, model, partner..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 font-mono"
                        />
                      </div>
                    </div>

                    {filteredMovements.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        No serial movements match your filter.
                      </div>
                    ) : (
                      <div className="overflow-x-auto max-h-80">
                        <table className="w-full text-xs border-collapse">
                          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                            <tr>
                              <th className="py-2 px-3 text-left">Date</th>
                              <th className="py-2 px-3 text-left">Serial No.</th>
                              <th className="py-2 px-3 text-left">Model</th>
                              <th className="py-2 px-3 text-left">Type</th>
                              <th className="py-2 px-3 text-left">Branch</th>
                              <th className="py-2 px-3 text-left">Partner / Vehicle</th>
                              <th className="py-2 px-3 text-left">Cause</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 tabular-nums">
                            {filteredMovements.map((m, idx) => (
                              <tr key={`${m.serialNo}_${idx}`} className="hover:bg-slate-50">
                                <td className="py-2 px-3 font-mono text-slate-700 whitespace-nowrap">
                                  {m.date}
                                </td>
                                <td className="py-2 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                                  {m.serialNo}
                                </td>
                                <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                                  {m.modelName}
                                </td>
                                <td className="py-2 px-3 whitespace-nowrap font-semibold">
                                  {m.type === 'in' ? (
                                    <span className="text-emerald-700 inline-flex items-center gap-0.5">
                                      <ArrowDownRight className="w-3 h-3" /> IN
                                    </span>
                                  ) : m.type === 'out' || m.type === 'repair_out' ? (
                                    <span className="text-rose-700 inline-flex items-center gap-0.5">
                                      <ArrowUpRight className="w-3 h-3" /> {m.type.toUpperCase()}
                                    </span>
                                  ) : (
                                    <span className="text-amber-700 uppercase">{m.type}</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                                  {m.branchName}
                                </td>
                                <td className="py-2 px-3 text-slate-800 max-w-[180px] truncate">
                                  {m.partner || '—'}
                                </td>
                                <td className="py-2 px-3 text-slate-600 max-w-[220px] truncate">
                                  {m.cause || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Inter-Branch Transfers Backend Ledger */}
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Inter-Branch Stock Transfers ({analytics.recentTransfers.length})
                      </h3>
                    </div>
                    {analytics.recentTransfers.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        No inter-branch transfers recorded yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto max-h-64">
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                            <tr>
                              <th className="py-2 px-3 text-left">Date</th>
                              <th className="py-2 px-3 text-left">From Branch</th>
                              <th className="py-2 px-3 text-left">To Branch</th>
                              <th className="py-2 px-3 text-left">Items</th>
                              <th className="py-2 px-3 text-left">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 tabular-nums">
                            {analytics.recentTransfers.map((t) => (
                              <tr key={t.id} className="hover:bg-slate-50">
                                <td className="py-2 px-3 font-mono text-slate-700 whitespace-nowrap">
                                  {t.date}
                                </td>
                                <td className="py-2 px-3 text-slate-800">{t.fromBranchName}</td>
                                <td className="py-2 px-3 text-slate-800">{t.toBranchName}</td>
                                <td className="py-2 px-3 text-slate-700">
                                  {(t.items || [])
                                    .map((it) => `${it.quantity}x ${it.modelName}`)
                                    .join(', ')}
                                </td>
                                <td className="py-2 px-3 font-semibold uppercase text-[11px]">
                                  {t.status === 'received' ? (
                                    <span className="text-emerald-700">Received</span>
                                  ) : t.status === 'partial' ? (
                                    <span className="text-amber-700">Partial</span>
                                  ) : (
                                    <span className="text-rose-700">Pending</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* =========================================================
                  TAB 4: CLOUD BACKUPS & SERVER AUDIT LOGS
                 ========================================================= */}
              {activeTab === 'backups' && (
                <div className="space-y-5">
                  <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          Cloudinary Cloud Space & Disk Snapshots ({backups.length})
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Trigger manual Excel + JSON backups or restore a historical database snapshot.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleTriggerBackup}
                        disabled={isBackingUp}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer shrink-0"
                      >
                        <Upload className={`w-3.5 h-3.5 ${isBackingUp ? 'animate-bounce' : ''}`} />
                        <span>{isBackingUp ? 'Backing up...' : 'Run Cloud Backup Now'}</span>
                      </button>
                    </div>

                    {confirmRestoreSnap && (
                      <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-bold text-amber-950 block">
                            Confirm Snapshot Restore: {confirmRestoreSnap.fileName}
                          </span>
                          <span className="text-amber-900">
                            Newer existing records are preserved while missing/older records from this snapshot are restored.
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmRestoreSnap(null)}
                            className="px-3 py-1.5 bg-white border border-slate-300 rounded font-semibold text-slate-700 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleConfirmRestore}
                            disabled={isRestoring}
                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold cursor-pointer"
                          >
                            {isRestoring ? 'Restoring...' : 'Confirm Restore'}
                          </button>
                        </div>
                      </div>
                    )}

                    {backupsLoading ? (
                      <div className="py-6 text-center text-xs text-slate-500">
                        Loading backup snapshots...
                      </div>
                    ) : backups.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-500">
                        No backup snapshots found yet. Click "Run Cloud Backup Now" to create one.
                      </div>
                    ) : (
                      <div className="overflow-x-auto max-h-64 border border-slate-200 rounded-lg">
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                            <tr>
                              <th className="py-2 px-3 text-left">File Name</th>
                              <th className="py-2 px-3 text-left">Location</th>
                              <th className="py-2 px-3 text-left">Created</th>
                              <th className="py-2 px-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 tabular-nums">
                            {backups.slice(0, 20).map((snap) => {
                              const isExcel =
                                snap.format === 'xlsx' || snap.fileName.endsWith('.xlsx');
                              return (
                                <tr key={snap.id} className="hover:bg-slate-50">
                                  <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                                    {snap.fileName}
                                  </td>
                                  <td className="py-2 px-3 text-slate-600">
                                    {snap.source === 'cloudinary' ? 'Cloudinary' : 'Server Disk'}
                                  </td>
                                  <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                                    {new Date(snap.createdAt).toLocaleString()}
                                  </td>
                                  <td className="py-2 px-3 text-right">
                                    {isExcel ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleServerDownload(
                                            snap.fileName.includes('serial')
                                              ? 'serials'
                                              : 'quantity'
                                          )
                                        }
                                        className="px-2.5 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded cursor-pointer"
                                      >
                                        Download .xlsx
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmRestoreSnap(snap)}
                                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded cursor-pointer"
                                      >
                                        Restore Snapshot
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Audit Logs Table */}
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                          <History className="w-3.5 h-3.5 text-slate-600" />
                          <span>Backend Audit Log ({filteredAuditLogs.length})</span>
                        </h3>
                      </div>
                      <input
                        type="text"
                        value={auditFilter}
                        onChange={(e) => setAuditFilter(e.target.value)}
                        placeholder="Filter action or detail..."
                        className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none w-full sm:w-60 font-mono"
                      />
                    </div>
                    {filteredAuditLogs.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        No audit log entries recorded yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto max-h-72">
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                            <tr>
                              <th className="py-2 px-3 text-left">Timestamp</th>
                              <th className="py-2 px-3 text-left">Action</th>
                              <th className="py-2 px-3 text-left">Details</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 tabular-nums">
                            {filteredAuditLogs.map((log, idx) => (
                              <tr key={`${log.id || idx}`} className="hover:bg-slate-50">
                                <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                                  {new Date(log.timestamp).toLocaleString()}
                                </td>
                                <td className="py-2 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                                  {log.action}
                                </td>
                                <td className="py-2 px-3 font-mono text-[11px] text-slate-600 max-w-md truncate">
                                  {log.details ? JSON.stringify(log.details) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* =========================================================
                  TAB 5: REAL-TIME PASSWORD MANAGER & GITHUB AUTO-SYNC
                 ========================================================= */}
              {activeTab === 'passwords' && (
                <div className="space-y-5 max-w-5xl">
                  {/* Live Sync & GitHub Codebase Status Banner */}
                  <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-900 text-amber-400 flex items-center justify-center shrink-0">
                          <KeyRound className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">
                            Branch & Master Login Password Manager
                          </h3>
                          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                            Rotate passwords for individual branches (<code className="font-mono bg-slate-100 px-1 rounded">c, m, y, s, v</code>) or the master account (<code className="font-mono bg-slate-100 px-1 rounded">administrator</code>). Changes take effect immediately, wipe previous password hashes, invalidate old branch sessions, and commit <code className="font-mono bg-slate-100 px-1 rounded">data/branch-credentials.json</code> to GitHub.
                          </p>
                        </div>
                      </div>

                      <div
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold shrink-0 ${
                          githubStatus?.configured
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-amber-50 border-amber-200 text-amber-900'
                        }`}
                      >
                        <GitBranch className="w-3.5 h-3.5" />
                        <span>
                          {githubStatus?.configured
                            ? `GitHub Auto-Sync: ${githubStatus.repo} (${githubStatus.branch})`
                            : 'GitHub Auto-Sync: Add GITHUB_TOKEN & GITHUB_REPO'}
                        </span>
                      </div>
                    </div>

                    {lastGithubSync && (
                      <div
                        className={`p-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
                          lastGithubSync.synced
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                            : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}
                      >
                        <span>
                          <strong>GitHub Sync:</strong> {lastGithubSync.message}
                        </span>
                        {lastGithubSync.commitUrl && (
                          <a
                            href={lastGithubSync.commitUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-bold text-blue-700 hover:underline"
                          >
                            <span>View Commit</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Quick Apply Same Password to All 6 Accounts */}
                  <form
                    onSubmit={handleApplyOnePasswordToAllAccounts}
                    className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3 text-xs"
                  >
                    <div className="flex-1">
                      <label className="block font-bold text-slate-800 mb-1">
                        Set One New Password Across All 6 Accounts ({branchCreds.length})
                      </label>
                      <input
                        type="password"
                        minLength={4}
                        value={masterBulkPwd}
                        onChange={(e) => setMasterBulkPwd(e.target.value)}
                        placeholder="Enter shared password (min 4 characters) to rotate all accounts at once"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={savingLoginId === '__ALL__' || masterBulkPwd.trim().length < 4}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg cursor-pointer shrink-0"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {savingLoginId === '__ALL__' ? 'Rotating All...' : 'Rotate All 6 Live'}
                      </span>
                    </button>
                  </form>

                  {/* Per-Account Credentials Table */}
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          Per-Branch & Master Credentials ({branchCreds.length})
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          Type a new password for any specific row and click Update Live, or enter multiple rows and click Update All Entered.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleBulkUpdatePasswords()}
                        disabled={savingLoginId === '__ALL__'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg cursor-pointer self-start sm:self-auto"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>
                          {savingLoginId === '__ALL__' ? 'Updating...' : 'Update All Entered'}
                        </span>
                      </button>
                    </div>

                    {credsLoading && branchCreds.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-500">
                        Loading login credentials...
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                              <th className="py-2.5 px-3 text-left">Login ID</th>
                              <th className="py-2.5 px-3 text-left">Access Scope</th>
                              <th className="py-2.5 px-3 text-left">Password State</th>
                              <th className="py-2.5 px-3 text-left min-w-[210px]">New Password</th>
                              <th className="py-2.5 px-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {branchCreds.map((cred) => {
                              const draftVal = pwdDrafts[cred.loginId] || '';
                              const isVis = Boolean(pwdVisibleMap[cred.loginId]);
                              const isSavingThis =
                                savingLoginId === cred.loginId || savingLoginId === '__ALL__';
                              return (
                                <tr key={cred.loginId} className="hover:bg-slate-50">
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <span
                                      className={`inline-flex items-center px-2.5 py-1 rounded-md font-mono font-extrabold text-xs ${
                                        cred.role === 'master'
                                          ? 'bg-slate-900 text-amber-300'
                                          : 'bg-blue-50 text-blue-900 border border-blue-200'
                                      }`}
                                    >
                                      {cred.loginId}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold text-slate-900">
                                    <div>{cred.label}</div>
                                    <div className="text-[10px] font-normal text-slate-500">
                                      {cred.role === 'master'
                                        ? 'Unrestricted access to all 5 branches'
                                        : `Locked strictly to ${cred.allowedBranchIds.join(', ')}`}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                          cred.isCustomPassword
                                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                            : 'bg-amber-100 text-amber-900 border border-amber-200'
                                        }`}
                                      >
                                        {cred.isCustomPassword ? 'Rotated / Custom' : 'Initial Setup'}
                                      </span>
                                      <span className="font-mono text-[10px] text-slate-500">
                                        v{cred.version}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                      {new Date(cred.updatedAt).toLocaleString()}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="relative">
                                      <input
                                        type={isVis ? 'text' : 'password'}
                                        value={draftVal}
                                        minLength={4}
                                        onChange={(e) =>
                                          setPwdDrafts((prev) => ({
                                            ...prev,
                                            [cred.loginId]: e.target.value,
                                          }))
                                        }
                                        placeholder="New password (min 4 chars)"
                                        autoComplete="new-password"
                                        className="w-full pl-2.5 pr-8 py-1.5 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPwdVisibleMap((prev) => ({
                                            ...prev,
                                            [cred.loginId]: !prev[cred.loginId],
                                          }))
                                        }
                                        className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                                      >
                                        {isVis ? (
                                          <EyeOff className="w-3.5 h-3.5" />
                                        ) : (
                                          <Eye className="w-3.5 h-3.5" />
                                        )}
                                      </button>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateSingleBranchPassword(cred.loginId)}
                                      disabled={isSavingThis || draftVal.trim().length < 4}
                                      className="px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg cursor-pointer"
                                    >
                                      {savingLoginId === cred.loginId ? 'Saving...' : 'Update Live'}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* =========================================================
                  TAB 6: FACTORY RESET & ADMIN SECURITY
                 ========================================================= */}
              {activeTab === 'security' && (
                <div className="space-y-5 max-w-2xl">
                  {/* Factory Reset Card */}
                  <div className="bg-white border border-rose-300 rounded-lg p-5 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-rose-950">
                          Factory Reset All Data & History
                        </h3>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                          Permanently clears all battery, charger, and vehicle stock ledgers, serial history, inter-branch transfers, audit logs, and Cloudinary/disk backup archives, initializing a clean zero baseline starting today ({analytics?.todayIST || 'IST'}). Your Admin password is preserved.
                        </p>
                      </div>
                    </div>

                    <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-lg space-y-3 text-xs">
                      <label className="block font-semibold text-rose-950">
                        Type <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-rose-200">RESET</code> to confirm Factory Reset:
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={resetConfirmText}
                          onChange={(e) => setResetConfirmText(e.target.value)}
                          placeholder="Type RESET"
                          className="flex-1 px-3 py-2 border border-rose-300 rounded-lg bg-white font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-600"
                        />
                        <button
                          type="button"
                          onClick={handleConfirmFactoryReset}
                          disabled={
                            isResetting || resetConfirmText.trim().toUpperCase() !== 'RESET'
                          }
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-45 rounded-lg cursor-pointer shrink-0"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
                          <span>{isResetting ? 'Resetting...' : 'Execute Factory Reset'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Change Admin Password (only if claimed mode, not env var override) */}
                  <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900">Admin Credentials</h3>
                      <span className="font-mono text-[11px] text-slate-500">
                        Mode: {adminSession?.mode === 'env' ? 'Environment Secret (ADMIN_PASSCODE)' : 'Database Scrypt Hash'}
                      </span>
                    </div>

                    {adminSession?.mode === 'env' ? (
                      <p className="text-slate-600 leading-relaxed">
                        Admin authentication is currently controlled by the{' '}
                        <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">ADMIN_PASSCODE</code>{' '}
                        environment secret. Update that secret in Settings to change your passcode.
                      </p>
                    ) : (
                      <form onSubmit={handleChangePassword} className="space-y-3">
                        <div>
                          <label className="block font-semibold text-slate-700 mb-1">
                            Current Password
                          </label>
                          <input
                            type="password"
                            required
                            value={curPwd}
                            onChange={(e) => setCurPwd(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block font-semibold text-slate-700 mb-1">
                              New Password (min 8 chars)
                            </label>
                            <input
                              type="password"
                              required
                              minLength={8}
                              value={newPwd}
                              onChange={(e) => setNewPwd(e.target.value)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                            />
                          </div>
                          <div>
                            <label className="block font-semibold text-slate-700 mb-1">
                              Confirm New Password
                            </label>
                            <input
                              type="password"
                              required
                              minLength={8}
                              value={confirmNewPwd}
                              onChange={(e) => setConfirmNewPwd(e.target.value)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                            />
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={pwdUpdating}
                          className="inline-flex items-center gap-1.5 px-4 py-2 font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{pwdUpdating ? 'Updating...' : 'Update Admin Password'}</span>
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

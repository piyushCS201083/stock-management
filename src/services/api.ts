import {
  BatteryColumn,
  BatterySerialItem,
  BranchTransfer,
  DayRecord,
  DEFAULT_BRANCH_ID,
  TeamMember,
  getBatteryRecordKey,
} from '../types/stock';
import {
  loadRecords as loadLocalRecords,
  saveRecords as saveLocalRecords,
  loadColumns as loadLocalColumns,
  saveColumns as saveLocalColumns,
  loadTeamMembers as loadLocalTeamMembers,
  saveTeamMembers as saveLocalTeamMembers,
  mergeRecordsByTimestamp,
  mergeSerialsByHistory,
  getLocalResetEpoch,
  clearAllLocalStockStorage,
} from '../utils/storage';

export const DEFAULT_RENDER_BACKEND_URL = 'https://stock-management-hbuv.onrender.com';

// Get base URL from environment or custom runtime override (e.g. from user settings)
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isFullStackHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.run.app') ||
      host.endsWith('.onrender.com');

    const custom = localStorage.getItem('battery_custom_backend_url');
    if (custom && custom.trim()) {
      const cleaned = custom.trim().replace(/\/+$/, '');
      const isBrokenTarget =
        cleaned.includes('supabase.co') ||
        (window.location.protocol === 'https:' && cleaned.startsWith('http://localhost')) ||
        (isFullStackHost && cleaned === DEFAULT_RENDER_BACKEND_URL && !host.endsWith('.onrender.com'));
      if (isBrokenTarget) {
        localStorage.removeItem('battery_custom_backend_url');
      } else if (!isFullStackHost) {
        return cleaned;
      } else {
        // On full-stack hosts, only use custom URL if explicitly different and valid; otherwise prefer built-in
        localStorage.removeItem('battery_custom_backend_url');
      }
    }

    // Full-stack hosts (AI Studio Dev/Shared URL, localhost, Render) already serve /api/* on the same origin
    if (isFullStackHost) {
      return '';
    }
  }

  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  // When running on Vercel (or any production host where frontend is separated from backend)
  if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
    return DEFAULT_RENDER_BACKEND_URL;
  }
  // Default to relative /api when hosted together or in local dev proxy
  return '';
}

export function setCustomBackendUrl(url: string) {
  if (typeof window !== 'undefined') {
    if (url && url.trim()) {
      localStorage.setItem('battery_custom_backend_url', url.trim());
    } else {
      localStorage.removeItem('battery_custom_backend_url');
    }
  }
}

export interface CloudinaryStatusInfo {
  configured: boolean;
  cloudName?: string;
  folder?: string;
  lastBackupAt?: string;
  lastBackupUrl?: string;
  lastExcelUrl?: string;
  lastSerialExcelUrl?: string;
  lastBackupSource?: 'cloudinary' | 'local_disk';
  lastError?: string;
}

export interface BackendStatus {
  online: boolean;
  engine: string;
  url: string;
  storageLocation?: string;
  hasPostgresUrl?: boolean;
  supabaseConfigured?: boolean;
  supabaseReady?: boolean;
  supabaseNeedsSchema?: boolean;
  supabaseNeedsServiceKey?: boolean;
  supabaseUsingSecretKey?: boolean;
  supabaseJwksConfigured?: boolean;
  supabaseLastError?: string;
  supabaseProjectRef?: string;
  resetEpoch?: string;
  cloudinary?: CloudinaryStatusInfo;
  error?: string;
}

function mapHealthResponse(data: any, resolvedUrl: string): BackendStatus {
  return {
    online: true,
    engine: data.db?.engine || 'Cloud DBMS',
    url: resolvedUrl,
    storageLocation: data.db?.storageLocation,
    hasPostgresUrl: data.db?.hasPostgresUrl,
    supabaseConfigured: data.db?.supabaseConfigured,
    supabaseReady: data.db?.supabaseReady,
    supabaseNeedsSchema: data.db?.supabaseNeedsSchema,
    supabaseNeedsServiceKey: data.db?.supabaseNeedsServiceKey,
    supabaseUsingSecretKey: data.db?.supabaseUsingSecretKey,
    supabaseJwksConfigured: data.db?.supabaseJwksConfigured,
    supabaseLastError: data.db?.supabaseLastError,
    supabaseProjectRef: data.db?.supabaseProjectRef,
    resetEpoch: data.db?.resetEpoch,
    cloudinary: data.db?.cloudinary,
  };
}

export async function checkBackendHealth(): Promise<BackendStatus> {
  const base = getApiBaseUrl();
  const candidates = base ? [base, ''] : [''];
  let lastError = 'Cannot reach backend';
  let lastStatus: number | null = null;

  for (const candidateBase of candidates) {
    try {
      const res = await fetch(`${candidateBase}/api/health`, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        const data = await res.json();
        if (base && candidateBase === '' && typeof window !== 'undefined') {
          localStorage.removeItem('battery_custom_backend_url');
        }
        return mapHealthResponse(data, candidateBase || (typeof window !== 'undefined' ? window.location.origin : ''));
      }
      lastStatus = res.status;
      lastError = `Server status: ${res.status}`;
    } catch (err: any) {
      lastError = err?.message || 'Cannot reach backend';
    }
  }

  return {
    online: false,
    engine: lastStatus ? 'Disconnected' : 'Offline / Standalone Cache',
    url: base || (typeof window !== 'undefined' ? window.location.origin : ''),
    error: lastError,
  };
}

export async function retestBackendConnection(): Promise<BackendStatus> {
  const base = getApiBaseUrl();
  const candidates = base ? [base, ''] : [''];

  for (const candidateBase of candidates) {
    try {
      const res = await fetch(`${candidateBase}/api/db/test`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (base && candidateBase === '' && typeof window !== 'undefined') {
          localStorage.removeItem('battery_custom_backend_url');
        }
        return mapHealthResponse(data, candidateBase || (typeof window !== 'undefined' ? window.location.origin : ''));
      }
    } catch {
      // try next candidate or health fallback
    }
  }
  return checkBackendHealth();
}

const STORAGE_KEY_PENDING_SYNC = 'battery_pending_sync_keys_v1';

export function getPendingSyncKeys(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PENDING_SYNC);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {}
  return [];
}

function setPendingSyncKeys(keys: string[]) {
  try {
    const unique = Array.from(new Set(keys));
    localStorage.setItem(STORAGE_KEY_PENDING_SYNC, JSON.stringify(unique));
  } catch {}
}

export function addPendingSyncKey(key: string) {
  const current = getPendingSyncKeys();
  if (!current.includes(key)) {
    setPendingSyncKeys([...current, key]);
  }
}

export function removePendingSyncKey(key: string) {
  const current = getPendingSyncKeys();
  if (current.includes(key)) {
    setPendingSyncKeys(current.filter((k) => k !== key));
  }
}

// Fetch all records and merge safely with local cache by lastModified timestamp
export async function apiFetchRecords(protectedKeys?: Set<string>): Promise<Record<string, DayRecord>> {
  const base = getApiBaseUrl();
  const local = loadLocalRecords();
  try {
    const res = await fetch(`${base}/api/records`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        if (json.resetEpoch && getLocalResetEpoch() !== json.resetEpoch) {
          clearAllLocalStockStorage(json.resetEpoch);
          saveLocalRecords(json.data);
          return json.data;
        }
        const combinedProtected = new Set([
          ...getPendingSyncKeys(),
          ...(protectedKeys ? Array.from(protectedKeys) : []),
        ]);
        const { merged } = mergeRecordsByTimestamp(local, json.data, combinedProtected);
        saveLocalRecords(merged);
        return merged;
      }
    }
  } catch (err) {
    console.warn('[API] Could not fetch remote records, using local cache:', err);
  }
  return local;
}

export interface SaveRecordResponse {
  record: DayRecord;
  persistedToServer: boolean;
  persistedToRemote: boolean;
  storage?: string;
  error?: string;
}

// Save single day record to cloud database with explicit persistence metadata & retry queue
export async function apiSaveRecordWithMeta(record: DayRecord): Promise<SaveRecordResponse> {
  const key = getBatteryRecordKey(record.branchId, record.date);
  const recordWithBranch: DayRecord = {
    ...record,
    branchId: record.branchId || DEFAULT_BRANCH_ID,
    lastModified: record.lastModified || new Date().toISOString(),
  };

  // Persist locally & queue immediately so no edit can vanish during network/poll race
  const local = loadLocalRecords();
  local[key] = recordWithBranch;
  saveLocalRecords(local);
  addPendingSyncKey(key);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recordWithBranch),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        const persistedToRemote = Boolean(json.persistedToRemote);
        const isIntentionalLocalMode = json.storage === 'local_file';
        if (persistedToRemote || isIntentionalLocalMode) {
          removePendingSyncKey(key);
        }
        return {
          record: json.data,
          persistedToServer: true,
          persistedToRemote,
          storage: json.storage,
          error: json.remoteError,
        };
      }
      return {
        record: recordWithBranch,
        persistedToServer: false,
        persistedToRemote: false,
        error: json?.error || 'Server rejected save',
      };
    }
    return {
      record: recordWithBranch,
      persistedToServer: false,
      persistedToRemote: false,
      error: `HTTP ${res.status}`,
    };
  } catch (err: any) {
    console.warn('[API] Cloud save deferred, record queued locally:', err);
    return {
      record: recordWithBranch,
      persistedToServer: false,
      persistedToRemote: false,
      error: err?.message || 'Network unavailable',
    };
  }
}

// Save single day record to cloud database
export async function apiSaveRecord(record: DayRecord): Promise<DayRecord> {
  const res = await apiSaveRecordWithMeta(record);
  return res.record;
}

// Flush any locally queued/newer records back up to the server & Supabase
export async function flushPendingRecordsToServer(
  recordsSource?: Record<string, DayRecord>,
  extraKeysToPush?: string[]
): Promise<{ flushed: number; remaining: number }> {
  const local = recordsSource || loadLocalRecords();
  const keysToPush = Array.from(new Set([...getPendingSyncKeys(), ...(extraKeysToPush || [])]));
  if (keysToPush.length === 0) {
    return { flushed: 0, remaining: 0 };
  }

  let flushed = 0;
  for (const key of keysToPush) {
    const rec = local[key];
    if (!rec) {
      removePendingSyncKey(key);
      continue;
    }
    const res = await apiSaveRecordWithMeta(rec);
    if (res.persistedToServer && (res.persistedToRemote || res.storage === 'local_file')) {
      flushed++;
    }
  }

  return {
    flushed,
    remaining: getPendingSyncKeys().length,
  };
}

// Delete day record
export async function apiDeleteRecord(recordKey: string): Promise<boolean> {
  const local = loadLocalRecords();
  delete local[recordKey];
  saveLocalRecords(local);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/records/${encodeURIComponent(recordKey)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

// Fetch Columns
export async function apiFetchColumns(): Promise<BatteryColumn[]> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/columns`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        saveLocalColumns(json.data);
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Columns fetch failed, using local fallback:', err);
  }
  return loadLocalColumns();
}

// Save Columns
export async function apiSaveColumns(columns: BatteryColumn[]): Promise<BatteryColumn[]> {
  saveLocalColumns(columns);
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/columns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(columns),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) return json.data;
    }
  } catch (err) {
    console.warn('[API] Cloud columns save deferred:', err);
  }
  return columns;
}

// Fetch Team Members
export async function apiFetchTeam(): Promise<TeamMember[]> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/team`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        saveLocalTeamMembers(json.data);
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Team fetch failed, using local fallback:', err);
  }
  return loadLocalTeamMembers();
}

// Save Team Members
export async function apiSaveTeam(team: TeamMember[]): Promise<TeamMember[]> {
  saveLocalTeamMembers(team);
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(team),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) return json.data;
    }
  } catch (err) {
    console.warn('[API] Cloud team save deferred:', err);
  }
  return team;
}

// Log WhatsApp Dispatch to Cloud Audit Log
export async function apiLogWhatsAppDispatch(payload: {
  date: string;
  recipients: string[];
  message: string;
  imageDataUrl?: string;
}) {
  const base = getApiBaseUrl();
  try {
    await fetch(`${base}/api/whatsapp/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[API] WhatsApp log deferred:', err);
  }
}

// Local storage & pending-sync helpers for Serials
const STORAGE_KEY_SERIALS = 'battery_stock_serials_v3';
const STORAGE_KEY_PENDING_SERIAL_SYNC = 'battery_pending_serial_sync_keys_v1';

export function getPendingSerialSyncKeys(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PENDING_SERIAL_SYNC);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {}
  return [];
}

function setPendingSerialSyncKeys(keys: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY_PENDING_SERIAL_SYNC, JSON.stringify(Array.from(new Set(keys))));
  } catch {}
}

export function addPendingSerialSyncKey(serialNo: string) {
  const clean = serialNo.trim().toUpperCase();
  if (!clean) return;
  const current = getPendingSerialSyncKeys();
  if (!current.includes(clean)) {
    setPendingSerialSyncKeys([...current, clean]);
  }
}

export function removePendingSerialSyncKey(serialNo: string) {
  const clean = serialNo.trim().toUpperCase();
  const current = getPendingSerialSyncKeys();
  if (current.includes(clean)) {
    setPendingSerialSyncKeys(current.filter((k) => k !== clean));
  }
}

export function loadLocalSerials(): Record<string, BatterySerialItem> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SERIALS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load local serials', e);
  }
  return {};
}

export function saveLocalSerials(serials: Record<string, BatterySerialItem>) {
  try {
    localStorage.setItem(STORAGE_KEY_SERIALS, JSON.stringify(serials));
  } catch (e) {
    console.error('Failed to save local serials', e);
  }
}

// Fetch all serials safely merged with pending local edits
export async function apiFetchSerials(
  protectedKeys?: Set<string>
): Promise<Record<string, BatterySerialItem>> {
  const base = getApiBaseUrl();
  const local = loadLocalSerials();
  try {
    const res = await fetch(`${base}/api/serials`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        const combinedProtected = new Set([
          ...getPendingSerialSyncKeys(),
          ...(protectedKeys ? Array.from(protectedKeys) : []),
        ]);
        const { merged } = mergeSerialsByHistory(local, json.data, combinedProtected);
        saveLocalSerials(merged);
        return merged;
      }
    }
  } catch (err) {
    console.warn('[API] Serials fetch failed, using local cache:', err);
  }
  return local;
}

// Save single serial with pending-sync tracking
export async function apiSaveSerial(item: BatterySerialItem): Promise<BatterySerialItem> {
  const normalized: BatterySerialItem = {
    ...item,
    serialNo: item.serialNo.trim().toUpperCase(),
  };
  const local = loadLocalSerials();
  local[normalized.serialNo] = normalized;
  saveLocalSerials(local);
  addPendingSerialSyncKey(normalized.serialNo);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/serials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        removePendingSerialSyncKey(normalized.serialNo);
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Cloud save serial deferred:', err);
  }
  return normalized;
}

// Bulk save serials with pending-sync tracking
export async function apiBulkSaveSerials(items: BatterySerialItem[]): Promise<BatterySerialItem[]> {
  const normalizedItems = items.map((item) => ({
    ...item,
    serialNo: item.serialNo.trim().toUpperCase(),
  }));
  const local = loadLocalSerials();
  normalizedItems.forEach((item) => {
    local[item.serialNo] = item;
    addPendingSerialSyncKey(item.serialNo);
  });
  saveLocalSerials(local);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/serials/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedItems),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        normalizedItems.forEach((it) => removePendingSerialSyncKey(it.serialNo));
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Cloud bulk save serials deferred:', err);
  }
  return normalizedItems;
}

export async function flushPendingSerialsToServer(
  serialsMap: Record<string, BatterySerialItem>,
  explicitKeys?: string[]
): Promise<number> {
  const keysToFlush = Array.from(new Set([...(explicitKeys || []), ...getPendingSerialSyncKeys()]));
  const items = keysToFlush
    .map((k) => serialsMap[k])
    .filter((item): item is BatterySerialItem => Boolean(item && item.serialNo));

  if (items.length === 0) return 0;

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/serials/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success) {
        items.forEach((it) => removePendingSerialSyncKey(it.serialNo));
        return items.length;
      }
    }
  } catch (err) {
    console.warn('[API] Pending serial flush deferred:', err);
  }
  return 0;
}

export async function apiDeleteSerial(serialNo: string): Promise<boolean> {
  const clean = serialNo.trim().toUpperCase();
  if (!clean) return false;

  const local = loadLocalSerials();
  if (local[clean] || local[serialNo]) {
    delete local[clean];
    delete local[serialNo];
    saveLocalSerials(local);
  }
  removePendingSerialSyncKey(clean);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/serials/${encodeURIComponent(clean)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      const json = await res.json();
      return Boolean(json.success);
    }
  } catch (err) {
    console.warn('[API] Cloud delete serial failed:', err);
  }
  return false;
}

// Backup current state permanently to disk, Supabase, & Cloudinary Cloud Space
export async function apiBackupPermanentCodebase(
  records?: Record<string, DayRecord>,
  serials?: Record<string, BatterySerialItem>
): Promise<{
  success: boolean;
  cloudSpace?: {
    cloudinaryConfigured: boolean;
    uploadedToCloudinary: boolean;
    cloudName?: string;
    secureUrl?: string;
    latestUrl?: string;
    error?: string;
  };
}> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/backup-permanent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records, serials }),
    });
    if (res.ok) {
      return await res.json();
    }
    return { success: false };
  } catch (err) {
    console.warn('[API] Backup permanent codebase deferred:', err);
    return { success: false };
  }
}

export interface CloudBackupSnapshotMeta {
  id: string;
  publicId: string;
  fileName: string;
  format?: 'json' | 'xlsx';
  source: 'cloudinary' | 'local_disk';
  createdAt: string;
  bytes?: number;
  secureUrl?: string;
}

export async function apiGetCloudinaryStatus(): Promise<CloudinaryStatusInfo | null> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/cloud/cloudinary/status`, { cache: 'no-store' });
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return null;
}

function buildAdminHeaders(adminToken?: string | null, includeJson = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  if (adminToken) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }
  return headers;
}

export async function apiTriggerCloudinaryBackup(
  records?: Record<string, DayRecord>,
  serials?: Record<string, BatterySerialItem>,
  reason = 'manual_ui',
  adminToken?: string | null
): Promise<{
  success: boolean;
  cloudinaryConfigured: boolean;
  uploadedToCloudinary: boolean;
  uploadedExcelToCloudinary?: boolean;
  uploadedSerialExcelToCloudinary?: boolean;
  cloudName?: string;
  secureUrl?: string;
  latestUrl?: string;
  latestExcelUrl?: string;
  excelSecureUrl?: string;
  latestSerialExcelUrl?: string;
  serialExcelSecureUrl?: string;
  recordCount?: number;
  serialCount?: number;
  timestamp?: string;
  error?: string;
  unauthorized?: boolean;
}> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/cloud/cloudinary/backup`, {
      method: 'POST',
      headers: buildAdminHeaders(adminToken, true),
      body: JSON.stringify({ records, serials, reason }),
    });
    const json = await res.json();
    if (res.status === 401) {
      return {
        success: false,
        cloudinaryConfigured: false,
        uploadedToCloudinary: false,
        unauthorized: true,
        error: json?.error || 'Admin authentication required',
      };
    }
    return json;
  } catch (err: any) {
    return {
      success: false,
      cloudinaryConfigured: false,
      uploadedToCloudinary: false,
      error: err?.message || 'Backup request failed',
    };
  }
}

export async function apiListCloudinaryBackups(adminToken?: string | null): Promise<{
  cloudinaryConfigured: boolean;
  cloudName?: string;
  backups: CloudBackupSnapshotMeta[];
  error?: string;
  unauthorized?: boolean;
}> {
  const base = getApiBaseUrl();
  if (!adminToken) {
    return {
      cloudinaryConfigured: false,
      backups: [],
      unauthorized: true,
      error: 'Admin login required to view backups',
    };
  }
  try {
    const res = await fetch(`${base}/api/cloud/cloudinary/backups`, {
      cache: 'no-store',
      headers: buildAdminHeaders(adminToken),
    });
    if (res.status === 401) {
      return { cloudinaryConfigured: false, backups: [], unauthorized: true, error: 'Admin authentication required' };
    }
    if (res.ok) {
      return await res.json();
    }
  } catch (err: any) {
    return { cloudinaryConfigured: false, backups: [], error: err?.message };
  }
  return { cloudinaryConfigured: false, backups: [] };
}

export async function apiRestoreCloudinaryBackup(
  payload: {
    source: 'cloudinary' | 'local_disk';
    secureUrl?: string;
    fileName?: string;
  },
  adminToken?: string | null
): Promise<{
  success: boolean;
  restoredRecords?: number;
  restoredSerials?: number;
  error?: string;
  unauthorized?: boolean;
}> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/cloud/cloudinary/restore`, {
      method: 'POST',
      headers: buildAdminHeaders(adminToken, true),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (res.status === 401) {
      return { success: false, unauthorized: true, error: json?.error || 'Admin authentication required' };
    }
    return json;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Restore failed' };
  }
}

export async function apiFactoryReset(adminToken?: string | null): Promise<{
  success: boolean;
  resetEpoch?: string;
  todayIST?: string;
  branchesInitialized?: number;
  error?: string;
  unauthorized?: boolean;
}> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/system/factory-reset`, {
      method: 'POST',
      headers: buildAdminHeaders(adminToken, true),
    });
    const json = await res.json();
    if (res.status === 401) {
      return { success: false, unauthorized: true, error: json?.error || 'Admin authentication required' };
    }
    if (res.ok && json.success) {
      clearAllLocalStockStorage(json.resetEpoch);
    }
    return json;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Factory reset failed' };
  }
}

// =========================================================================
// Admin Authentication, Analytics & Privileged Downloads
// =========================================================================

export interface AdminSessionInfo {
  label: string;
  role: string;
  mode: 'env' | 'claimed';
  expiresAt?: string;
}

export interface AdminStatusResponse {
  success: boolean;
  configuredViaEnv: boolean;
  claimed: boolean;
  authenticated: boolean;
  admin: AdminSessionInfo | null;
  adminLabel: string;
}

export interface AdminAuthResult {
  success: boolean;
  token?: string;
  expiresAt?: string;
  admin?: AdminSessionInfo;
  needsClaim?: boolean;
  error?: string;
}

export interface BackendBranchAnalytic {
  branchId: string;
  branchNumber: number;
  branchName: string;
  shortName: string;
  code: string;
  ledgerDaysCount: number;
  firstDate: string | null;
  latestDate: string | null;
  lastModified: string | null;
  latestOpening: number;
  latestIn: number;
  latestOut: number;
  latestClosing: number;
  latestRepairClosing: number;
  latestServiceClosing: number;
  cumulativeIn: number;
  cumulativeOut: number;
  serialsInStock: number;
  serialsDispatched: number;
  serialsInRepair: number;
  serialsServiceStandby: number;
  serialsTotal: number;
  unserializedGap: number;
  incomingPendingTransfers: number;
  incomingPendingUnits: number;
  outgoingTransfersCount: number;
  chargerClosingTotal: number;
  vehicleClosingTotal: number;
}

export interface BackendModelAnalytic {
  modelId: string;
  modelName: string;
  isSpecial: boolean;
  currentClosingQty: number;
  cumulativeInQty: number;
  cumulativeOutQty: number;
  branchStockBreakdown: Record<string, number>;
  inStockSerials: number;
  dispatchedSerials: number;
  inRepairSerials: number;
  serviceStandbySerials: number;
  totalSerials: number;
  unserializedGap: number;
  stockStatus: 'healthy' | 'low' | 'empty';
}

export interface BackendAnalyticsSnapshot {
  generatedAt: string;
  todayIST: string;
  dbStatus: any;
  overview: {
    totalLedgers: number;
    activeBranchesWithData: number;
    totalStandardClosing: number;
    totalRepairClosing: number;
    totalServiceClosing: number;
    totalGrandBatteryClosing: number;
    cumulativeInward: number;
    cumulativeOutward: number;
    totalTrackedSerials: number;
    serialStatusCounts: {
      in_stock: number;
      dispatched: number;
      in_repair: number;
      service_standby: number;
    };
    totalUnserializedGap: number;
    totalChargerModelsLatest: number;
    totalVehicleModelsLatest: number;
    transfersSummary: {
      total: number;
      pending: number;
      partial: number;
      received: number;
      pendingUnits: number;
    };
    teamCount: number;
    auditLogCount: number;
  };
  branchAnalytics: BackendBranchAnalytic[];
  modelAnalytics: BackendModelAnalytic[];
  dailyTrend: Array<{
    date: string;
    isoDate: string;
    totalIn: number;
    totalOut: number;
    closingBalance: number;
    activeBranchesCount: number;
  }>;
  topPartners: Array<{
    name: string;
    inCount: number;
    outCount: number;
    totalMovements: number;
  }>;
  recentMovements: Array<{
    serialNo: string;
    modelName: string;
    type: string;
    date: string;
    branchId: string;
    branchName: string;
    partner?: string;
    cause?: string;
    timestamp: string;
  }>;
  recentTransfers: BranchTransfer[];
  auditLogs: Array<{
    id?: number | string;
    action: string;
    details?: any;
    timestamp: string;
  }>;
  rawBackendSummary: {
    recordsCount: number;
    serialsCount: number;
    chargersCount: number;
    vehiclesCount: number;
    transfersCount: number;
    columnsCount: number;
    teamMembersCount: number;
    localDbBytes: number;
    cloudinaryBackupsCount: number;
    columns: BatteryColumn[];
    teamMembers: TeamMember[];
  };
}

export async function apiGetAdminStatus(adminToken?: string | null): Promise<AdminStatusResponse> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/admin/status`, {
      cache: 'no-store',
      headers: buildAdminHeaders(adminToken),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return {
    success: false,
    configuredViaEnv: false,
    claimed: false,
    authenticated: false,
    admin: null,
    adminLabel: 'Owner & Admin',
  };
}

export async function apiClaimAdminPassword(
  password: string,
  adminLabel?: string
): Promise<AdminAuthResult> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/admin/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, adminLabel }),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err?.message || 'Admin setup request failed' };
  }
}

export async function apiAdminLogin(password: string): Promise<AdminAuthResult> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err?.message || 'Admin login request failed' };
  }
}

export async function apiAdminLogout(adminToken: string): Promise<void> {
  const base = getApiBaseUrl();
  try {
    await fetch(`${base}/api/admin/logout`, {
      method: 'POST',
      headers: buildAdminHeaders(adminToken),
    });
  } catch {}
}

export async function apiChangeAdminPassword(
  currentPassword: string,
  newPassword: string,
  adminToken: string
): Promise<{ success: boolean; error?: string }> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/admin/change-password`, {
      method: 'POST',
      headers: buildAdminHeaders(adminToken, true),
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err?.message || 'Password update failed' };
  }
}

export async function apiFetchAdminAnalytics(adminToken: string): Promise<{
  success: boolean;
  data?: BackendAnalyticsSnapshot;
  error?: string;
  unauthorized?: boolean;
}> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/admin/analytics`, {
      cache: 'no-store',
      headers: buildAdminHeaders(adminToken),
    });
    const json = await res.json();
    if (res.status === 401) {
      return { success: false, unauthorized: true, error: json?.error || 'Session expired' };
    }
    return json;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load backend analytics' };
  }
}

export async function apiDownloadAdminFile(
  kind: 'quantity' | 'serials' | 'snapshot',
  adminToken: string
): Promise<{ success: boolean; fileName?: string; error?: string; unauthorized?: boolean }> {
  const base = getApiBaseUrl();
  const endpointMap = {
    quantity: '/api/cloud/excel/export',
    serials: '/api/cloud/excel/serials/export',
    snapshot: '/api/cloud/snapshot/export',
  };
  const fallbackNameMap = {
    quantity: `Battery_Quantity_Stock_${new Date().toISOString().slice(0, 10)}.xlsx`,
    serials: `Battery_Serials_And_History_${new Date().toISOString().slice(0, 10)}.xlsx`,
    snapshot: `battery-stock-backup-${new Date().toISOString().slice(0, 10)}.json`,
  };

  try {
    const res = await fetch(`${base}${endpointMap[kind]}`, {
      method: 'GET',
      headers: buildAdminHeaders(adminToken),
    });
    if (res.status === 401) {
      return { success: false, unauthorized: true, error: 'Admin authentication required' };
    }
    if (!res.ok) {
      return { success: false, error: `Download failed (HTTP ${res.status})` };
    }
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const fileName = match?.[1] || fallbackNameMap[kind];

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return { success: true, fileName };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Download failed' };
  }
}

const STORAGE_KEY_CHARGERS = 'charger_stock_records_v1';

export function loadLocalChargers(): Record<string, any> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHARGERS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveLocalChargers(data: Record<string, any>) {
  try {
    localStorage.setItem(STORAGE_KEY_CHARGERS, JSON.stringify(data));
  } catch {}
}

export async function apiFetchChargers(): Promise<Record<string, any>> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/chargers`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        saveLocalChargers(json.data);
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Chargers fetch failed, using local cache:', err);
  }
  return loadLocalChargers();
}

export async function apiSaveChargerRecord(
  branchId: string,
  date: string,
  record: Record<string, any>
): Promise<any> {
  const compositeKey = `${branchId}::${date}`;
  const local = loadLocalChargers();
  const payload = {
    branchId,
    date,
    items: record,
    updatedAt: new Date().toISOString(),
  };
  local[compositeKey] = payload;
  saveLocalChargers(local);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/chargers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId, date, record }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) return json.data;
    }
  } catch (err) {
    console.warn('[API] Cloud charger save deferred:', err);
  }
  return { key: compositeKey, ...payload };
}

const STORAGE_KEY_VEHICLES = 'vehicle_stock_records_v1';

export function loadLocalVehicles(): Record<string, any> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VEHICLES);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveLocalVehicles(data: Record<string, any>) {
  try {
    localStorage.setItem(STORAGE_KEY_VEHICLES, JSON.stringify(data));
  } catch {}
}

export async function apiFetchVehicles(): Promise<Record<string, any>> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/vehicles`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        saveLocalVehicles(json.data);
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Vehicles fetch failed, using local cache:', err);
  }
  return loadLocalVehicles();
}

export async function apiSaveVehicleRecord(
  branchId: string,
  date: string,
  record: Record<string, any>
): Promise<any> {
  const compositeKey = `${branchId}::${date}`;
  const local = loadLocalVehicles();
  const payload = {
    branchId,
    date,
    items: record,
    updatedAt: new Date().toISOString(),
  };
  local[compositeKey] = payload;
  saveLocalVehicles(local);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId, date, record }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) return json.data;
    }
  } catch (err) {
    console.warn('[API] Cloud vehicle save deferred:', err);
  }
  return { key: compositeKey, ...payload };
}

// Inter-Branch Transfers API & Local Fallback
const STORAGE_KEY_TRANSFERS = 'battery_branch_transfers_v1';

export function loadLocalTransfers(): BranchTransfer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TRANSFERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {}
  return [];
}

export function saveLocalTransfers(transfers: BranchTransfer[]) {
  try {
    localStorage.setItem(STORAGE_KEY_TRANSFERS, JSON.stringify(transfers));
  } catch {}
}

export async function apiFetchTransfers(): Promise<BranchTransfer[]> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/transfers`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        saveLocalTransfers(json.data);
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Transfers fetch failed, using local cache:', err);
  }
  return loadLocalTransfers();
}

export async function apiCreateTransfer(payload: {
  fromBranchId: string;
  toBranchId: string;
  date: string;
  category?: 'battery' | 'charger';
  items: Array<{
    modelId: string;
    modelName: string;
    quantity: number;
    serialNos?: string[];
    notes?: string;
  }>;
  partner?: string;
  notes?: string;
}): Promise<{ created: BranchTransfer | null; transfers: BranchTransfer[] }> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.transfers)) {
        saveLocalTransfers(json.transfers);
        return { created: json.data || null, transfers: json.transfers };
      }
    }
  } catch (err) {
    console.warn('[API] Create branch transfer failed:', err);
  }
  return { created: null, transfers: loadLocalTransfers() };
}

export async function apiReceiveTransfers(
  selections: Array<{ transferId: string; itemIds?: string[] }>,
  receivedBy?: string
): Promise<BranchTransfer[]> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/transfers/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections, receivedBy }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        saveLocalTransfers(json.data);
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Receive transfers failed:', err);
  }
  return loadLocalTransfers();
}

// Real-Time Cloud Synchronization Callback Interface
export interface RealtimeSyncCallbacks {
  onRecordUpdated?: (record: DayRecord) => void;
  onRecordDeleted?: (date: string) => void;
  onSerialUpdated?: (serial: BatterySerialItem) => void;
  onSerialsBulkUpdated?: (serials: BatterySerialItem[]) => void;
  onSerialDeleted?: (serialNo: string) => void;
  onColumnsUpdated?: (columns: BatteryColumn[]) => void;
  onTeamUpdated?: (team: TeamMember[]) => void;
  onChargerUpdated?: (payload: { key: string; branchId: string; date: string; record: Record<string, any>; updatedAt: string }) => void;
  onVehicleUpdated?: (payload: { key: string; branchId: string; date: string; record: Record<string, any>; updatedAt: string }) => void;
  onTransfersUpdated?: (transfers: BranchTransfer[]) => void;
  onFactoryReset?: (payload: { resetEpoch?: string; todayIST?: string }) => void;
  onConnectionChange?: (connected: boolean) => void;
  onReconnected?: () => void;
}

// Subscribe to Real-Time Cloud Synchronization (SSE + BroadcastChannel)
export function subscribeRealtimeSync(callbacks: RealtimeSyncCallbacks): () => void {
  const base = getApiBaseUrl();
  let eventSource: EventSource | null = null;
  let isClosed = false;
  let reconnectTimeout: any = null;
  let hasOpenedOnce = false;

  // 1. Instant local cross-tab BroadcastChannel
  let channel: BroadcastChannel | null = null;
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      channel = new BroadcastChannel('stock_realtime_hub');
      channel.onmessage = (evt) => {
        const { event, payload } = evt.data || {};
        handleIncomingEvent(event, payload);
      };
    } catch {
      // BroadcastChannel not available
    }
  }

  function handleIncomingEvent(event: string, payload: any) {
    switch (event) {
      case 'RECORD_UPDATED':
        if (payload?.date) {
          const key = getBatteryRecordKey(payload.branchId, payload.date);
          if (getPendingSyncKeys().includes(key)) {
            break;
          }
          const local = loadLocalRecords();
          const existingLocal = local[key];
          const localTs = existingLocal?.lastModified ? Date.parse(existingLocal.lastModified) : 0;
          const incomingTs = payload.lastModified ? Date.parse(payload.lastModified) : 0;
          if (!existingLocal || incomingTs >= localTs) {
            local[key] = payload;
            saveLocalRecords(local);
            callbacks.onRecordUpdated?.(payload);
          }
        }
        break;
      case 'RECORD_DELETED':
        if (payload?.date) {
          const local = loadLocalRecords();
          delete local[payload.date];
          saveLocalRecords(local);
          callbacks.onRecordDeleted?.(payload.date);
        }
        break;
      case 'SERIAL_UPDATED':
        if (payload?.serialNo) {
          const local = loadLocalSerials();
          local[payload.serialNo] = payload;
          saveLocalSerials(local);
          callbacks.onSerialUpdated?.(payload);
        }
        break;
      case 'SERIALS_BULK_UPDATED':
        if (Array.isArray(payload)) {
          const local = loadLocalSerials();
          payload.forEach((s: BatterySerialItem) => {
            local[s.serialNo] = s;
          });
          saveLocalSerials(local);
          callbacks.onSerialsBulkUpdated?.(payload);
        }
        break;
      case 'SERIAL_DELETED':
        if (payload?.serialNo) {
          const local = loadLocalSerials();
          delete local[payload.serialNo];
          saveLocalSerials(local);
          callbacks.onSerialDeleted?.(payload.serialNo);
        }
        break;
      case 'COLUMNS_UPDATED':
        if (Array.isArray(payload)) {
          saveLocalColumns(payload);
          callbacks.onColumnsUpdated?.(payload);
        }
        break;
      case 'TEAM_UPDATED':
        if (Array.isArray(payload)) {
          saveLocalTeamMembers(payload);
          callbacks.onTeamUpdated?.(payload);
        }
        break;
      case 'CHARGER_UPDATED':
        if (payload?.key && payload?.record) {
          const local = loadLocalChargers();
          local[payload.key] = {
            branchId: payload.branchId,
            date: payload.date,
            items: payload.record,
            updatedAt: payload.updatedAt,
          };
          saveLocalChargers(local);
          callbacks.onChargerUpdated?.(payload);
        }
        break;
      case 'VEHICLE_UPDATED':
        if (payload?.key && payload?.record) {
          const local = loadLocalVehicles();
          local[payload.key] = {
            branchId: payload.branchId,
            date: payload.date,
            items: payload.record,
            updatedAt: payload.updatedAt,
          };
          saveLocalVehicles(local);
          callbacks.onVehicleUpdated?.(payload);
        }
        break;
      case 'TRANSFERS_UPDATED':
        if (Array.isArray(payload)) {
          saveLocalTransfers(payload);
          callbacks.onTransfersUpdated?.(payload);
        }
        break;
      case 'PERMANENT_SYNC_COMPLETE':
        // Full sync refreshed
        break;
      case 'FACTORY_RESET':
        clearAllLocalStockStorage(payload?.resetEpoch);
        callbacks.onFactoryReset?.(payload || {});
        break;
    }
  }

  // 2. Connect to Server-Sent Events stream from Cloud backend
  function connectSSE() {
    if (isClosed) return;
    try {
      const url = `${base}/api/realtime`;
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        callbacks.onConnectionChange?.(true);
        if (hasOpenedOnce) {
          callbacks.onReconnected?.();
        }
        hasOpenedOnce = true;
      };

      eventSource.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data);
          if (parsed && parsed.event) {
            handleIncomingEvent(parsed.event, parsed.payload);
            // Also mirror to other local tabs
            try {
              channel?.postMessage(parsed);
            } catch {}
          }
        } catch {
          // ignore heartbeats
        }
      };

      eventSource.onerror = () => {
        callbacks.onConnectionChange?.(false);
        eventSource?.close();
        if (!isClosed) {
          reconnectTimeout = setTimeout(connectSSE, 3000);
        }
      };
    } catch (e) {
      callbacks.onConnectionChange?.(false);
      if (!isClosed) {
        reconnectTimeout = setTimeout(connectSSE, 3000);
      }
    }
  }

  connectSSE();

  return () => {
    isClosed = true;
    clearTimeout(reconnectTimeout);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (channel) {
      channel.close();
      channel = null;
    }
  };
}

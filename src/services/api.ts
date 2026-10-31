import {
  BatteryColumn,
  BatterySerialItem,
  DayRecord,
  TeamMember,
  INITIAL_BASELINE_SERIALS,
} from '../types/stock';
import {
  loadRecords as loadLocalRecords,
  saveRecords as saveLocalRecords,
  loadColumns as loadLocalColumns,
  saveColumns as saveLocalColumns,
  loadTeamMembers as loadLocalTeamMembers,
  saveTeamMembers as saveLocalTeamMembers,
} from '../utils/storage';

export const DEFAULT_RENDER_BACKEND_URL = 'https://stock-management-hbuv.onrender.com';

// Get base URL from environment or custom runtime override (e.g. from user settings)
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('battery_custom_backend_url');
    if (custom && custom.trim()) {
      return custom.trim().replace(/\/+$/, '');
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

export interface BackendStatus {
  online: boolean;
  engine: string;
  url: string;
  storageLocation?: string;
  hasPostgresUrl?: boolean;
  error?: string;
}

export async function checkBackendHealth(): Promise<BackendStatus> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      return {
        online: true,
        engine: data.db?.engine || 'Cloud DBMS',
        url: base || window.location.origin,
        storageLocation: data.db?.storageLocation,
        hasPostgresUrl: data.db?.hasPostgresUrl,
      };
    }
    return {
      online: false,
      engine: 'Disconnected',
      url: base || window.location.origin,
      error: `Server status: ${res.status}`,
    };
  } catch (err: any) {
    return {
      online: false,
      engine: 'Offline / Standalone Cache',
      url: base || window.location.origin,
      error: err.message || 'Cannot reach backend',
    };
  }
}

// Fetch all records with local cache fallback
export async function apiFetchRecords(): Promise<Record<string, DayRecord>> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/records`);
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        saveLocalRecords(json.data); // Update local cache
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Could not fetch remote records, using local cache:', err);
  }
  return loadLocalRecords();
}

// Save single day record to cloud database
export async function apiSaveRecord(record: DayRecord): Promise<DayRecord> {
  // Update local cache optimistically
  const local = loadLocalRecords();
  local[record.date] = record;
  saveLocalRecords(local);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Cloud save deferred, record saved locally:', err);
  }
  return record;
}

// Delete day record
export async function apiDeleteRecord(date: string): Promise<boolean> {
  const local = loadLocalRecords();
  delete local[date];
  saveLocalRecords(local);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/records/${date}`, {
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
    const res = await fetch(`${base}/api/columns`);
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
    const res = await fetch(`${base}/api/team`);
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

// Local storage helpers for Serials
const STORAGE_KEY_SERIALS = 'battery_stock_serials_v3';

export function loadLocalSerials(): Record<string, BatterySerialItem> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SERIALS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Object.keys(parsed).length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load local serials', e);
  }
  // Default to verified 31-10-2026 baseline serials
  saveLocalSerials(INITIAL_BASELINE_SERIALS);
  return INITIAL_BASELINE_SERIALS;
}

export function saveLocalSerials(serials: Record<string, BatterySerialItem>) {
  try {
    localStorage.setItem(STORAGE_KEY_SERIALS, JSON.stringify(serials));
  } catch (e) {
    console.error('Failed to save local serials', e);
  }
}

// Fetch all serials
export async function apiFetchSerials(): Promise<Record<string, BatterySerialItem>> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/serials`);
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        saveLocalSerials(json.data);
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API] Serials fetch failed, using local cache:', err);
  }
  return loadLocalSerials();
}

// Save single serial
export async function apiSaveSerial(item: BatterySerialItem): Promise<BatterySerialItem> {
  const local = loadLocalSerials();
  local[item.serialNo] = item;
  saveLocalSerials(local);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/serials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) return json.data;
    }
  } catch (err) {
    console.warn('[API] Cloud save serial deferred:', err);
  }
  return item;
}

// Bulk save serials
export async function apiBulkSaveSerials(items: BatterySerialItem[]): Promise<BatterySerialItem[]> {
  const local = loadLocalSerials();
  items.forEach((item) => {
    local[item.serialNo] = item;
  });
  saveLocalSerials(local);

  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/serials/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) return json.data;
    }
  } catch (err) {
    console.warn('[API] Cloud bulk save serials deferred:', err);
  }
  return items;
}

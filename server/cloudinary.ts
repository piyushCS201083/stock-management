import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface CloudinaryConfig {
  configured: boolean;
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder: string;
}

export interface CloudBackupSnapshotMeta {
  id: string;
  publicId: string;
  fileName: string;
  source: 'cloudinary' | 'local_disk';
  createdAt: string;
  bytes?: number;
  secureUrl?: string;
}

export interface CloudinaryBackupResult {
  success: boolean;
  cloudinaryConfigured: boolean;
  uploadedToCloudinary: boolean;
  cloudName?: string;
  secureUrl?: string;
  latestUrl?: string;
  publicId?: string;
  localBackupPath: string;
  timestamp: string;
  error?: string;
}

const CLOUDINARY_FOLDER = 'stock-register-backups';
const LOCAL_BACKUP_DIR = path.resolve(process.cwd(), 'data', 'backups');

if (!fs.existsSync(LOCAL_BACKUP_DIR)) {
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
}

let lastBackupAt: string | null = null;
let lastBackupUrl: string | null = null;
let lastBackupError: string | null = null;
let lastBackupSource: 'cloudinary' | 'local_disk' | null = null;

function cleanEnvValue(raw?: string): string {
  if (!raw) return '';
  let val = raw.replace(/[\r\n\u200B-\u200D\uFEFF]+/g, '').trim();
  const stripQuotes = (s: string) =>
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('`') && s.endsWith('`'))
      ? s.slice(1, -1).trim()
      : s;
  val = stripQuotes(val);
  // Strip accidental "KEY_NAME=value" paste
  const eqMatch = val.match(/^[A-Z0-9_]+\s*[:=]\s*(.+)$/);
  if (eqMatch && eqMatch[1] && !val.startsWith('cloudinary://')) {
    val = eqMatch[1].trim();
  }
  return stripQuotes(val);
}

function isPlaceholder(val: string): boolean {
  if (!val) return true;
  const lower = val.toLowerCase();
  return (
    val.includes('<') ||
    val.includes('>') ||
    val.includes('•') ||
    val.includes('***') ||
    lower.includes('your_api_key') ||
    lower.includes('your_api_secret')
  );
}

export function getCloudinaryConfig(): CloudinaryConfig {
  let cloudName = cleanEnvValue(process.env.CLOUDINARY_CLOUD_NAME);
  let apiKey = cleanEnvValue(process.env.CLOUDINARY_API_KEY);
  let apiSecret = cleanEnvValue(process.env.CLOUDINARY_API_SECRET);
  const cloudinaryUrl = cleanEnvValue(process.env.CLOUDINARY_URL);

  if (cloudinaryUrl && cloudinaryUrl.startsWith('cloudinary://') && !isPlaceholder(cloudinaryUrl)) {
    try {
      const parsed = new URL(cloudinaryUrl);
      if (!cloudName && parsed.hostname) cloudName = decodeURIComponent(parsed.hostname);
      if (!apiKey && parsed.username) apiKey = decodeURIComponent(parsed.username);
      if (!apiSecret && parsed.password) apiSecret = decodeURIComponent(parsed.password);
    } catch {
      const m = cloudinaryUrl.match(/^cloudinary:\/\/([^:]+):([^@]+)@([^/?#]+)/);
      if (m) {
        if (!apiKey) apiKey = m[1];
        if (!apiSecret) apiSecret = m[2];
        if (!cloudName) cloudName = m[3];
      }
    }
  }

  const configured = Boolean(
    cloudName &&
      apiKey &&
      apiSecret &&
      !isPlaceholder(cloudName) &&
      !isPlaceholder(apiKey) &&
      !isPlaceholder(apiSecret)
  );

  return {
    configured,
    cloudName: configured ? cloudName : cloudName && !isPlaceholder(cloudName) ? cloudName : '',
    apiKey: configured ? apiKey : '',
    apiSecret: configured ? apiSecret : '',
    folder: CLOUDINARY_FOLDER,
  };
}

export function getCloudinaryStatus() {
  const cfg = getCloudinaryConfig();
  return {
    configured: cfg.configured,
    cloudName: cfg.cloudName || undefined,
    folder: cfg.folder,
    lastBackupAt: lastBackupAt || undefined,
    lastBackupUrl: lastBackupUrl || undefined,
    lastBackupSource: lastBackupSource || undefined,
    lastError: lastBackupError || undefined,
  };
}

function signCloudinaryParams(params: Record<string, string>, apiSecret: string): string {
  const sorted = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');

  return crypto.createHash('sha1').update(`${sorted}${apiSecret}`).digest('hex');
}

async function uploadRawToCloudinary(
  cfg: CloudinaryConfig,
  jsonContent: string,
  publicId: string,
  overwrite: boolean
): Promise<{ secure_url: string; public_id: string; bytes: number; created_at: string }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signParams: Record<string, string> = {
    invalidate: overwrite ? 'true' : 'false',
    overwrite: overwrite ? 'true' : 'false',
    public_id: publicId,
    timestamp,
  };
  const signature = signCloudinaryParams(signParams, cfg.apiSecret);

  const form = new FormData();
  const blob = new Blob([jsonContent], { type: 'application/json' });
  form.append('file', blob, path.basename(publicId));
  form.append('api_key', cfg.apiKey);
  form.append('timestamp', timestamp);
  form.append('public_id', publicId);
  form.append('overwrite', overwrite ? 'true' : 'false');
  form.append('invalidate', overwrite ? 'true' : 'false');
  form.append('signature', signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/raw/upload`;
  const res = await fetch(endpoint, {
    method: 'POST',
    body: form,
  });

  const bodyText = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // non-json response
  }

  if (!res.ok) {
    const errMsg = parsed?.error?.message || bodyText || `Cloudinary HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return parsed;
}

function writeLocalBackupSnapshot(jsonContent: string, timestampSlug: string): string {
  const latestPath = path.join(LOCAL_BACKUP_DIR, 'latest_snapshot.json');
  const historyPath = path.join(LOCAL_BACKUP_DIR, `snapshot_${timestampSlug}.json`);
  fs.writeFileSync(latestPath, jsonContent, 'utf-8');
  fs.writeFileSync(historyPath, jsonContent, 'utf-8');

  // Keep most recent 15 timestamped local snapshots to bound disk growth
  try {
    const files = fs
      .readdirSync(LOCAL_BACKUP_DIR)
      .filter((f) => f.startsWith('snapshot_') && f.endsWith('.json'))
      .sort()
      .reverse();
    files.slice(15).forEach((oldFile) => {
      try {
        fs.unlinkSync(path.join(LOCAL_BACKUP_DIR, oldFile));
      } catch {}
    });
  } catch {}

  return historyPath;
}

export async function uploadSnapshotToCloudSpace(snapshotPayload: any): Promise<CloudinaryBackupResult> {
  const now = new Date().toISOString();
  const timestampSlug = now.replace(/[:.]/g, '-');
  const jsonContent = JSON.stringify(snapshotPayload, null, 2);
  const localBackupPath = writeLocalBackupSnapshot(jsonContent, timestampSlug);

  const cfg = getCloudinaryConfig();
  if (!cfg.configured) {
    lastBackupAt = now;
    lastBackupSource = 'local_disk';
    lastBackupError = null;
    return {
      success: true,
      cloudinaryConfigured: false,
      uploadedToCloudinary: false,
      localBackupPath,
      timestamp: now,
    };
  }

  try {
    const versionedPublicId = `${cfg.folder}/snapshot_${timestampSlug}.json`;
    const latestPublicId = `${cfg.folder}/latest_snapshot.json`;

    const [versionedRes, latestRes] = await Promise.all([
      uploadRawToCloudinary(cfg, jsonContent, versionedPublicId, false),
      uploadRawToCloudinary(cfg, jsonContent, latestPublicId, true),
    ]);

    lastBackupAt = now;
    lastBackupUrl = latestRes.secure_url || versionedRes.secure_url;
    lastBackupSource = 'cloudinary';
    lastBackupError = null;

    return {
      success: true,
      cloudinaryConfigured: true,
      uploadedToCloudinary: true,
      cloudName: cfg.cloudName,
      secureUrl: versionedRes.secure_url,
      latestUrl: latestRes.secure_url,
      publicId: versionedRes.public_id,
      localBackupPath,
      timestamp: now,
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Cloudinary upload failed';
    lastBackupError = errMsg;
    lastBackupSource = 'local_disk';
    console.warn('[Cloudinary] Cloud Space upload failed (local disk snapshot preserved):', errMsg);
    return {
      success: false,
      cloudinaryConfigured: true,
      uploadedToCloudinary: false,
      cloudName: cfg.cloudName,
      localBackupPath,
      timestamp: now,
      error: errMsg,
    };
  }
}

export async function listCloudSpaceBackups(): Promise<{
  cloudinaryConfigured: boolean;
  cloudName?: string;
  backups: CloudBackupSnapshotMeta[];
  error?: string;
}> {
  const cfg = getCloudinaryConfig();
  const backups: CloudBackupSnapshotMeta[] = [];
  let cloudError: string | undefined;

  if (cfg.configured) {
    try {
      const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64');
      const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
        cfg.cloudName
      )}/resources/raw?type=upload&prefix=${encodeURIComponent(cfg.folder + '/')}&max_results=30`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });
      if (res.ok) {
        const json: any = await res.json();
        const resources = Array.isArray(json?.resources) ? json.resources : [];
        resources
          .sort((a: any, b: any) =>
            String(b.created_at || '').localeCompare(String(a.created_at || ''))
          )
          .forEach((r: any) => {
            backups.push({
              id: r.asset_id || r.public_id,
              publicId: r.public_id,
              fileName: path.basename(r.public_id || 'snapshot.json'),
              source: 'cloudinary',
              createdAt: r.created_at || new Date().toISOString(),
              bytes: r.bytes,
              secureUrl: r.secure_url,
            });
          });
      } else {
        const txt = await res.text();
        cloudError = `Cloudinary list HTTP ${res.status}: ${txt.slice(0, 140)}`;
      }
    } catch (err: any) {
      cloudError = err?.message || 'Failed to list Cloudinary snapshots';
    }
  }

  // Always include local disk backups too so offline/fallback snapshots are accessible
  try {
    const localFiles = fs
      .readdirSync(LOCAL_BACKUP_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 15);
    localFiles.forEach((file) => {
      const fullPath = path.join(LOCAL_BACKUP_DIR, file);
      const stat = fs.statSync(fullPath);
      backups.push({
        id: `local_${file}`,
        publicId: `local/${file}`,
        fileName: file,
        source: 'local_disk',
        createdAt: stat.mtime.toISOString(),
        bytes: stat.size,
      });
    });
  } catch {}

  return {
    cloudinaryConfigured: cfg.configured,
    cloudName: cfg.cloudName || undefined,
    backups,
    error: cloudError,
  };
}

export async function readCloudSpaceSnapshot(input: {
  source: 'cloudinary' | 'local_disk';
  secureUrl?: string;
  fileName?: string;
}): Promise<any> {
  if (input.source === 'local_disk') {
    const safeName = path.basename(String(input.fileName || 'latest_snapshot.json'));
    if (!safeName.endsWith('.json')) {
      throw new Error('Invalid snapshot filename');
    }
    const targetPath = path.join(LOCAL_BACKUP_DIR, safeName);
    if (!fs.existsSync(targetPath)) {
      throw new Error('Local backup snapshot not found');
    }
    const raw = fs.readFileSync(targetPath, 'utf-8');
    return JSON.parse(raw);
  }

  const cfg = getCloudinaryConfig();
  if (!cfg.configured) {
    throw new Error('Cloudinary is not configured in server environment');
  }

  const urlStr = String(input.secureUrl || '').trim();
  const allowedPrefix = `https://res.cloudinary.com/${cfg.cloudName}/`;
  if (!urlStr.startsWith(allowedPrefix)) {
    throw new Error('Invalid Cloudinary snapshot URL for configured cloud');
  }

  const res = await fetch(urlStr, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to download Cloudinary snapshot (HTTP ${res.status})`);
  }
  return res.json();
}

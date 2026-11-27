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
  format: 'json' | 'xlsx';
  source: 'cloudinary' | 'local_disk';
  createdAt: string;
  bytes?: number;
  secureUrl?: string;
}

export interface CloudinaryBackupResult {
  success: boolean;
  cloudinaryConfigured: boolean;
  uploadedToCloudinary: boolean;
  uploadedExcelToCloudinary: boolean;
  uploadedSerialExcelToCloudinary?: boolean;
  cloudName?: string;
  secureUrl?: string;
  latestUrl?: string;
  latestExcelUrl?: string;
  excelSecureUrl?: string;
  latestSerialExcelUrl?: string;
  serialExcelSecureUrl?: string;
  publicId?: string;
  localBackupPath: string;
  localExcelPath?: string;
  localSerialExcelPath?: string;
  timestamp: string;
  error?: string;
}

const CLOUDINARY_FOLDER = 'stock-register-backups';
const LOCAL_BACKUP_DIR = path.resolve(process.cwd(), 'data', 'backups');
const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

if (!fs.existsSync(LOCAL_BACKUP_DIR)) {
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
}

let lastBackupAt: string | null = null;
let lastBackupUrl: string | null = null;
let lastExcelUrl: string | null = null;
let lastSerialExcelUrl: string | null = null;
let lastBackupError: string | null = null;
let lastBackupSource: 'cloudinary' | 'local_disk' | null = null;
let lastVersionedArchiveMs = 0;

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
    lastExcelUrl: lastExcelUrl || undefined,
    lastSerialExcelUrl: lastSerialExcelUrl || undefined,
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
  content: string | Buffer,
  mimeType: string,
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
  const payloadBytes =
    typeof content === 'string' ? content : new Uint8Array(content);
  const blob = new Blob([payloadBytes], { type: mimeType });
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

function writeLocalBackupFiles(
  jsonContent: string,
  excelBuffer: Buffer | undefined,
  serialExcelBuffer: Buffer | undefined,
  timestampSlug: string,
  writeArchive: boolean
): { jsonPath: string; excelPath?: string; serialExcelPath?: string } {
  const latestJsonPath = path.join(LOCAL_BACKUP_DIR, 'latest_snapshot.json');
  fs.writeFileSync(latestJsonPath, jsonContent, 'utf-8');

  let jsonArchivePath = latestJsonPath;
  if (writeArchive) {
    jsonArchivePath = path.join(LOCAL_BACKUP_DIR, `snapshot_${timestampSlug}.json`);
    fs.writeFileSync(jsonArchivePath, jsonContent, 'utf-8');
  }

  let excelPath: string | undefined;
  if (excelBuffer && excelBuffer.length > 0) {
    const latestExcelPath = path.join(LOCAL_BACKUP_DIR, 'latest_stock_register.xlsx');
    fs.writeFileSync(latestExcelPath, excelBuffer);
    excelPath = latestExcelPath;
    if (writeArchive) {
      const archiveExcelPath = path.join(LOCAL_BACKUP_DIR, `stock_register_${timestampSlug}.xlsx`);
      fs.writeFileSync(archiveExcelPath, excelBuffer);
      excelPath = archiveExcelPath;
    }
  }

  let serialExcelPath: string | undefined;
  if (serialExcelBuffer && serialExcelBuffer.length > 0) {
    const latestSerialExcelPath = path.join(LOCAL_BACKUP_DIR, 'latest_serial_history.xlsx');
    fs.writeFileSync(latestSerialExcelPath, serialExcelBuffer);
    serialExcelPath = latestSerialExcelPath;
    if (writeArchive) {
      const archiveSerialExcelPath = path.join(LOCAL_BACKUP_DIR, `serial_history_${timestampSlug}.xlsx`);
      fs.writeFileSync(archiveSerialExcelPath, serialExcelBuffer);
      serialExcelPath = archiveSerialExcelPath;
    }
  }

  // Keep most recent 15 timestamped local archives per format
  try {
    const prunePrefix = (prefix: string, ext: string) => {
      const files = fs
        .readdirSync(LOCAL_BACKUP_DIR)
        .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
        .sort()
        .reverse();
      files.slice(15).forEach((oldFile) => {
        try {
          fs.unlinkSync(path.join(LOCAL_BACKUP_DIR, oldFile));
        } catch {}
      });
    };
    prunePrefix('snapshot_', '.json');
    prunePrefix('stock_register_', '.xlsx');
    prunePrefix('serial_history_', '.xlsx');
  } catch {}

  return { jsonPath: jsonArchivePath, excelPath, serialExcelPath };
}

export async function uploadSnapshotToCloudSpace(
  snapshotPayload: any,
  excelBuffer?: Buffer,
  options?: { archiveVersioned?: boolean; serialExcelBuffer?: Buffer }
): Promise<CloudinaryBackupResult> {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const timestampSlug = now.replace(/[:.]/g, '-');
  const jsonContent = JSON.stringify(snapshotPayload, null, 2);
  const serialExcelBuffer = options?.serialExcelBuffer;

  // Create versioned snapshot on explicit request or at most every 5 minutes automatically
  const shouldArchive =
    Boolean(options?.archiveVersioned) || nowMs - lastVersionedArchiveMs >= 5 * 60 * 1000;
  if (shouldArchive) {
    lastVersionedArchiveMs = nowMs;
  }

  const localFiles = writeLocalBackupFiles(
    jsonContent,
    excelBuffer,
    serialExcelBuffer,
    timestampSlug,
    shouldArchive
  );

  const cfg = getCloudinaryConfig();
  if (!cfg.configured) {
    lastBackupAt = now;
    lastBackupSource = 'local_disk';
    lastBackupError = null;
    return {
      success: true,
      cloudinaryConfigured: false,
      uploadedToCloudinary: false,
      uploadedExcelToCloudinary: false,
      uploadedSerialExcelToCloudinary: false,
      localBackupPath: localFiles.jsonPath,
      localExcelPath: localFiles.excelPath,
      localSerialExcelPath: localFiles.serialExcelPath,
      timestamp: now,
    };
  }

  try {
    const latestJsonId = `${cfg.folder}/latest_snapshot.json`;
    const uploads: Array<Promise<any>> = [
      uploadRawToCloudinary(cfg, jsonContent, 'application/json', latestJsonId, true),
    ];

    if (shouldArchive) {
      const versionedJsonId = `${cfg.folder}/snapshot_${timestampSlug}.json`;
      uploads.push(uploadRawToCloudinary(cfg, jsonContent, 'application/json', versionedJsonId, false));
    } else {
      uploads.push(Promise.resolve(null));
    }

    if (excelBuffer && excelBuffer.length > 0) {
      const latestExcelId = `${cfg.folder}/latest_stock_register.xlsx`;
      uploads.push(uploadRawToCloudinary(cfg, excelBuffer, EXCEL_MIME, latestExcelId, true));
      if (shouldArchive) {
        const versionedExcelId = `${cfg.folder}/stock_register_${timestampSlug}.xlsx`;
        uploads.push(uploadRawToCloudinary(cfg, excelBuffer, EXCEL_MIME, versionedExcelId, false));
      } else {
        uploads.push(Promise.resolve(null));
      }
    } else {
      uploads.push(Promise.resolve(null), Promise.resolve(null));
    }

    if (serialExcelBuffer && serialExcelBuffer.length > 0) {
      const latestSerialExcelId = `${cfg.folder}/latest_serial_history.xlsx`;
      uploads.push(uploadRawToCloudinary(cfg, serialExcelBuffer, EXCEL_MIME, latestSerialExcelId, true));
      if (shouldArchive) {
        const versionedSerialExcelId = `${cfg.folder}/serial_history_${timestampSlug}.xlsx`;
        uploads.push(
          uploadRawToCloudinary(cfg, serialExcelBuffer, EXCEL_MIME, versionedSerialExcelId, false)
        );
      } else {
        uploads.push(Promise.resolve(null));
      }
    } else {
      uploads.push(Promise.resolve(null), Promise.resolve(null));
    }

    const [
      latestJsonRes,
      versionedJsonRes,
      latestExcelRes,
      versionedExcelRes,
      latestSerialExcelRes,
      versionedSerialExcelRes,
    ] = await Promise.all(uploads);

    lastBackupAt = now;
    lastBackupUrl = latestJsonRes?.secure_url || versionedJsonRes?.secure_url || lastBackupUrl;
    lastExcelUrl = latestExcelRes?.secure_url || versionedExcelRes?.secure_url || lastExcelUrl;
    lastSerialExcelUrl =
      latestSerialExcelRes?.secure_url ||
      versionedSerialExcelRes?.secure_url ||
      lastSerialExcelUrl;
    lastBackupSource = 'cloudinary';
    lastBackupError = null;

    return {
      success: true,
      cloudinaryConfigured: true,
      uploadedToCloudinary: true,
      uploadedExcelToCloudinary: Boolean(latestExcelRes?.secure_url),
      uploadedSerialExcelToCloudinary: Boolean(latestSerialExcelRes?.secure_url),
      cloudName: cfg.cloudName,
      secureUrl: versionedJsonRes?.secure_url || latestJsonRes?.secure_url,
      latestUrl: latestJsonRes?.secure_url,
      latestExcelUrl: latestExcelRes?.secure_url,
      excelSecureUrl: versionedExcelRes?.secure_url || latestExcelRes?.secure_url,
      latestSerialExcelUrl: latestSerialExcelRes?.secure_url,
      serialExcelSecureUrl:
        versionedSerialExcelRes?.secure_url || latestSerialExcelRes?.secure_url,
      publicId: versionedJsonRes?.public_id || latestJsonRes?.public_id,
      localBackupPath: localFiles.jsonPath,
      localExcelPath: localFiles.excelPath,
      localSerialExcelPath: localFiles.serialExcelPath,
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
      uploadedExcelToCloudinary: false,
      uploadedSerialExcelToCloudinary: false,
      cloudName: cfg.cloudName,
      localBackupPath: localFiles.jsonPath,
      localExcelPath: localFiles.excelPath,
      localSerialExcelPath: localFiles.serialExcelPath,
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
      )}/resources/raw?type=upload&prefix=${encodeURIComponent(cfg.folder + '/')}&max_results=50`;

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
            const name = path.basename(r.public_id || 'snapshot.json');
            const format: 'json' | 'xlsx' = name.endsWith('.xlsx') ? 'xlsx' : 'json';
            if (name === 'latest_snapshot.json' && r.secure_url) {
              lastBackupUrl = r.secure_url;
            }
            if (name === 'latest_stock_register.xlsx' && r.secure_url) {
              lastExcelUrl = r.secure_url;
            }
            if (name === 'latest_serial_history.xlsx' && r.secure_url) {
              lastSerialExcelUrl = r.secure_url;
            }
            backups.push({
              id: r.asset_id || r.public_id,
              publicId: r.public_id,
              fileName: name,
              format,
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
      .filter((f) => f.endsWith('.json') || f.endsWith('.xlsx'))
      .sort()
      .reverse()
      .slice(0, 20);
    localFiles.forEach((file) => {
      const fullPath = path.join(LOCAL_BACKUP_DIR, file);
      const stat = fs.statSync(fullPath);
      const format: 'json' | 'xlsx' = file.endsWith('.xlsx') ? 'xlsx' : 'json';
      backups.push({
        id: `local_${file}`,
        publicId: `local/${file}`,
        fileName: file,
        format,
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
    const targetPath = path.resolve(LOCAL_BACKUP_DIR, safeName);
    if (!targetPath.startsWith(LOCAL_BACKUP_DIR + path.sep) || !fs.existsSync(targetPath)) {
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

export async function purgeAndResetCloudSpace(
  freshSnapshot: any,
  freshExcelBuffer?: Buffer,
  freshSerialExcelBuffer?: Buffer
): Promise<CloudinaryBackupResult> {
  // 1. Delete all old local disk backup files
  try {
    const files = fs.readdirSync(LOCAL_BACKUP_DIR);
    for (const file of files) {
      const fullPath = path.join(LOCAL_BACKUP_DIR, file);
      try {
        if (fs.statSync(fullPath).isFile()) {
          fs.unlinkSync(fullPath);
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[CloudSpace] Local backup cleanup warning:', err);
  }

  lastBackupUrl = null;
  lastExcelUrl = null;
  lastSerialExcelUrl = null;
  lastBackupError = null;
  lastVersionedArchiveMs = 0;

  // 2. Delete all existing raw backup files in Cloudinary folder
  const cfg = getCloudinaryConfig();
  if (cfg.configured) {
    try {
      const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64');
      let nextCursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const listUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
          cfg.cloudName
        )}/resources/raw?type=upload&prefix=${encodeURIComponent(cfg.folder + '/')}&max_results=100${
          nextCursor ? `&next_cursor=${encodeURIComponent(nextCursor)}` : ''
        }`;
        const listRes = await fetch(listUrl, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (!listRes.ok) break;
        const listJson: any = await listRes.json();
        const resources = Array.isArray(listJson?.resources) ? listJson.resources : [];
        if (resources.length === 0) break;

        const params = new URLSearchParams();
        resources.forEach((r: any) => {
          if (r?.public_id) params.append('public_ids[]', r.public_id);
        });
        await fetch(
          `https://api.cloudinary.com/v1_1/${encodeURIComponent(
            cfg.cloudName
          )}/resources/raw/upload?${params.toString()}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Basic ${auth}` },
          }
        );

        nextCursor = listJson?.next_cursor;
        if (!nextCursor) break;
      }
    } catch (err: any) {
      console.warn('[Cloudinary] Cleanup warning during factory reset:', err?.message || err);
    }
  }

  // 3. Upload clean fresh empty snapshot & Excels
  return uploadSnapshotToCloudSpace(freshSnapshot, freshExcelBuffer, {
    archiveVersioned: false,
    serialExcelBuffer: freshSerialExcelBuffer,
  });
}

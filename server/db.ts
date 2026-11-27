import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  resolveEnv as resolveSupabaseServerEnv,
  createAdminClient as createSupabaseAdminClient,
  createContextClient as createSupabaseContextClient,
} from '@supabase/server/core';
import type {
  BatteryColumn,
  BatterySerialItem,
  BranchTransfer,
  BranchTransferItem,
  DayRecord,
  TeamMember,
} from '../src/types/stock.ts';
import {
  BRANCHES,
  DEFAULT_BATTERY_COLUMNS,
  DEFAULT_BRANCH_ID,
  DEFAULT_TEAM_MEMBERS,
  INITIAL_RECORD_31_10_2026,
  INITIAL_BASELINE_SERIALS,
  getBatteryRecordKey,
} from '../src/types/stock.ts';
import {
  uploadSnapshotToCloudSpace,
  getCloudinaryStatus,
  type CloudinaryBackupResult,
} from './cloudinary.ts';

const { Pool } = pg;

interface DatabaseState {
  records: Record<string, DayRecord>;
  columns: BatteryColumn[];
  teamMembers: TeamMember[];
  serials: Record<string, BatterySerialItem>;
  chargerRecords?: Record<string, any>;
  branchTransfers?: BranchTransfer[];
  logs: any[];
}

let pgPool: pg.Pool | null = null;
let isPostgresConnected = false;

let supabaseClient: SupabaseClient | null = null;
let isSupabaseReady = false;
let supabaseNeedsSchema = false;
let supabaseNeedsServiceKey = false;
let supabaseProjectRef = '';
let supabaseUsingSecretKey = false;
let supabaseJwksConfigured = false;
let supabaseLastError = '';
let initDbPromise: Promise<{
  type: 'postgresql' | 'supabase_rest' | 'file_dbms';
  ready: boolean;
  error?: string;
}> | null = null;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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
  // Strip accidental "KEY_NAME=value" paste into secret value field
  const eqMatch = val.match(/^[A-Z0-9_]+\s*[:=]\s*(.+)$/);
  if (eqMatch && eqMatch[1]) {
    val = eqMatch[1].trim();
  }
  val = stripQuotes(val);
  if (val.toLowerCase().startsWith('bearer ')) {
    val = val.slice(7).trim();
  }
  return val;
}

function parseSupabaseProjectRef(url?: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.split('.');
    return hostParts[0] || '';
  } catch {
    return '';
  }
}

function isPlaceholderDatabaseUrl(dbUrl?: string): boolean {
  if (!dbUrl) return true;
  const lower = dbUrl.toLowerCase();
  return (
    dbUrl.includes('[YOUR-DATABASE-PASSWORD]') ||
    dbUrl.includes('<YOUR-DATABASE-PASSWORD>') ||
    lower.includes('your_password') ||
    lower.includes('your-database-password')
  );
}

function isPlaceholderKey(key?: string): boolean {
  if (!key) return true;
  const lower = key.toLowerCase();
  return (
    key.includes('•') ||
    key.includes('\u2022') ||
    key.includes('***') ||
    key.includes('...') ||
    lower.includes('your_') ||
    lower.includes('your-') ||
    key.includes('<')
  );
}

// Fallback local file storage with 31-10-2026 official baseline
function readLocalFile(): DatabaseState {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed) {
        parsed.serials = parsed.serials || {};
        if (Object.keys(parsed.serials).length === 0) {
          parsed.serials = { ...INITIAL_BASELINE_SERIALS };
          writeLocalFile(parsed);
        }
        if (parsed.records && !parsed.records[INITIAL_RECORD_31_10_2026.date]) {
          parsed.records[INITIAL_RECORD_31_10_2026.date] = INITIAL_RECORD_31_10_2026;
          writeLocalFile(parsed);
        }
        const removedIds = ['luvkush', 'sonu_bhaiya', 'nikhil', 'reena_ent', 'store_staff'];
        if (Array.isArray(parsed.teamMembers)) {
          parsed.teamMembers = parsed.teamMembers
            .filter((m: any) => !removedIds.includes(m.id))
            .map((m: any) =>
              m.name.toLowerCase().includes('piyush') || m.id.includes('piyush')
                ? {
                    ...m,
                    id: 'piyush_shivhare',
                    name: 'Piyush Shivhare',
                    role: 'Owner & Admin',
                    phone: '9009156696',
                    active: true,
                  }
                : m
            );
          if (parsed.teamMembers.length === 0) {
            parsed.teamMembers = DEFAULT_TEAM_MEMBERS;
          }
          writeLocalFile(parsed);
        }
        return parsed;
      }
    }
  } catch (err) {
    console.error('[DBMS] Error reading local database file:', err);
  }

  const initialState: DatabaseState = {
    records: {
      [INITIAL_RECORD_31_10_2026.date]: INITIAL_RECORD_31_10_2026,
    },
    columns: DEFAULT_BATTERY_COLUMNS,
    teamMembers: DEFAULT_TEAM_MEMBERS,
    serials: { ...INITIAL_BASELINE_SERIALS },
    logs: [
      {
        action: 'BASELINE_31_10_2026',
        timestamp: new Date().toISOString(),
        details: 'Stock baseline reset to official verified photo dated 31-10-2026',
      },
    ],
  };

  writeLocalFile(initialState);
  return initialState;
}

function writeLocalFile(state: DatabaseState) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[DBMS] Error writing to database file:', err);
  }
}

function parseTs(ts?: string): number {
  if (!ts) return 0;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mirrorToLocalFile(updater: (local: DatabaseState) => void) {
  try {
    const local = readLocalFile();
    updater(local);
    writeLocalFile(local);
  } catch (err) {
    console.warn('[DBMS] Local mirror update warning:', err);
  }
}

let cloudSpaceDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCloudSpaceBackup(reason: string) {
  if (cloudSpaceDebounceTimer) {
    clearTimeout(cloudSpaceDebounceTimer);
  }
  cloudSpaceDebounceTimer = setTimeout(() => {
    cloudSpaceDebounceTimer = null;
    triggerCloudSpaceBackupNow(undefined, undefined, reason).catch((err) => {
      console.warn('[CloudSpace] Scheduled backup warning:', err?.message || err);
    });
  }, 2500);
}

async function seedSupabaseBaseline(client: SupabaseClient): Promise<void> {
  const local = readLocalFile();
  const now = new Date().toISOString();

  // Fetch existing Supabase stock records so we can bidirectionally merge by timestamp
  const { data: existingRemoteRows, error: fetchErr } = await client
    .from('stock_records')
    .select('date, data, updated_at');

  if (fetchErr) {
    throw fetchErr;
  }

  const remoteByKey = new Map<string, { data: DayRecord; ts: number }>();
  (existingRemoteRows || []).forEach((row: any) => {
    const parsedData: DayRecord =
      typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    const ts = Math.max(parseTs(parsedData?.lastModified), parseTs(row.updated_at));
    remoteByKey.set(row.date, { data: parsedData, ts });
  });

  const localRecords = Object.values(local.records || {});
  const recordsSource = localRecords.length > 0 ? localRecords : [INITIAL_RECORD_31_10_2026];
  const rowsToUpsert: Array<{ date: string; data: DayRecord; updated_at: string }> = [];

  for (const rec of recordsSource) {
    if (!rec || !rec.date) continue;
    const storageKey = getBatteryRecordKey(rec.branchId, rec.date);
    const localTs = parseTs(rec.lastModified);
    const remoteEntry = remoteByKey.get(storageKey);
    if (!remoteEntry || localTs > remoteEntry.ts) {
      rowsToUpsert.push({
        date: storageKey,
        data: { ...rec, branchId: rec.branchId || DEFAULT_BRANCH_ID },
        updated_at: rec.lastModified || now,
      });
    }
  }

  if (rowsToUpsert.length > 0) {
    const { error: recErr } = await client
      .from('stock_records')
      .upsert(rowsToUpsert, { onConflict: 'date' });
    if (recErr) {
      throw recErr;
    }
  }

  // Sync newer remote records down to local disk mirror as well
  let localChanged = false;
  remoteByKey.forEach((remoteEntry, key) => {
    const existingLocal = local.records?.[key];
    const existingTs = parseTs(existingLocal?.lastModified);
    if (!existingLocal || remoteEntry.ts > existingTs) {
      local.records[key] = remoteEntry.data;
      localChanged = true;
    }
  });
  if (localChanged) {
    writeLocalFile(local);
  }

  const metaRows: Array<{ key: string; data: any; updated_at: string }> = [
    {
      key: 'columns',
      data: local.columns?.length ? local.columns : DEFAULT_BATTERY_COLUMNS,
      updated_at: now,
    },
    {
      key: 'team_members',
      data: local.teamMembers?.length ? local.teamMembers : DEFAULT_TEAM_MEMBERS,
      updated_at: now,
    },
  ];
  if (local.chargerRecords && Object.keys(local.chargerRecords).length > 0) {
    metaRows.push({
      key: 'charger_records',
      data: local.chargerRecords,
      updated_at: now,
    });
  }

  await client.from('battery_metadata').upsert(metaRows, {
    onConflict: 'key',
    ignoreDuplicates: true,
  });

  const mergedSerials = { ...INITIAL_BASELINE_SERIALS, ...(local.serials || {}) };
  const serialRows = Object.values(mergedSerials).map((item) => ({
    serial_no: item.serialNo,
    data: item,
    updated_at: now,
  }));

  if (serialRows.length > 0) {
    await client
      .from('battery_serials')
      .upsert(serialRows, { onConflict: 'serial_no', ignoreDuplicates: true });
  }
}

let lastInitAttemptAt = 0;

export async function ensureDbReady(): Promise<void> {
  if (!initDbPromise) {
    lastInitAttemptAt = Date.now();
    initDbPromise = initDb();
    await initDbPromise;
    return;
  }
  await initDbPromise;
  if (!isPostgresConnected && !isSupabaseReady && Date.now() - lastInitAttemptAt > 15000) {
    lastInitAttemptAt = Date.now();
    initDbPromise = initDb();
    await initDbPromise;
  }
}

export function getActiveStorageTarget(): 'postgresql' | 'supabase' | 'local_file' {
  if (isPostgresConnected && pgPool) return 'postgresql';
  if (isSupabaseReady && supabaseClient) return 'supabase';
  return 'local_file';
}

export async function initDb(): Promise<{
  type: 'postgresql' | 'supabase_rest' | 'file_dbms';
  ready: boolean;
  error?: string;
}> {
  lastInitAttemptAt = Date.now();
  const runInit = async (): Promise<{
    type: 'postgresql' | 'supabase_rest' | 'file_dbms';
    ready: boolean;
    error?: string;
  }> => {
  // Reset transient probe flags so re-testing updates state cleanly
  isSupabaseReady = false;
  supabaseNeedsSchema = false;
  supabaseNeedsServiceKey = false;
  supabaseUsingSecretKey = false;
  supabaseLastError = '';

  const dbUrl = cleanEnvValue(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
  const isPostgresUrl = Boolean(
    dbUrl &&
      !isPlaceholderDatabaseUrl(dbUrl) &&
      (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))
  );

  // Tier 1: Direct PostgreSQL connection (Supabase direct / pooler or Cloud Postgres)
  if (isPostgresUrl && dbUrl) {
    try {
      console.log('[DBMS] Connecting to PostgreSQL (Supabase / Cloud)...');
      const pool = new Pool({
        connectionString: dbUrl,
        ssl: dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
          ? false
          : { rejectUnauthorized: false },
        connectionTimeoutMillis: 4000,
      });

      pool.on('error', (err) => {
        console.warn('[DBMS] PostgreSQL pool error:', err.message);
      });

      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS stock_records (
            date VARCHAR(50) PRIMARY KEY,
            data JSONB NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS battery_metadata (
            key VARCHAR(50) PRIMARY KEY,
            data JSONB NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS battery_serials (
            serial_no VARCHAR(100) PRIMARY KEY,
            data JSONB NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS audit_logs (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            action VARCHAR(100) NOT NULL,
            details JSONB,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          );
        `);

        await client.query(
          `INSERT INTO stock_records (date, data, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (date) DO NOTHING`,
          [INITIAL_RECORD_31_10_2026.date, JSON.stringify(INITIAL_RECORD_31_10_2026)]
        );
        await client.query(
          `INSERT INTO battery_metadata (key, data, updated_at)
           VALUES ('columns', $1, NOW())
           ON CONFLICT (key) DO NOTHING`,
          [JSON.stringify(DEFAULT_BATTERY_COLUMNS)]
        );
        await client.query(
          `INSERT INTO battery_metadata (key, data, updated_at)
           VALUES ('team_members', $1, NOW())
           ON CONFLICT (key) DO NOTHING`,
          [JSON.stringify(DEFAULT_TEAM_MEMBERS)]
        );

        for (const item of Object.values(INITIAL_BASELINE_SERIALS)) {
          await client.query(
            `INSERT INTO battery_serials (serial_no, data, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (serial_no) DO NOTHING`,
            [item.serialNo, JSON.stringify(item)]
          );
        }

        pgPool = pool;
        isPostgresConnected = true;
        console.log('[DBMS] Successfully connected to PostgreSQL database!');
        return { type: 'postgresql', ready: true };
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.warn(
        '[DBMS] Direct PostgreSQL connection unavailable, checking @supabase/server HTTPS API / local fallback:',
        err.message
      );
      if (pgPool) {
        await pgPool.end().catch(() => {});
      }
      isPostgresConnected = false;
      pgPool = null;
    }
  } else if (dbUrl && isPlaceholderDatabaseUrl(dbUrl)) {
    console.warn(
      '[DBMS] DATABASE_URL still contains the placeholder password; skipping direct TCP Postgres.'
    );
  }

  // Tier 2: @supabase/server HTTPS REST Client (SUPABASE_URL + SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY)
  const supabaseUrl = cleanEnvValue(process.env.SUPABASE_URL);
  const rawSecretPrimary = cleanEnvValue(process.env.SUPABASE_SECRET_KEY);
  const rawServiceRole = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const secretKeysToTry = Array.from(
    new Set(
      [rawSecretPrimary, rawServiceRole].filter((k) => k && !isPlaceholderKey(k))
    )
  );
  const rawPublishableKey = cleanEnvValue(
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
  );
  const publishableKey =
    rawPublishableKey && !isPlaceholderKey(rawPublishableKey) ? rawPublishableKey : '';

  supabaseJwksConfigured = Boolean(cleanEnvValue(process.env.SUPABASE_JWKS_URL) || supabaseUrl);

  const buildSupabaseClient = (mode: 'secret' | 'publishable', explicitKey?: string): SupabaseClient | null => {
    if (!supabaseUrl) return null;
    const key = explicitKey || (mode === 'secret' ? secretKeysToTry[0] : publishableKey);
    if (!key) return null;

    const isOpaqueApiKey = key.startsWith('sb_secret_') || key.startsWith('sb_publishable_');
    const customFetch: typeof fetch | undefined = isOpaqueApiKey
      ? (input, init) => {
          const headers = new Headers(init?.headers);
          if (headers.get('Authorization') === `Bearer ${key}`) {
            headers.delete('Authorization');
          }
          if (!headers.has('apikey')) {
            headers.set('apikey', key);
          }
          return fetch(input, { ...init, headers });
        }
      : undefined;

    const { data: resolvedEnv } = resolveSupabaseServerEnv({
      url: supabaseUrl,
      ...(mode === 'secret' ? { secretKeys: { default: key } } : { publishableKeys: { default: key } }),
    });

    if (resolvedEnv) {
      try {
        return mode === 'secret'
          ? createSupabaseAdminClient({
              env: resolvedEnv,
              supabaseOptions: customFetch ? { global: { fetch: customFetch } } : undefined,
            })
          : createSupabaseContextClient({
              env: resolvedEnv,
              supabaseOptions: customFetch ? { global: { fetch: customFetch } } : undefined,
            });
      } catch {
        // Fallback below for legacy JWT keys
      }
    }

    return createClient(supabaseUrl, key, {
      global: customFetch ? { fetch: customFetch } : undefined,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  };

  if (supabaseUrl && (secretKeysToTry.length > 0 || publishableKey)) {
    supabaseProjectRef = parseSupabaseProjectRef(supabaseUrl);
    const candidates: Array<{ mode: 'secret' | 'publishable'; key: string; client: SupabaseClient }> = [];

    for (const sk of secretKeysToTry) {
      const c = buildSupabaseClient('secret', sk);
      if (c) candidates.push({ mode: 'secret', key: sk, client: c });
    }
    if (publishableKey) {
      const c = buildSupabaseClient('publishable', publishableKey);
      if (c) candidates.push({ mode: 'publishable', key: publishableKey, client: c });
    }

    let invalidSecretHint = '';

    for (const candidate of candidates) {
      try {
        const { error, status } = await candidate.client
          .from('stock_records')
          .select('date')
          .limit(1);

        if (!error) {
          supabaseClient = candidate.client;
          supabaseUsingSecretKey = candidate.mode === 'secret';
          try {
            await seedSupabaseBaseline(candidate.client);
            isSupabaseReady = true;
            supabaseNeedsSchema = false;
            supabaseNeedsServiceKey = false;
            supabaseLastError = '';
            console.log(
              `[DBMS] Connected to Supabase HTTPS REST API (${candidate.mode}):`,
              supabaseUrl
            );
            return { type: 'supabase_rest', ready: true };
          } catch (seedErr: any) {
            const seedCode = seedErr?.code || '';
            const seedMsg = seedErr?.message || '';
            supabaseLastError = [seedCode, seedMsg].filter(Boolean).join(' — ');
            if (seedCode === '42501' || seedMsg.toLowerCase().includes('row-level security') || seedMsg.toLowerCase().includes('permission denied')) {
              if (candidate.mode === 'secret') {
                supabaseNeedsSchema = true;
              } else {
                supabaseNeedsServiceKey = true;
              }
              isSupabaseReady = false;
            } else {
              isSupabaseReady = true;
              return { type: 'supabase_rest', ready: true };
            }
          }
          continue;
        }

        const errCode = error.code || '';
        const errMsg = error.message || '';
        const formattedErr = [errCode, errMsg, status ? `HTTP ${status}` : '']
          .filter(Boolean)
          .join(' — ');

        // If a secret key is invalid (401 Invalid API key), try next candidate
        if (
          candidate.mode === 'secret' &&
          (status === 401 || errMsg.toLowerCase().includes('invalid api key'))
        ) {
          const looksValidFormat =
            candidate.key.startsWith('sb_secret_') || candidate.key.startsWith('eyJ');
          invalidSecretHint = looksValidFormat
            ? 'SUPABASE_SECRET_KEY was rejected by Supabase (401 Invalid API key) — verify you copied the unmasked active secret key for project ' +
              supabaseProjectRef
            : 'SUPABASE_SECRET_KEY does not match a Supabase secret key format (must start with sb_secret_ or eyJ...)';
          supabaseLastError = invalidSecretHint;
          console.warn('[DBMS]', invalidSecretHint);
          continue;
        }

        supabaseClient = candidate.client;
        supabaseUsingSecretKey = candidate.mode === 'secret';
        supabaseLastError = invalidSecretHint
          ? `${invalidSecretHint}; publishable fallback: ${formattedErr}`
          : formattedErr;

        if (
          errCode === 'PGRST205' ||
          errCode === '42P01' ||
          status === 404 ||
          errMsg.includes('schema cache') ||
          errMsg.includes('does not exist')
        ) {
          supabaseNeedsSchema = true;
          isSupabaseReady = false;
          console.warn(
            '[DBMS] Supabase project reachable, but tables are not created yet. Run supabase/migrations/20261122000000_init_stock_register.sql.'
          );
          break;
        }

        if (
          errCode === '42501' ||
          errCode === 'PGRST301' ||
          status === 401 ||
          status === 403 ||
          errMsg.toLowerCase().includes('permission') ||
          errMsg.toLowerCase().includes('row-level security') ||
          errMsg.toLowerCase().includes('api key')
        ) {
          if (candidate.mode === 'secret' && errCode === '42501') {
            supabaseNeedsSchema = true;
            supabaseNeedsServiceKey = false;
            supabaseLastError =
              'Secret key authenticated as service_role, but PostgreSQL table GRANT privileges are missing. Run GRANT USAGE ON SCHEMA public TO service_role and GRANT ALL ON TABLE ... TO service_role in Supabase SQL Editor.';
          } else {
            supabaseNeedsServiceKey = true;
          }
          isSupabaseReady = false;
          console.warn('[DBMS] Supabase access blocked:', supabaseLastError);
          break;
        }

        console.warn('[DBMS] Supabase check warning:', supabaseLastError);
      } catch (err: any) {
        supabaseLastError = err?.message || 'Connection failed';
        console.warn('[DBMS] Supabase HTTPS client init failed:', supabaseLastError);
      }
    }
  }

  // Tier 3: Persistent local JSON file fallback
  readLocalFile();
  console.log('[DBMS] Using persistent Local File DBMS at:', DATA_FILE);
  return { type: 'file_dbms', ready: true, error: supabaseLastError || undefined };
  };

  initDbPromise = runInit();
  return initDbPromise;
}

export function getDbStatus() {
  const isPg = Boolean(isPostgresConnected && pgPool);
  const dbUrl = cleanEnvValue(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
  const isPgUrl = Boolean(
    dbUrl &&
      !isPlaceholderDatabaseUrl(dbUrl) &&
      (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))
  );
  const secretEnv = cleanEnvValue(
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const pubEnv = cleanEnvValue(
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
  );
  const supabaseUrl = cleanEnvValue(process.env.SUPABASE_URL);
  const supabaseConfigured = Boolean(
    supabaseUrl &&
      ((secretEnv && !isPlaceholderKey(secretEnv)) || (pubEnv && !isPlaceholderKey(pubEnv)))
  );

  let engine = 'Persistent DBMS (Local JSON Cache)';
  let storageLocation = DATA_FILE;

  if (isPg) {
    engine = 'PostgreSQL (Supabase / Cloud Direct)';
    storageLocation = 'Remote PostgreSQL Database';
  } else if (isSupabaseReady && supabaseClient) {
    engine = `Supabase PostgreSQL (${supabaseProjectRef || 'Cloud REST'})`;
    storageLocation = supabaseUrl || 'Supabase Cloud';
  } else if (supabaseConfigured && supabaseNeedsSchema) {
    engine = 'Supabase Connected (Awaiting SQL Schema) · Local Fallback';
  } else if (supabaseConfigured && supabaseNeedsServiceKey) {
    engine = 'Supabase Connected (Key / Permissions Needed) · Local Fallback';
  } else if (supabaseConfigured && supabaseLastError) {
    engine = 'Supabase Key Invalid · Local Fallback';
  }

  return {
    engine,
    status: 'connected',
    hasPostgresUrl: isPgUrl,
    supabaseConfigured,
    supabaseReady: isSupabaseReady,
    supabaseNeedsSchema,
    supabaseNeedsServiceKey,
    supabaseUsingSecretKey,
    supabaseJwksConfigured,
    supabaseLastError: supabaseLastError || undefined,
    supabaseProjectRef:
      supabaseProjectRef || parseSupabaseProjectRef(supabaseUrl) || 'anaibpuhnxlwfeypprlb',
    storageLocation,
    cloudinary: getCloudinaryStatus(),
  };
}

export async function getAllRecords(): Promise<Record<string, DayRecord>> {
  const local = readLocalFile();
  let remoteMap: Record<string, DayRecord> | null = null;

  if (isPostgresConnected && pgPool) {
    try {
      const res = await pgPool.query('SELECT date, data FROM stock_records ORDER BY updated_at DESC');
      remoteMap = {};
      res.rows.forEach((row) => {
        remoteMap![row.date] = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      });
    } catch (err) {
      console.error('[DBMS] PG getAllRecords error:', err);
    }
  } else if (isSupabaseReady && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('stock_records')
        .select('date, data')
        .order('updated_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        remoteMap = {};
        data.forEach((row: any) => {
          remoteMap![row.date] = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        });
      } else if (error) {
        console.error('[DBMS] Supabase getAllRecords error:', error.message);
      }
    } catch (err) {
      console.error('[DBMS] Supabase getAllRecords exception:', err);
    }
  }

  if (remoteMap) {
    // Merge with local mirror by lastModified so transient local writes never vanish
    const merged: Record<string, DayRecord> = { ...remoteMap };
    Object.entries(local.records || {}).forEach(([k, localRec]) => {
      const remoteRec = merged[k];
      if (!remoteRec || parseTs(localRec?.lastModified) > parseTs(remoteRec?.lastModified)) {
        merged[k] = localRec;
      }
    });
    return merged;
  }

  return local.records;
}

export async function getRecord(date: string): Promise<DayRecord | null> {
  if (typeof date !== 'string' || !date.trim()) return null;

  if (isPostgresConnected && pgPool) {
    try {
      const res = await pgPool.query('SELECT data FROM stock_records WHERE date = $1', [date]);
      if (res.rows.length > 0) {
        return typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
      }
      return null;
    } catch (err) {
      console.error('[DBMS] PG getRecord error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('stock_records')
        .select('data')
        .eq('date', date)
        .maybeSingle();
      if (!error) {
        if (!data) return null;
        return typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
      }
      console.error('[DBMS] Supabase getRecord error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase getRecord exception:', err);
    }
  }

  const local = readLocalFile();
  return local.records[date] || null;
}

export interface SaveRecordResult {
  record: DayRecord;
  persistedToRemote: boolean;
  remoteError?: string;
}

export async function saveRecordWithStatus(record: DayRecord): Promise<SaveRecordResult> {
  if (!record || typeof record.date !== 'string' || !record.date.trim()) {
    throw new Error('Valid record date is required');
  }

  const branchId =
    typeof record.branchId === 'string' && record.branchId.trim()
      ? record.branchId.trim()
      : DEFAULT_BRANCH_ID;
  const storageKey = getBatteryRecordKey(branchId, record.date);

  const updatedRecord: DayRecord = {
    ...record,
    branchId,
    lastModified: new Date().toISOString(),
  };

  // Always write-through to persistent local disk mirror immediately
  mirrorToLocalFile((local) => {
    local.records[storageKey] = updatedRecord;
    local.logs.unshift({
      action: 'SAVE_RECORD',
      date: storageKey,
      timestamp: updatedRecord.lastModified,
    });
    if (local.logs.length > 200) local.logs = local.logs.slice(0, 200);
  });

  let persistedToRemote = false;
  let remoteError: string | undefined;

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO stock_records (date, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (date) DO UPDATE SET data = $2, updated_at = NOW()`,
        [storageKey, JSON.stringify(updatedRecord)]
      );

      await pgPool.query('INSERT INTO audit_logs (action, details) VALUES ($1, $2)', [
        'SAVE_RECORD',
        JSON.stringify({ key: storageKey, date: record.date, branchId }),
      ]);

      persistedToRemote = true;
    } catch (err: any) {
      remoteError = err?.message || 'PostgreSQL write failed';
      console.error('[DBMS] PG saveRecord error:', remoteError);
    }
  } else if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient.from('stock_records').upsert(
        {
          date: storageKey,
          data: updatedRecord,
          updated_at: updatedRecord.lastModified,
        },
        { onConflict: 'date' }
      );
      if (!error) {
        persistedToRemote = true;
        supabaseClient
          .from('audit_logs')
          .insert({
            action: 'SAVE_RECORD',
            details: { key: storageKey, date: record.date, branchId },
          })
          .then(() => {}, () => {});
      } else {
        remoteError = error.message || 'Supabase upsert failed';
        console.error('[DBMS] Supabase saveRecord error:', remoteError);
      }
    } catch (err: any) {
      remoteError = err?.message || 'Supabase upsert exception';
      console.error('[DBMS] Supabase saveRecord exception:', remoteError);
    }
  }

  scheduleCloudSpaceBackup(`saveRecord:${storageKey}`);

  return {
    record: updatedRecord,
    persistedToRemote,
    remoteError,
  };
}

export async function saveRecord(record: DayRecord): Promise<DayRecord> {
  const res = await saveRecordWithStatus(record);
  return res.record;
}

export async function deleteRecord(date: string): Promise<boolean> {
  if (typeof date !== 'string' || !date.trim()) return false;

  mirrorToLocalFile((local) => {
    if (local.records[date]) {
      delete local.records[date];
    }
  });

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query('DELETE FROM stock_records WHERE date = $1', [date]);
      scheduleCloudSpaceBackup(`deleteRecord:${date}`);
      return true;
    } catch (err) {
      console.error('[DBMS] PG deleteRecord error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient.from('stock_records').delete().eq('date', date);
      if (!error) {
        scheduleCloudSpaceBackup(`deleteRecord:${date}`);
        return true;
      }
      console.error('[DBMS] Supabase deleteRecord error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase deleteRecord exception:', err);
    }
  }

  scheduleCloudSpaceBackup(`deleteRecord:${date}`);
  return true;
}

export async function getColumns(): Promise<BatteryColumn[]> {
  if (isPostgresConnected && pgPool) {
    try {
      const res = await pgPool.query("SELECT data FROM battery_metadata WHERE key = 'columns'");
      if (res.rows.length > 0) {
        return typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
      }
    } catch (err) {
      console.error('[DBMS] PG getColumns error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('battery_metadata')
        .select('data')
        .eq('key', 'columns')
        .maybeSingle();
      if (!error && data?.data) {
        return typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
      }
    } catch (err) {
      console.error('[DBMS] Supabase getColumns error:', err);
    }
  }

  const local = readLocalFile();
  return local.columns || DEFAULT_BATTERY_COLUMNS;
}

export async function saveColumns(columns: BatteryColumn[]): Promise<BatteryColumn[]> {
  mirrorToLocalFile((local) => {
    local.columns = columns;
  });

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO battery_metadata (key, data, updated_at)
         VALUES ('columns', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET data = $1, updated_at = NOW()`,
        [JSON.stringify(columns)]
      );
      scheduleCloudSpaceBackup('saveColumns');
      return columns;
    } catch (err) {
      console.error('[DBMS] PG saveColumns error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient.from('battery_metadata').upsert(
        {
          key: 'columns',
          data: columns,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
      if (!error) {
        scheduleCloudSpaceBackup('saveColumns');
        return columns;
      }
      console.error('[DBMS] Supabase saveColumns error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase saveColumns exception:', err);
    }
  }

  scheduleCloudSpaceBackup('saveColumns');
  return columns;
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  if (isPostgresConnected && pgPool) {
    try {
      const res = await pgPool.query("SELECT data FROM battery_metadata WHERE key = 'team_members'");
      if (res.rows.length > 0) {
        return typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
      }
    } catch (err) {
      console.error('[DBMS] PG getTeamMembers error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('battery_metadata')
        .select('data')
        .eq('key', 'team_members')
        .maybeSingle();
      if (!error && data?.data) {
        return typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
      }
    } catch (err) {
      console.error('[DBMS] Supabase getTeamMembers error:', err);
    }
  }

  const local = readLocalFile();
  return local.teamMembers || DEFAULT_TEAM_MEMBERS;
}

export async function saveTeamMembers(team: TeamMember[]): Promise<TeamMember[]> {
  mirrorToLocalFile((local) => {
    local.teamMembers = team;
  });

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO battery_metadata (key, data, updated_at)
         VALUES ('team_members', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET data = $1, updated_at = NOW()`,
        [JSON.stringify(team)]
      );
      scheduleCloudSpaceBackup('saveTeamMembers');
      return team;
    } catch (err) {
      console.error('[DBMS] PG saveTeamMembers error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient.from('battery_metadata').upsert(
        {
          key: 'team_members',
          data: team,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
      if (!error) {
        scheduleCloudSpaceBackup('saveTeamMembers');
        return team;
      }
      console.error('[DBMS] Supabase saveTeamMembers error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase saveTeamMembers exception:', err);
    }
  }

  scheduleCloudSpaceBackup('saveTeamMembers');
  return team;
}

export async function logAudit(action: string, details: any) {
  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query('INSERT INTO audit_logs (action, details) VALUES ($1, $2)', [
        action,
        JSON.stringify(details),
      ]);
      return;
    } catch {
      // fallback below
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient.from('audit_logs').insert({
        action,
        details,
      });
      if (!error) return;
    } catch {
      // fallback below
    }
  }

  const local = readLocalFile();
  local.logs.unshift({ action, details, timestamp: new Date().toISOString() });
  if (local.logs.length > 100) local.logs = local.logs.slice(0, 100);
  writeLocalFile(local);
}

// Battery Serial & Batch Tracker DBMS Functions
export async function getAllSerials(): Promise<Record<string, BatterySerialItem>> {
  if (isPostgresConnected && pgPool) {
    try {
      const res = await pgPool.query('SELECT serial_no, data FROM battery_serials ORDER BY updated_at DESC');
      const map: Record<string, BatterySerialItem> = {};
      res.rows.forEach((r) => {
        map[r.serial_no] = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      });
      return map;
    } catch (err) {
      console.error('[DBMS] PG getAllSerials error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('battery_serials')
        .select('serial_no, data')
        .order('updated_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        const map: Record<string, BatterySerialItem> = {};
        data.forEach((r: any) => {
          map[r.serial_no] = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        });
        return map;
      }
      if (error) console.error('[DBMS] Supabase getAllSerials error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase getAllSerials exception:', err);
    }
  }

  const local = readLocalFile();
  return local.serials || {};
}

export async function getSerial(serialNo: string): Promise<BatterySerialItem | null> {
  if (typeof serialNo !== 'string' || !serialNo.trim()) return null;

  if (isPostgresConnected && pgPool) {
    try {
      const res = await pgPool.query('SELECT data FROM battery_serials WHERE serial_no = $1', [serialNo]);
      if (res.rows.length > 0) {
        return typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
      }
      return null;
    } catch (err) {
      console.error('[DBMS] PG getSerial error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('battery_serials')
        .select('data')
        .eq('serial_no', serialNo)
        .maybeSingle();
      if (!error) {
        if (!data) return null;
        return typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
      }
      console.error('[DBMS] Supabase getSerial error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase getSerial exception:', err);
    }
  }

  const local = readLocalFile();
  return local.serials?.[serialNo] || null;
}

export async function saveSerial(item: BatterySerialItem): Promise<BatterySerialItem> {
  if (!item || typeof item.serialNo !== 'string' || !item.serialNo.trim()) {
    throw new Error('Valid serialNo is required');
  }

  mirrorToLocalFile((local) => {
    local.serials = local.serials || {};
    local.serials[item.serialNo] = item;
  });

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO battery_serials (serial_no, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (serial_no) DO UPDATE SET data = $2, updated_at = NOW()`,
        [item.serialNo, JSON.stringify(item)]
      );
      scheduleCloudSpaceBackup(`saveSerial:${item.serialNo}`);
      return item;
    } catch (err) {
      console.error('[DBMS] PG saveSerial error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient.from('battery_serials').upsert(
        {
          serial_no: item.serialNo,
          data: item,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'serial_no' }
      );
      if (!error) {
        scheduleCloudSpaceBackup(`saveSerial:${item.serialNo}`);
        return item;
      }
      console.error('[DBMS] Supabase saveSerial error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase saveSerial exception:', err);
    }
  }

  scheduleCloudSpaceBackup(`saveSerial:${item.serialNo}`);
  return item;
}

export async function bulkSaveSerials(items: BatterySerialItem[]): Promise<BatterySerialItem[]> {
  const validItems = items.filter(
    (item) => item && typeof item.serialNo === 'string' && item.serialNo.trim()
  );
  if (validItems.length === 0) return [];

  mirrorToLocalFile((local) => {
    local.serials = local.serials || {};
    validItems.forEach((item) => {
      local.serials[item.serialNo] = item;
    });
  });

  if (isPostgresConnected && pgPool) {
    try {
      for (const item of validItems) {
        await pgPool.query(
          `INSERT INTO battery_serials (serial_no, data, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (serial_no) DO UPDATE SET data = $2, updated_at = NOW()`,
          [item.serialNo, JSON.stringify(item)]
        );
      }
      scheduleCloudSpaceBackup(`bulkSaveSerials:${validItems.length}`);
      return validItems;
    } catch (err) {
      console.error('[DBMS] PG bulkSaveSerials error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const rows = validItems.map((item) => ({
        serial_no: item.serialNo,
        data: item,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabaseClient
        .from('battery_serials')
        .upsert(rows, { onConflict: 'serial_no' });
      if (!error) {
        scheduleCloudSpaceBackup(`bulkSaveSerials:${validItems.length}`);
        return validItems;
      }
      console.error('[DBMS] Supabase bulkSaveSerials error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase bulkSaveSerials exception:', err);
    }
  }

  scheduleCloudSpaceBackup(`bulkSaveSerials:${validItems.length}`);
  return validItems;
}

export async function deleteSerial(serialNo: string): Promise<boolean> {
  if (typeof serialNo !== 'string' || !serialNo.trim()) return false;

  mirrorToLocalFile((local) => {
    if (local.serials && local.serials[serialNo]) {
      delete local.serials[serialNo];
    }
  });

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query('DELETE FROM battery_serials WHERE serial_no = $1', [serialNo]);
      scheduleCloudSpaceBackup(`deleteSerial:${serialNo}`);
      return true;
    } catch (err) {
      console.error('[DBMS] PG deleteSerial error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('battery_serials')
        .delete()
        .eq('serial_no', serialNo);
      if (!error) {
        scheduleCloudSpaceBackup(`deleteSerial:${serialNo}`);
        return true;
      }
      console.error('[DBMS] Supabase deleteSerial error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase deleteSerial exception:', err);
    }
  }

  scheduleCloudSpaceBackup(`deleteSerial:${serialNo}`);
  return true;
}

export async function getChargerRecords(): Promise<Record<string, any>> {
  const local = readLocalFile();
  let remoteMap: Record<string, any> | null = null;

  if (isPostgresConnected && pgPool) {
    try {
      const res = await pgPool.query("SELECT data FROM battery_metadata WHERE key = 'charger_records'");
      if (res.rows.length > 0) {
        remoteMap = typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
      }
    } catch (err) {
      console.error('[DBMS] PG getChargerRecords error:', err);
    }
  } else if (isSupabaseReady && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('battery_metadata')
        .select('data')
        .eq('key', 'charger_records')
        .maybeSingle();
      if (!error) {
        remoteMap = data?.data
          ? typeof data.data === 'string'
            ? JSON.parse(data.data)
            : data.data
          : {};
      } else {
        console.error('[DBMS] Supabase getChargerRecords error:', error.message);
      }
    } catch (err) {
      console.error('[DBMS] Supabase getChargerRecords exception:', err);
    }
  }

  if (remoteMap) {
    const merged = { ...remoteMap };
    Object.entries(local.chargerRecords || {}).forEach(([k, val]: [string, any]) => {
      if (!merged[k] || parseTs(val?.updatedAt) > parseTs(merged[k]?.updatedAt)) {
        merged[k] = val;
      }
    });
    return merged;
  }

  return local.chargerRecords || {};
}

export async function saveChargerRecord(
  branchId: string,
  date: string,
  record: Record<string, any>
): Promise<{ key: string; branchId: string; date: string; record: Record<string, any>; updatedAt: string }> {
  if (typeof branchId !== 'string' || !branchId.trim() || typeof date !== 'string' || !date.trim()) {
    throw new Error('Valid branchId and date are required');
  }

  const compositeKey = `${branchId}::${date}`;
  const updatedAt = new Date().toISOString();
  const existing = await getChargerRecords();
  const merged = {
    ...existing,
    [compositeKey]: {
      branchId,
      date,
      items: record,
      updatedAt,
    },
  };

  mirrorToLocalFile((local) => {
    local.chargerRecords = merged;
  });

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO battery_metadata (key, data, updated_at)
         VALUES ('charger_records', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET data = $1, updated_at = NOW()`,
        [JSON.stringify(merged)]
      );
      scheduleCloudSpaceBackup(`saveCharger:${compositeKey}`);
      return { key: compositeKey, branchId, date, record, updatedAt };
    } catch (err) {
      console.error('[DBMS] PG saveChargerRecord error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient.from('battery_metadata').upsert(
        {
          key: 'charger_records',
          data: merged,
          updated_at: updatedAt,
        },
        { onConflict: 'key' }
      );
      if (!error) {
        scheduleCloudSpaceBackup(`saveCharger:${compositeKey}`);
        return { key: compositeKey, branchId, date, record, updatedAt };
      }
      console.error('[DBMS] Supabase saveChargerRecord error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase saveChargerRecord exception:', err);
    }
  }

  scheduleCloudSpaceBackup(`saveCharger:${compositeKey}`);
  return { key: compositeKey, branchId, date, record, updatedAt };
}

export async function exportFullDatabaseSnapshot(reason = 'manual') {
  const [records, columns, teamMembers, serials, chargerRecords, branchTransfers] =
    await Promise.all([
      getAllRecords(),
      getColumns(),
      getTeamMembers(),
      getAllSerials(),
      getChargerRecords(),
      getBranchTransfers(),
    ]);

  return {
    version: 1,
    app: 'battery-stock-register',
    reason,
    exportedAt: new Date().toISOString(),
    stats: {
      records: Object.keys(records).length,
      serials: Object.keys(serials).length,
      chargers: Object.keys(chargerRecords).length,
      transfers: branchTransfers.length,
    },
    state: {
      records,
      columns,
      teamMembers,
      serials,
      chargerRecords,
      branchTransfers,
    },
  };
}

export async function triggerCloudSpaceBackupNow(
  records?: Record<string, DayRecord>,
  serials?: Record<string, BatterySerialItem>,
  reason = 'manual'
): Promise<
  CloudinaryBackupResult & {
    recordCount: number;
    serialCount: number;
  }
> {
  if ((records && Object.keys(records).length > 0) || (serials && Object.keys(serials).length > 0)) {
    await backupPermanentCodebase(records, serials);
  }
  const snapshot = await exportFullDatabaseSnapshot(reason);
  const cloudRes = await uploadSnapshotToCloudSpace(snapshot);
  return {
    ...cloudRes,
    recordCount: snapshot.stats.records,
    serialCount: snapshot.stats.serials,
  };
}

export async function restoreFullDatabaseSnapshot(
  rawSnapshot: any
): Promise<{
  success: boolean;
  restoredRecords: number;
  restoredSerials: number;
  timestamp: string;
}> {
  const state = rawSnapshot?.state || rawSnapshot;
  if (!state || typeof state !== 'object' || typeof state.records !== 'object') {
    throw new Error('Invalid snapshot payload: missing records map');
  }

  const incomingRecords = state.records as Record<string, DayRecord>;
  const incomingSerials = (state.serials || {}) as Record<string, BatterySerialItem>;
  const incomingColumns = Array.isArray(state.columns) ? (state.columns as BatteryColumn[]) : undefined;
  const incomingTeam = Array.isArray(state.teamMembers) ? (state.teamMembers as TeamMember[]) : undefined;
  const incomingChargers =
    state.chargerRecords && typeof state.chargerRecords === 'object' ? state.chargerRecords : undefined;
  const incomingTransfers = Array.isArray(state.branchTransfers)
    ? (state.branchTransfers as BranchTransfer[])
    : undefined;

  await backupPermanentCodebase(incomingRecords, incomingSerials);
  if (incomingColumns && incomingColumns.length > 0) {
    await saveColumns(incomingColumns);
  }
  if (incomingTeam && incomingTeam.length > 0) {
    await saveTeamMembers(incomingTeam);
  }
  if (incomingChargers) {
    const currentChargers = await getChargerRecords();
    const mergedChargers = { ...currentChargers, ...incomingChargers };
    mirrorToLocalFile((local) => {
      local.chargerRecords = mergedChargers;
    });
    if (isPostgresConnected && pgPool) {
      await pgPool.query(
        `INSERT INTO battery_metadata (key, data, updated_at)
         VALUES ('charger_records', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET data = $1, updated_at = NOW()`,
        [JSON.stringify(mergedChargers)]
      );
    } else if (isSupabaseReady && supabaseClient) {
      await supabaseClient.from('battery_metadata').upsert(
        {
          key: 'charger_records',
          data: mergedChargers,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
    }
  }
  if (incomingTransfers) {
    await saveBranchTransfersList(incomingTransfers);
  }

  return {
    success: true,
    restoredRecords: Object.keys(incomingRecords).length,
    restoredSerials: Object.keys(incomingSerials).length,
    timestamp: new Date().toISOString(),
  };
}

export async function backupPermanentCodebase(
  records?: Record<string, DayRecord>,
  serials?: Record<string, BatterySerialItem>
): Promise<{ success: boolean; timestamp: string; recordCount: number; serialCount: number }> {
  const existingServerRecords = await getAllRecords();
  const mergedRecords: Record<string, DayRecord> = { ...existingServerRecords };

  if (records && Object.keys(records).length > 0) {
    for (const [key, incoming] of Object.entries(records)) {
      if (!incoming || !incoming.date) continue;
      const normalizedKey = getBatteryRecordKey(incoming.branchId, incoming.date) || key;
      const current = mergedRecords[normalizedKey];
      if (!current) {
        mergedRecords[normalizedKey] = {
          ...incoming,
          branchId: incoming.branchId || DEFAULT_BRANCH_ID,
        };
      } else {
        const currentTs = parseTs(current.lastModified);
        const incomingTs = parseTs(incoming.lastModified);
        if (incomingTs >= currentTs) {
          mergedRecords[normalizedKey] = {
            ...incoming,
            branchId: incoming.branchId || DEFAULT_BRANCH_ID,
          };
        }
      }
    }
  }

  const local = readLocalFile();
  local.records = mergedRecords;
  if (serials && Object.keys(serials).length > 0) {
    local.serials = { ...local.serials, ...serials };
  }
  local.logs.unshift({
    action: 'PERMANENT_CODEBASE_BACKUP',
    timestamp: new Date().toISOString(),
    details: 'Permanent stock and serial snapshot flushed to disk and cloud state',
  });
  if (local.logs.length > 200) local.logs = local.logs.slice(0, 200);
  writeLocalFile(local);

  if (isPostgresConnected && pgPool) {
    try {
      for (const rec of Object.values(mergedRecords)) {
        const storageKey = getBatteryRecordKey(rec.branchId, rec.date);
        await pgPool.query(
          `INSERT INTO stock_records (date, data, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (date) DO UPDATE SET data = $2, updated_at = NOW()`,
          [storageKey, JSON.stringify({ ...rec, branchId: rec.branchId || DEFAULT_BRANCH_ID })]
        );
      }
      if (serials && Object.keys(serials).length > 0) {
        for (const item of Object.values(serials)) {
          await pgPool.query(
            `INSERT INTO battery_serials (serial_no, data, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (serial_no) DO UPDATE SET data = $2, updated_at = NOW()`,
            [item.serialNo, JSON.stringify(item)]
          );
        }
      }
    } catch (e) {
      console.warn('[DBMS] PG backup warning:', e);
    }
  } else if (isSupabaseReady && supabaseClient) {
    try {
      const rows = Object.values(mergedRecords).map((rec) => ({
        date: getBatteryRecordKey(rec.branchId, rec.date),
        data: { ...rec, branchId: rec.branchId || DEFAULT_BRANCH_ID },
        updated_at: rec.lastModified || new Date().toISOString(),
      }));
      if (rows.length > 0) {
        await supabaseClient.from('stock_records').upsert(rows, { onConflict: 'date' });
      }
      if (serials && Object.keys(serials).length > 0) {
        const serialRows = Object.values(serials)
          .filter((item) => item && item.serialNo)
          .map((item) => ({
            serial_no: item.serialNo,
            data: item,
            updated_at: new Date().toISOString(),
          }));
        if (serialRows.length > 0) {
          await supabaseClient
            .from('battery_serials')
            .upsert(serialRows, { onConflict: 'serial_no' });
        }
      }
    } catch (e) {
      console.warn('[DBMS] Supabase backup warning:', e);
    }
  }

  return {
    success: true,
    timestamp: new Date().toISOString(),
    recordCount: Object.keys(mergedRecords).length,
    serialCount: Object.keys(local.serials).length,
  };
}

// =========================================================================
// Inter-Branch Stock Transfer & Receive Goods Notification DBMS Functions
// =========================================================================

export async function getBranchTransfers(): Promise<BranchTransfer[]> {
  if (isPostgresConnected && pgPool) {
    try {
      const res = await pgPool.query("SELECT data FROM battery_metadata WHERE key = 'branch_transfers'");
      if (res.rows.length > 0) {
        const parsed = typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
        return Array.isArray(parsed) ? parsed : [];
      }
      return [];
    } catch (err) {
      console.error('[DBMS] PG getBranchTransfers error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('battery_metadata')
        .select('data')
        .eq('key', 'branch_transfers')
        .maybeSingle();
      if (!error) {
        if (!data?.data) return [];
        const parsed = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        return Array.isArray(parsed) ? parsed : [];
      }
      console.error('[DBMS] Supabase getBranchTransfers error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase getBranchTransfers exception:', err);
    }
  }

  const local = readLocalFile();
  return Array.isArray(local.branchTransfers) ? local.branchTransfers : [];
}

async function saveBranchTransfersList(transfers: BranchTransfer[]): Promise<BranchTransfer[]> {
  const updatedAt = new Date().toISOString();

  mirrorToLocalFile((local) => {
    local.branchTransfers = transfers;
  });

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO battery_metadata (key, data, updated_at)
         VALUES ('branch_transfers', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET data = $1, updated_at = NOW()`,
        [JSON.stringify(transfers)]
      );
      scheduleCloudSpaceBackup('saveTransfers');
      return transfers;
    } catch (err) {
      console.error('[DBMS] PG saveBranchTransfersList error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient.from('battery_metadata').upsert(
        {
          key: 'branch_transfers',
          data: transfers,
          updated_at: updatedAt,
        },
        { onConflict: 'key' }
      );
      if (!error) {
        scheduleCloudSpaceBackup('saveTransfers');
        return transfers;
      }
      console.error('[DBMS] Supabase saveBranchTransfersList error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase saveBranchTransfersList exception:', err);
    }
  }

  scheduleCloudSpaceBackup('saveTransfers');
  return transfers;
}

export async function createBranchTransfer(input: {
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
}): Promise<{ created: BranchTransfer; transfers: BranchTransfer[] }> {
  const fromBranchId = String(input.fromBranchId || '').trim();
  const toBranchId = String(input.toBranchId || '').trim();
  const date = String(input.date || '').trim();

  if (!fromBranchId || !toBranchId || !date) {
    throw new Error('fromBranchId, toBranchId, and date are required');
  }
  if (fromBranchId === toBranchId) {
    throw new Error('Source and destination branches must be different');
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('At least one transfer item is required');
  }

  const fromBranch = BRANCHES.find((b) => b.id === fromBranchId);
  const toBranch = BRANCHES.find((b) => b.id === toBranchId);

  const normalizedItems: BranchTransferItem[] = input.items.map((item, idx) => {
    const qty = Number(item.quantity);
    if (!item.modelId || !Number.isFinite(qty) || qty <= 0) {
      throw new Error('Each transfer item must have a valid modelId and positive quantity');
    }
    return {
      id: `item_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      modelId: String(item.modelId).trim(),
      modelName: String(item.modelName || item.modelId).trim(),
      quantity: Math.floor(qty),
      serialNos: Array.isArray(item.serialNos)
        ? item.serialNos.map((s) => String(s).trim()).filter(Boolean)
        : undefined,
      notes: item.notes ? String(item.notes).trim() : undefined,
      received: false,
    };
  });

  const created: BranchTransfer = {
    id: `trf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fromBranchId,
    fromBranchName: fromBranch?.name || fromBranchId,
    toBranchId,
    toBranchName: toBranch?.name || toBranchId,
    date,
    category: input.category === 'charger' ? 'charger' : 'battery',
    items: normalizedItems,
    partner: input.partner ? String(input.partner).trim() : undefined,
    notes: input.notes ? String(input.notes).trim() : undefined,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  const existing = await getBranchTransfers();
  const updatedList = [created, ...existing].slice(0, 300);
  await saveBranchTransfersList(updatedList);
  await logAudit('CREATE_BRANCH_TRANSFER', {
    transferId: created.id,
    fromBranchId,
    toBranchId,
    date,
    itemCount: normalizedItems.length,
  });

  return { created, transfers: updatedList };
}

export async function receiveBranchTransfers(
  selections: Array<{ transferId: string; itemIds?: string[] }>,
  receivedBy?: string
): Promise<{
  transfers: BranchTransfer[];
  newlyReceived: Array<{ transfer: BranchTransfer; items: BranchTransferItem[] }>;
}> {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('At least one transfer selection is required');
  }

  const now = new Date().toISOString();
  const existing = await getBranchTransfers();
  const selectionMap = new Map<string, Set<string> | null>();

  for (const sel of selections) {
    if (!sel?.transferId) continue;
    if (Array.isArray(sel.itemIds) && sel.itemIds.length > 0) {
      const prevSet = selectionMap.get(sel.transferId);
      if (prevSet === null) continue;
      const nextSet = prevSet ? new Set(prevSet) : new Set<string>();
      sel.itemIds.forEach((id) => nextSet.add(id));
      selectionMap.set(sel.transferId, nextSet);
    } else {
      selectionMap.set(sel.transferId, null); // null = receive all items in this transfer
    }
  }

  const newlyReceived: Array<{ transfer: BranchTransfer; items: BranchTransferItem[] }> = [];

  const updatedTransfers = existing.map((trf) => {
    if (!selectionMap.has(trf.id)) return trf;
    const itemFilter = selectionMap.get(trf.id);
    const receivedItemsForTrf: BranchTransferItem[] = [];

    const nextItems = trf.items.map((item) => {
      if (item.received) return item;
      const shouldReceive = !itemFilter || itemFilter.has(item.id);
      if (!shouldReceive) return item;
      const marked: BranchTransferItem = {
        ...item,
        received: true,
        receivedAt: now,
      };
      receivedItemsForTrf.push(marked);
      return marked;
    });

    if (receivedItemsForTrf.length === 0) return trf;

    const allReceived = nextItems.every((i) => Boolean(i.received));
    const nextTransfer: BranchTransfer = {
      ...trf,
      items: nextItems,
      status: allReceived ? 'received' : 'partial',
      receivedAt: allReceived ? now : trf.receivedAt,
      receivedBy: receivedBy || trf.receivedBy,
    };

    newlyReceived.push({ transfer: nextTransfer, items: receivedItemsForTrf });
    return nextTransfer;
  });

  if (newlyReceived.length > 0) {
    await saveBranchTransfersList(updatedTransfers);
    await logAudit('RECEIVE_BRANCH_TRANSFER', {
      count: newlyReceived.length,
      receivedBy: receivedBy || 'Branch User',
      timestamp: now,
    });
  }

  return { transfers: updatedTransfers, newlyReceived };
}

export async function deleteBranchTransfer(transferId: string): Promise<BranchTransfer[]> {
  const existing = await getBranchTransfers();
  const filtered = existing.filter((t) => t.id !== transferId);
  return saveBranchTransfersList(filtered);
}

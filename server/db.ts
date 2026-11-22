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
  DayRecord,
  TeamMember,
} from '../src/types/stock.ts';
import {
  DEFAULT_BATTERY_COLUMNS,
  DEFAULT_TEAM_MEMBERS,
  INITIAL_RECORD_31_10_2026,
  INITIAL_BASELINE_SERIALS,
} from '../src/types/stock.ts';

const { Pool } = pg;

interface DatabaseState {
  records: Record<string, DayRecord>;
  columns: BatteryColumn[];
  teamMembers: TeamMember[];
  serials: Record<string, BatterySerialItem>;
  chargerRecords?: Record<string, any>;
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

async function seedSupabaseBaseline(client: SupabaseClient): Promise<void> {
  const local = readLocalFile();
  const now = new Date().toISOString();

  // Ensure baseline + any locally captured records are seeded into Supabase (without overwriting existing newer Supabase rows)
  const localRecords = Object.values(local.records || {});
  const recordsToSeed = localRecords.length > 0 ? localRecords : [INITIAL_RECORD_31_10_2026];
  const recordRows = recordsToSeed
    .filter((rec) => rec && rec.date)
    .map((rec) => ({
      date: rec.date,
      data: rec,
      updated_at: rec.lastModified || now,
    }));

  const { error: recErr } = await client
    .from('stock_records')
    .upsert(recordRows, { onConflict: 'date', ignoreDuplicates: true });

  if (recErr) {
    throw recErr;
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
  };
}

export async function getAllRecords(): Promise<Record<string, DayRecord>> {
  if (isPostgresConnected && pgPool) {
    try {
      const res = await pgPool.query('SELECT date, data FROM stock_records ORDER BY updated_at DESC');
      const recordsMap: Record<string, DayRecord> = {};
      res.rows.forEach((row) => {
        recordsMap[row.date] = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      });
      return recordsMap;
    } catch (err) {
      console.error('[DBMS] PG getAllRecords error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('stock_records')
        .select('date, data')
        .order('updated_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        const recordsMap: Record<string, DayRecord> = {};
        data.forEach((row: any) => {
          recordsMap[row.date] = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        });
        return recordsMap;
      }
      if (error) console.error('[DBMS] Supabase getAllRecords error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase getAllRecords exception:', err);
    }
  }

  const local = readLocalFile();
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

export async function saveRecord(record: DayRecord): Promise<DayRecord> {
  if (!record || typeof record.date !== 'string' || !record.date.trim()) {
    throw new Error('Valid record date is required');
  }

  const updatedRecord: DayRecord = {
    ...record,
    lastModified: new Date().toISOString(),
  };

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO stock_records (date, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (date) DO UPDATE SET data = $2, updated_at = NOW()`,
        [record.date, JSON.stringify(updatedRecord)]
      );

      await pgPool.query('INSERT INTO audit_logs (action, details) VALUES ($1, $2)', [
        'SAVE_RECORD',
        JSON.stringify({ date: record.date }),
      ]);

      return updatedRecord;
    } catch (err) {
      console.error('[DBMS] PG saveRecord error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient.from('stock_records').upsert(
        {
          date: record.date,
          data: updatedRecord,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'date' }
      );
      if (!error) {
        await supabaseClient.from('audit_logs').insert({
          action: 'SAVE_RECORD',
          details: { date: record.date },
        });
        return updatedRecord;
      }
      console.error('[DBMS] Supabase saveRecord error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase saveRecord exception:', err);
    }
  }

  const local = readLocalFile();
  local.records[record.date] = updatedRecord;
  local.logs.unshift({
    action: 'SAVE_RECORD',
    date: record.date,
    timestamp: new Date().toISOString(),
  });
  writeLocalFile(local);
  return updatedRecord;
}

export async function deleteRecord(date: string): Promise<boolean> {
  if (typeof date !== 'string' || !date.trim()) return false;

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query('DELETE FROM stock_records WHERE date = $1', [date]);
      return true;
    } catch (err) {
      console.error('[DBMS] PG deleteRecord error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { error } = await supabaseClient.from('stock_records').delete().eq('date', date);
      if (!error) return true;
      console.error('[DBMS] Supabase deleteRecord error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase deleteRecord exception:', err);
    }
  }

  const local = readLocalFile();
  if (local.records[date]) {
    delete local.records[date];
    writeLocalFile(local);
    return true;
  }
  return false;
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
  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO battery_metadata (key, data, updated_at)
         VALUES ('columns', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET data = $1, updated_at = NOW()`,
        [JSON.stringify(columns)]
      );
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
      if (!error) return columns;
      console.error('[DBMS] Supabase saveColumns error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase saveColumns exception:', err);
    }
  }

  const local = readLocalFile();
  local.columns = columns;
  writeLocalFile(local);
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
  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO battery_metadata (key, data, updated_at)
         VALUES ('team_members', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET data = $1, updated_at = NOW()`,
        [JSON.stringify(team)]
      );
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
      if (!error) return team;
      console.error('[DBMS] Supabase saveTeamMembers error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase saveTeamMembers exception:', err);
    }
  }

  const local = readLocalFile();
  local.teamMembers = team;
  writeLocalFile(local);
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

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO battery_serials (serial_no, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (serial_no) DO UPDATE SET data = $2, updated_at = NOW()`,
        [item.serialNo, JSON.stringify(item)]
      );
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
      if (!error) return item;
      console.error('[DBMS] Supabase saveSerial error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase saveSerial exception:', err);
    }
  }

  const local = readLocalFile();
  local.serials = local.serials || {};
  local.serials[item.serialNo] = item;
  writeLocalFile(local);
  return item;
}

export async function bulkSaveSerials(items: BatterySerialItem[]): Promise<BatterySerialItem[]> {
  const validItems = items.filter(
    (item) => item && typeof item.serialNo === 'string' && item.serialNo.trim()
  );
  if (validItems.length === 0) return [];

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
      if (!error) return validItems;
      console.error('[DBMS] Supabase bulkSaveSerials error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase bulkSaveSerials exception:', err);
    }
  }

  for (const item of validItems) {
    await saveSerial(item);
  }
  return validItems;
}

export async function deleteSerial(serialNo: string): Promise<boolean> {
  if (typeof serialNo !== 'string' || !serialNo.trim()) return false;

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query('DELETE FROM battery_serials WHERE serial_no = $1', [serialNo]);
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
      if (!error) return true;
      console.error('[DBMS] Supabase deleteSerial error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase deleteSerial exception:', err);
    }
  }

  const local = readLocalFile();
  if (local.serials && local.serials[serialNo]) {
    delete local.serials[serialNo];
    writeLocalFile(local);
    return true;
  }
  return false;
}

export async function getChargerRecords(): Promise<Record<string, any>> {
  if (isPostgresConnected && pgPool) {
    try {
      const res = await pgPool.query("SELECT data FROM battery_metadata WHERE key = 'charger_records'");
      if (res.rows.length > 0) {
        return typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
      }
      return {};
    } catch (err) {
      console.error('[DBMS] PG getChargerRecords error:', err);
    }
  }

  if (isSupabaseReady && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('battery_metadata')
        .select('data')
        .eq('key', 'charger_records')
        .maybeSingle();
      if (!error) {
        if (!data?.data) return {};
        return typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
      }
      console.error('[DBMS] Supabase getChargerRecords error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase getChargerRecords exception:', err);
    }
  }

  const local = readLocalFile();
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

  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO battery_metadata (key, data, updated_at)
         VALUES ('charger_records', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET data = $1, updated_at = NOW()`,
        [JSON.stringify(merged)]
      );
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
        return { key: compositeKey, branchId, date, record, updatedAt };
      }
      console.error('[DBMS] Supabase saveChargerRecord error:', error.message);
    } catch (err) {
      console.error('[DBMS] Supabase saveChargerRecord exception:', err);
    }
  }

  const local = readLocalFile();
  local.chargerRecords = merged;
  writeLocalFile(local);
  return { key: compositeKey, branchId, date, record, updatedAt };
}

export async function backupPermanentCodebase(
  records?: Record<string, DayRecord>,
  serials?: Record<string, BatterySerialItem>
): Promise<{ success: boolean; timestamp: string; recordCount: number; serialCount: number }> {
  const existingServerRecords = await getAllRecords();
  const mergedRecords: Record<string, DayRecord> = { ...existingServerRecords };

  if (records && Object.keys(records).length > 0) {
    for (const [date, incoming] of Object.entries(records)) {
      const current = mergedRecords[date];
      if (!current) {
        mergedRecords[date] = incoming;
      } else {
        const currentTs = current.lastModified ? Date.parse(current.lastModified) : 0;
        const incomingTs = incoming.lastModified ? Date.parse(incoming.lastModified) : 0;
        if (incomingTs >= currentTs) {
          mergedRecords[date] = incoming;
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
  writeLocalFile(local);

  if (isPostgresConnected && pgPool) {
    try {
      for (const rec of Object.values(mergedRecords)) {
        await saveRecord(rec);
      }
      if (serials) {
        await bulkSaveSerials(Object.values(serials));
      }
    } catch (e) {
      console.warn('[DBMS] PG backup warning:', e);
    }
  } else if (isSupabaseReady && supabaseClient) {
    try {
      const rows = Object.values(mergedRecords).map((rec) => ({
        date: rec.date,
        data: rec,
        updated_at: new Date().toISOString(),
      }));
      if (rows.length > 0) {
        await supabaseClient.from('stock_records').upsert(rows, { onConflict: 'date' });
      }
      if (serials) {
        await bulkSaveSerials(Object.values(serials));
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

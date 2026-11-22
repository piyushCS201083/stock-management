import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
  logs: any[];
}

let pgPool: pg.Pool | null = null;
let isPostgresConnected = false;

let supabaseClient: SupabaseClient | null = null;
let isSupabaseReady = false;
let supabaseNeedsSchema = false;
let supabaseNeedsServiceKey = false;
let supabaseProjectRef = '';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
  return (
    dbUrl.includes('[YOUR-DATABASE-PASSWORD]') ||
    dbUrl.includes('<YOUR-DATABASE-PASSWORD>') ||
    dbUrl.includes('YOUR_PASSWORD')
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
  const { error: recErr } = await client
    .from('stock_records')
    .upsert(
      {
        date: INITIAL_RECORD_31_10_2026.date,
        data: INITIAL_RECORD_31_10_2026,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'date', ignoreDuplicates: true }
    );

  if (recErr) {
    throw recErr;
  }

  await client.from('battery_metadata').upsert(
    [
      {
        key: 'columns',
        data: DEFAULT_BATTERY_COLUMNS,
        updated_at: new Date().toISOString(),
      },
      {
        key: 'team_members',
        data: DEFAULT_TEAM_MEMBERS,
        updated_at: new Date().toISOString(),
      },
    ],
    { onConflict: 'key', ignoreDuplicates: true }
  );

  const serialRows = Object.values(INITIAL_BASELINE_SERIALS).map((item) => ({
    serial_no: item.serialNo,
    data: item,
    updated_at: new Date().toISOString(),
  }));

  if (serialRows.length > 0) {
    await client
      .from('battery_serials')
      .upsert(serialRows, { onConflict: 'serial_no', ignoreDuplicates: true });
  }
}

export async function initDb(): Promise<{
  type: 'postgresql' | 'supabase_rest' | 'file_dbms';
  ready: boolean;
  error?: string;
}> {
  const dbUrl = process.env.DATABASE_URL?.trim();
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
        '[DBMS] Direct PostgreSQL connection unavailable, checking Supabase HTTPS API / local fallback:',
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

  // Tier 2: Supabase HTTPS REST API via @supabase/supabase-js
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  const supabaseKey = serviceRoleKey || publishableKey;

  if (supabaseUrl && supabaseKey) {
    supabaseProjectRef = parseSupabaseProjectRef(supabaseUrl);
    try {
      const client = createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      supabaseClient = client;

      const { error } = await client
        .from('stock_records')
        .select('date', { count: 'exact', head: true });

      if (error) {
        const errCode = error.code || '';
        const errMsg = error.message || '';
        if (errCode === 'PGRST205' || errCode === '42P01' || errMsg.includes('schema cache')) {
          supabaseNeedsSchema = true;
          isSupabaseReady = false;
          console.warn(
            '[DBMS] Supabase project reachable, but tables are not created yet. Run supabase/migrations/20261122000000_init_stock_register.sql.'
          );
        } else if (
          errCode === '42501' ||
          errCode === 'PGRST301' ||
          errMsg.toLowerCase().includes('permission') ||
          errMsg.toLowerCase().includes('row-level security') ||
          errMsg.toLowerCase().includes('api key')
        ) {
          supabaseNeedsServiceKey = true;
          isSupabaseReady = false;
          console.warn(
            '[DBMS] Supabase RLS/auth blocked query. Set SUPABASE_SERVICE_ROLE_KEY in server environment.'
          );
        } else {
          console.warn('[DBMS] Supabase check warning:', errMsg);
        }
      } else {
        try {
          await seedSupabaseBaseline(client);
          isSupabaseReady = true;
          supabaseNeedsSchema = false;
          supabaseNeedsServiceKey = false;
          console.log('[DBMS] Connected to Supabase HTTPS REST API:', supabaseUrl);
          return { type: 'supabase_rest', ready: true };
        } catch (seedErr: any) {
          const seedCode = seedErr?.code || '';
          const seedMsg = seedErr?.message || '';
          if (seedCode === '42501' || seedMsg.toLowerCase().includes('row-level security')) {
            supabaseNeedsServiceKey = true;
            isSupabaseReady = false;
            console.warn(
              '[DBMS] Supabase table write blocked by RLS. Set SUPABASE_SERVICE_ROLE_KEY in server environment.'
            );
          } else {
            isSupabaseReady = true;
            console.warn('[DBMS] Supabase seed warning:', seedMsg);
            return { type: 'supabase_rest', ready: true };
          }
        }
      }
    } catch (err: any) {
      console.warn('[DBMS] Supabase HTTPS client init failed:', err.message);
    }
  }

  // Tier 3: Persistent local JSON file fallback
  readLocalFile();
  console.log('[DBMS] Using persistent Local File DBMS at:', DATA_FILE);
  return { type: 'file_dbms', ready: true };
}

export function getDbStatus() {
  const isPg = Boolean(isPostgresConnected && pgPool);
  const dbUrl = process.env.DATABASE_URL?.trim();
  const isPgUrl = Boolean(
    dbUrl &&
      !isPlaceholderDatabaseUrl(dbUrl) &&
      (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))
  );
  const supabaseConfigured = Boolean(
    process.env.SUPABASE_URL?.trim() &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
        process.env.SUPABASE_SECRET_KEY?.trim() ||
        process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
        process.env.SUPABASE_ANON_KEY?.trim())
  );

  let engine = 'Persistent DBMS (Local JSON Cache)';
  let storageLocation = DATA_FILE;

  if (isPg) {
    engine = 'PostgreSQL (Supabase / Cloud Direct)';
    storageLocation = 'Remote PostgreSQL Database';
  } else if (isSupabaseReady && supabaseClient) {
    engine = `Supabase PostgreSQL (${supabaseProjectRef || 'Cloud REST'})`;
    storageLocation = process.env.SUPABASE_URL?.trim() || 'Supabase Cloud';
  } else if (supabaseConfigured && supabaseNeedsSchema) {
    engine = 'Supabase Connected (Awaiting SQL Schema) · Local Fallback';
  } else if (supabaseConfigured && supabaseNeedsServiceKey) {
    engine = 'Supabase Connected (Service Role Key Needed) · Local Fallback';
  }

  return {
    engine,
    status: 'connected',
    hasPostgresUrl: isPgUrl,
    supabaseConfigured,
    supabaseReady: isSupabaseReady,
    supabaseNeedsSchema,
    supabaseNeedsServiceKey,
    supabaseProjectRef:
      supabaseProjectRef || parseSupabaseProjectRef(process.env.SUPABASE_URL?.trim()) || 'anaibpuhnxlwfeypprlb',
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

export async function backupPermanentCodebase(
  records?: Record<string, DayRecord>,
  serials?: Record<string, BatterySerialItem>
): Promise<{ success: boolean; timestamp: string; recordCount: number; serialCount: number }> {
  const local = readLocalFile();
  if (records && Object.keys(records).length > 0) {
    local.records = { ...local.records, ...records };
  }
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
      if (records) {
        for (const [, rec] of Object.entries(records)) {
          await saveRecord(rec);
        }
      }
      if (serials) {
        await bulkSaveSerials(Object.values(serials));
      }
    } catch (e) {
      console.warn('[DBMS] PG backup warning:', e);
    }
  } else if (isSupabaseReady && supabaseClient) {
    try {
      if (records && Object.keys(records).length > 0) {
        const rows = Object.values(records).map((rec) => ({
          date: rec.date,
          data: rec,
          updated_at: new Date().toISOString(),
        }));
        await supabaseClient.from('stock_records').upsert(rows, { onConflict: 'date' });
      }
      if (serials && Object.keys(serials).length > 0) {
        await bulkSaveSerials(Object.values(serials));
      }
    } catch (e) {
      console.warn('[DBMS] Supabase backup warning:', e);
    }
  }

  return {
    success: true,
    timestamp: new Date().toISOString(),
    recordCount: Object.keys(local.records).length,
    serialCount: Object.keys(local.serials).length,
  };
}

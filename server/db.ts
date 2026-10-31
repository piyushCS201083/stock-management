import fs from 'fs';
import path from 'path';
import pg from 'pg';
import {
  BatteryColumn,
  BatterySerialItem,
  BatteryMovementEvent,
  DayRecord,
  DEFAULT_BATTERY_COLUMNS,
  DEFAULT_TEAM_MEMBERS,
  INITIAL_RECORD_31_10_2026,
  INITIAL_BASELINE_SERIALS,
  TeamMember,
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

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Fallback in-memory/file storage with 31-10-2026 official baseline
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
        // Ensure 31-10-2026 baseline is present
        if (parsed.records && !parsed.records[INITIAL_RECORD_31_10_2026.date]) {
          parsed.records[INITIAL_RECORD_31_10_2026.date] = INITIAL_RECORD_31_10_2026;
          writeLocalFile(parsed);
        }
        // Ensure team members only contain Piyush Shivhare (Owner & Admin) with 9009156696
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

  // Initial fresh seed for 31-10-2026
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

export async function initDb(): Promise<{ type: 'postgresql' | 'file_dbms'; ready: boolean; error?: string }> {
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl) {
    try {
      console.log('[DBMS] Connecting to PostgreSQL on Render / Cloud...');
      pgPool = new Pool({
        connectionString: dbUrl,
        ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });

      // Verify connection
      const client = await pgPool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS stock_records (
            date VARCHAR(50) PRIMARY KEY,
            data JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS battery_metadata (
            key VARCHAR(50) PRIMARY KEY,
            data JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS battery_serials (
            serial_no VARCHAR(100) PRIMARY KEY,
            data JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            action VARCHAR(100) NOT NULL,
            details JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Upsert 31-10-2026 official baseline record
        console.log('[DBMS] Inserting verified 31-10-2026 stock baseline into PostgreSQL...');
        await client.query(
          `INSERT INTO stock_records (date, data, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (date) DO UPDATE SET data = $2, updated_at = NOW()`,
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
           ON CONFLICT (key) DO UPDATE SET data = $1`,
          [JSON.stringify(DEFAULT_TEAM_MEMBERS)]
        );

        isPostgresConnected = true;
        console.log('[DBMS] Successfully connected to PostgreSQL database!');
        return { type: 'postgresql', ready: true };
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.warn('[DBMS] PostgreSQL connection failed, falling back to persistent file DBMS:', err.message);
      isPostgresConnected = false;
      pgPool = null;
    }
  }

  // Fallback to local persistent JSON file
  readLocalFile();
  console.log('[DBMS] Using persistent Cloud/Local File DBMS at:', DATA_FILE);
  return { type: 'file_dbms', ready: true };
}

export function getDbStatus() {
  const isPg = Boolean(isPostgresConnected && pgPool);
  return {
    engine: isPg ? 'PostgreSQL (Cloud / Render)' : 'Persistent DBMS (Render Disk / JSON)',
    status: 'connected',
    hasPostgresUrl: Boolean(process.env.DATABASE_URL),
    storageLocation: isPg ? 'Remote Cloud Database' : DATA_FILE,
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

  const local = readLocalFile();
  return local.records;
}

export async function getRecord(date: string): Promise<DayRecord | null> {
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

  const local = readLocalFile();
  return local.records[date] || null;
}

export async function saveRecord(record: DayRecord): Promise<DayRecord> {
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

      await pgPool.query(
        'INSERT INTO audit_logs (action, details) VALUES ($1, $2)',
        ['SAVE_RECORD', JSON.stringify({ date: record.date })]
      );

      return updatedRecord;
    } catch (err) {
      console.error('[DBMS] PG saveRecord error:', err);
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
  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query('DELETE FROM stock_records WHERE date = $1', [date]);
      return true;
    } catch (err) {
      console.error('[DBMS] PG deleteRecord error:', err);
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
    } catch (e) {
      // ignore
    }
  } else {
    const local = readLocalFile();
    local.logs.unshift({ action, details, timestamp: new Date().toISOString() });
    if (local.logs.length > 100) local.logs = local.logs.slice(0, 100);
    writeLocalFile(local);
  }
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

  const local = readLocalFile();
  return local.serials || {};
}

export async function getSerial(serialNo: string): Promise<BatterySerialItem | null> {
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

  const local = readLocalFile();
  return local.serials?.[serialNo] || null;
}

export async function saveSerial(item: BatterySerialItem): Promise<BatterySerialItem> {
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

  const local = readLocalFile();
  local.serials = local.serials || {};
  local.serials[item.serialNo] = item;
  writeLocalFile(local);
  return item;
}

export async function bulkSaveSerials(items: BatterySerialItem[]): Promise<BatterySerialItem[]> {
  for (const item of items) {
    await saveSerial(item);
  }
  return items;
}

export async function deleteSerial(serialNo: string): Promise<boolean> {
  if (isPostgresConnected && pgPool) {
    try {
      await pgPool.query('DELETE FROM battery_serials WHERE serial_no = $1', [serialNo]);
      return true;
    } catch (err) {
      console.error('[DBMS] PG deleteSerial error:', err);
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

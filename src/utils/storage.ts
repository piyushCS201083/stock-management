import {
  BatteryColumn,
  DayRecord,
  DEFAULT_BATTERY_COLUMNS,
  DEFAULT_BRANCH_ID,
  DEFAULT_TEAM_MEMBERS,
  INITIAL_RECORD_31_10_2026,
  TeamMember,
  getBatteryRecordKey,
  parseBatteryRecordKey,
} from '../types/stock';
import { addDaysToDateString, toISODateString } from './date';

const STORAGE_KEYS = {
  RECORDS: 'battery_stock_records_v3_ist',
  COLUMNS: 'battery_stock_columns_v3',
  TEAM: 'battery_stock_team_v3',
  SELECTED_DATE: 'battery_stock_selected_date_v3',
};

// Calculate summary totals for a day's record
export function calculateRecordTotals(record: DayRecord, columns: BatteryColumn[]) {
  // Main columns total (excluding repair & service)
  let openingStockTotal = 0;
  let inStockTotal = 0;
  let outStockTotal = 0;
  let closingStockTotal = 0;

  const closingStock: Record<string, number> = {};

  columns.forEach((col) => {
    const open = record.stock[col.id] || 0;
    const inward = record.inStock[col.id] || 0;
    const outward = record.outStock[col.id] || 0; // Negative or positive
    
    // Outward in user's excel is represented as negative number (e.g., -1), so closing = open + inward + outward
    const closing = open + inward + outward;
    closingStock[col.id] = closing;

    openingStockTotal += open;
    inStockTotal += inward;
    outStockTotal += outward;
    closingStockTotal += closing;
  });

  // Special columns: repair & service
  const repairOpen = record.stock['repair'] || 0;
  const repairIn = record.inStock['repair'] || 0;
  const repairOut = record.outStock['repair'] || 0;
  const repairClosing = repairOpen + repairIn + repairOut;
  closingStock['repair'] = repairClosing;

  const serviceOpen = record.stock['service'] || 0;
  const serviceIn = record.inStock['service'] || 0;
  const serviceOut = record.outStock['service'] || 0;
  const serviceClosing = serviceOpen + serviceIn + serviceOut;
  closingStock['service'] = serviceClosing;

  return {
    openingStockTotal,
    inStockTotal,
    outStockTotal,
    closingStockTotal,
    closingStock,
    repair: {
      open: repairOpen,
      in: repairIn,
      out: repairOut,
      closing: repairClosing,
    },
    service: {
      open: serviceOpen,
      in: serviceIn,
      out: serviceOut,
      closing: serviceClosing,
    },
  };
}

// Auto generate causes summary list if not manually overridden
export function generateAutoCausesSummary(record: DayRecord, columns: BatteryColumn[], type: 'in' | 'out'): string {
  const causes: string[] = [];
  const map = type === 'in' ? record.inCause : record.outCause;
  const stockMap = type === 'in' ? record.inStock : record.outStock;

  columns.forEach((col) => {
    const val = stockMap[col.id];
    const text = map[col.id];
    if (val && text) {
      causes.push(`${col.name}: ${text}`);
    } else if (text) {
      causes.push(text);
    }
  });

  return causes.map((c, i) => `${i + 1}. ${c}`).join('\n');
}

// Load records from LocalStorage (with clean 31-10-2026 baseline)
export function loadRecords(): Record<string, DayRecord> {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.RECORDS);
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed && Object.keys(parsed).length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load records from storage', e);
  }

  // Seed with 31-10-2026 official photo baseline
  const initialMap: Record<string, DayRecord> = {
    [INITIAL_RECORD_31_10_2026.date]: INITIAL_RECORD_31_10_2026,
  };
  saveRecords(initialMap);
  return initialMap;
}

export function saveRecords(records: Record<string, DayRecord>) {
  try {
    localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
  } catch (e) {
    console.error('Failed to save records', e);
  }
}

export function loadColumns(): BatteryColumn[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.COLUMNS);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load columns', e);
  }
  return DEFAULT_BATTERY_COLUMNS;
}

export function saveColumns(columns: BatteryColumn[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.COLUMNS, JSON.stringify(columns));
  } catch (e) {
    console.error('Failed to save columns', e);
  }
}

export function loadTeamMembers(): TeamMember[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.TEAM);
    if (data) {
      const parsed: TeamMember[] = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Purge legacy placeholder team members removed per user request
        const removedIds = ['luvkush', 'sonu_bhaiya', 'nikhil', 'reena_ent', 'store_staff'];
        const filtered = parsed.filter(m => !removedIds.includes(m.id));

        // Always ensure Piyush Shivhare is properly configured with 9009156696 & Owner & Admin
        const hasPiyush = filtered.some(m => m.name.toLowerCase().includes('piyush') || m.id.includes('piyush'));
        let finalTeam: TeamMember[];
        if (hasPiyush) {
          finalTeam = filtered.map(m => {
            if (m.name.toLowerCase().includes('piyush') || m.id.includes('piyush')) {
              return {
                ...m,
                id: 'piyush_shivhare',
                name: 'Piyush Shivhare',
                role: 'Owner & Admin',
                phone: '9009156696',
                active: true,
              };
            }
            return m;
          });
        } else {
          finalTeam = DEFAULT_TEAM_MEMBERS;
        }

        saveTeamMembers(finalTeam);
        return finalTeam;
      }
    }
  } catch (e) {
    console.error('Failed to load team members', e);
  }
  saveTeamMembers(DEFAULT_TEAM_MEMBERS);
  return DEFAULT_TEAM_MEMBERS;
}

export function saveTeamMembers(team: TeamMember[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.TEAM, JSON.stringify(team));
  } catch (e) {
    console.error('Failed to save team members', e);
  }
}

export function createEmptyDayRecord(
  date: string,
  columns: BatteryColumn[],
  branchId = 'chandravadni_naka'
): DayRecord {
  const stock: Record<string, number> = {};
  const inStock: Record<string, number> = {};
  const outStock: Record<string, number> = {};

  columns.forEach((col) => {
    stock[col.id] = 0;
    inStock[col.id] = 0;
    outStock[col.id] = 0;
  });

  stock['repair'] = 0;
  inStock['repair'] = 0;
  outStock['repair'] = 0;

  stock['service'] = 0;
  inStock['service'] = 0;
  outStock['service'] = 0;

  return {
    date,
    branchId,
    stock,
    inStock,
    inCause: {},
    outStock,
    outCause: {},
    totalInCause: '',
    totalOutCause: '',
    repairInCause: '',
    repairOutCause: '',
    lastModified: new Date().toISOString(),
    notes: `Initialized ledger for ${branchId} (${date})`,
  };
}

// Initialize a new day carrying over closing stock from previous day
export function createNextDayRecord(prevRecord: DayRecord, columns: BatteryColumn[]): DayRecord {
  const nextDate = addDaysToDateString(prevRecord.date, 1);
  const totals = calculateRecordTotals(prevRecord, columns);

  const newStock: Record<string, number> = {};
  const newInStock: Record<string, number> = {};
  const newOutStock: Record<string, number> = {};

  columns.forEach((col) => {
    newStock[col.id] = totals.closingStock[col.id] || 0;
    newInStock[col.id] = 0;
    newOutStock[col.id] = 0;
  });

  // Repair & Service carryover
  newStock['repair'] = totals.closingStock['repair'] || 0;
  newInStock['repair'] = 0;
  newOutStock['repair'] = 0;

  newStock['service'] = totals.closingStock['service'] || 0;
  newInStock['service'] = 0;
  newOutStock['service'] = 0;

  return {
    date: nextDate,
    branchId: prevRecord.branchId || 'chandravadni_naka',
    stock: newStock,
    inStock: newInStock,
    inCause: {},
    outStock: newOutStock,
    outCause: {},
    totalInCause: '',
    totalOutCause: '',
    repairInCause: '',
    repairOutCause: '',
    lastModified: new Date().toISOString(),
    notes: `Carried forward from ${prevRecord.date} closing stock`,
  };
}

function parseTimestampMs(ts?: string): number {
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Merge local & remote DayRecord maps by lastModified timestamp.
 * Protected keys (currently saving or pending retry) always preserve the local copy.
 */
export function mergeRecordsByTimestamp(
  localMap: Record<string, DayRecord>,
  remoteMap: Record<string, DayRecord>,
  protectedKeys?: Set<string>
): { merged: Record<string, DayRecord>; localNewerKeys: string[] } {
  const merged: Record<string, DayRecord> = {};
  const localNewerKeys: string[] = [];
  const allKeys = new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})]);

  allKeys.forEach((key) => {
    const localRec = localMap?.[key];
    const remoteRec = remoteMap?.[key];

    if (localRec && !remoteRec) {
      merged[key] = localRec;
      localNewerKeys.push(key);
      return;
    }
    if (!localRec && remoteRec) {
      merged[key] = remoteRec;
      return;
    }
    if (!localRec || !remoteRec) return;

    if (protectedKeys?.has(key)) {
      merged[key] = localRec;
      localNewerKeys.push(key);
      return;
    }

    const localTs = parseTimestampMs(localRec.lastModified);
    const remoteTs = parseTimestampMs(remoteRec.lastModified);

    if (localTs > remoteTs) {
      merged[key] = localRec;
      localNewerKeys.push(key);
    } else {
      merged[key] = remoteRec;
    }
  });

  return { merged, localNewerKeys };
}

/**
 * Recalculate Opening Stock (`stock`) on every chronologically later day for `branchId`
 * starting from `fromDate`, while keeping all IN/OUT transactions & remarks untouched.
 */
export function cascadeBranchOpeningStock(
  recordsMap: Record<string, DayRecord>,
  branchId: string,
  fromDate: string,
  columns: BatteryColumn[]
): { updatedRecordsMap: Record<string, DayRecord>; changedRecords: DayRecord[] } {
  const normalizedBranch = branchId && branchId.trim() ? branchId.trim() : DEFAULT_BRANCH_ID;
  const branchEntries: Array<{ key: string; rec: DayRecord; iso: string }> = [];

  Object.entries(recordsMap).forEach(([key, rec]) => {
    if (!rec) return;
    const parsed = parseBatteryRecordKey(key);
    const recBranch = rec.branchId || parsed.branchId || DEFAULT_BRANCH_ID;
    if (recBranch === normalizedBranch) {
      const cleanDate = rec.date || parsed.date;
      branchEntries.push({
        key: getBatteryRecordKey(normalizedBranch, cleanDate),
        rec: { ...rec, date: cleanDate, branchId: normalizedBranch },
        iso: toISODateString(cleanDate),
      });
    }
  });

  branchEntries.sort((a, b) => a.iso.localeCompare(b.iso));
  const startIdx = branchEntries.findIndex((e) => e.rec.date === fromDate);
  if (startIdx === -1 || startIdx >= branchEntries.length - 1) {
    return { updatedRecordsMap: recordsMap, changedRecords: [] };
  }

  const nextMap = { ...recordsMap };
  const changedRecords: DayRecord[] = [];
  const allColIds = [...columns.map((c) => c.id), 'repair', 'service'];

  for (let i = startIdx; i < branchEntries.length - 1; i++) {
    const prevRec = nextMap[branchEntries[i].key] || branchEntries[i].rec;
    const nextEntry = branchEntries[i + 1];
    const nextRec = nextMap[nextEntry.key] || nextEntry.rec;
    const prevTotals = calculateRecordTotals(prevRec, columns);

    let hasStockDiff = false;
    const updatedOpening: Record<string, number> = { ...nextRec.stock };

    allColIds.forEach((id) => {
      const expectedOpening = prevTotals.closingStock[id] || 0;
      if ((updatedOpening[id] || 0) !== expectedOpening) {
        updatedOpening[id] = expectedOpening;
        hasStockDiff = true;
      }
    });

    if (hasStockDiff) {
      const updatedNext: DayRecord = {
        ...nextRec,
        branchId: normalizedBranch,
        stock: updatedOpening,
        lastModified: new Date().toISOString(),
      };
      nextMap[nextEntry.key] = updatedNext;
      changedRecords.push(updatedNext);
    }
  }

  return { updatedRecordsMap: nextMap, changedRecords };
}

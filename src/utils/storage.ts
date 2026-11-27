import {
  BatteryColumn,
  BatteryMovementEvent,
  BatterySerialItem,
  DayRecord,
  DEFAULT_BATTERY_COLUMNS,
  DEFAULT_BRANCH_ID,
  DEFAULT_TEAM_MEMBERS,
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

export const STORAGE_KEY_RESET_EPOCH = 'battery_app_reset_epoch';

export function getLocalResetEpoch(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_RESET_EPOCH);
  } catch {
    return null;
  }
}

export function setLocalResetEpoch(epoch: string) {
  try {
    localStorage.setItem(STORAGE_KEY_RESET_EPOCH, epoch);
  } catch {}
}

export function clearAllLocalStockStorage(resetEpoch?: string) {
  try {
    localStorage.removeItem(STORAGE_KEYS.RECORDS);
    localStorage.removeItem(STORAGE_KEYS.COLUMNS);
    localStorage.removeItem(STORAGE_KEYS.TEAM);
    localStorage.removeItem(STORAGE_KEYS.SELECTED_DATE);
    localStorage.removeItem('battery_stock_serials_v3');
    localStorage.removeItem('charger_stock_records_v1');
    localStorage.removeItem('vehicle_stock_records_v1');
    localStorage.removeItem('battery_branch_transfers_v1');
    localStorage.removeItem('battery_pending_sync_keys_v1');
    localStorage.removeItem('battery_pending_serial_sync_keys_v1');
    if (resetEpoch) {
      localStorage.setItem(STORAGE_KEY_RESET_EPOCH, resetEpoch);
    } else {
      localStorage.removeItem(STORAGE_KEY_RESET_EPOCH);
    }
  } catch (e) {
    console.error('Failed to clear local stock storage', e);
  }
}

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

// Load records from LocalStorage (clean start with no legacy baseline data)
export function loadRecords(): Record<string, DayRecord> {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.RECORDS);
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load records from storage', e);
  }

  return {};
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
  branchId = 'chandravadni_naka',
  options?: { isAutoGenerated?: boolean; baseTimestamp?: string }
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

  const isAuto = Boolean(options?.isAutoGenerated);

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
    lastModified: isAuto ? options?.baseTimestamp || '1970-01-01T00:00:00.000Z' : new Date().toISOString(),
    notes: `Initialized ledger for ${branchId} (${date})`,
    ...(isAuto ? { isAutoGenerated: true } : {}),
  };
}

// Initialize a new day carrying over closing stock from previous day
export function createNextDayRecord(
  prevRecord: DayRecord,
  columns: BatteryColumn[],
  options?: { isAutoGenerated?: boolean }
): DayRecord {
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

  const isAuto = Boolean(options?.isAutoGenerated);

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
    lastModified: isAuto ? prevRecord.lastModified || '1970-01-01T00:00:00.000Z' : new Date().toISOString(),
    notes: `Carried forward from ${prevRecord.date} closing stock`,
    ...(isAuto ? { isAutoGenerated: true } : {}),
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
      if (!localRec.isAutoGenerated) {
        localNewerKeys.push(key);
      }
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

    // Never allow an unedited auto-generated local stub to overwrite a saved remote record
    if (localRec.isAutoGenerated && !remoteRec.isAutoGenerated) {
      merged[key] = remoteRec;
      return;
    }
    if (!localRec.isAutoGenerated && remoteRec.isAutoGenerated) {
      merged[key] = localRec;
      localNewerKeys.push(key);
      return;
    }

    const localTs = parseTimestampMs(localRec.lastModified);
    const remoteTs = parseTimestampMs(remoteRec.lastModified);

    if (localTs > remoteTs) {
      merged[key] = localRec;
      if (!localRec.isAutoGenerated) {
        localNewerKeys.push(key);
      }
    } else {
      merged[key] = remoteRec;
    }
  });

  return { merged, localNewerKeys };
}

/**
 * Ensures `targetDate`'s opening Stock row stays synced with the closing balance
 * of the latest preceding recorded date whenever `targetDate` has no edits yet
 * or the prior entry was updated more recently.
 */
export function syncTodayOpeningFromLastEntry(
  recordsMap: Record<string, DayRecord>,
  branchId: string,
  targetDate: string,
  columns: BatteryColumn[]
): { updatedMap: Record<string, DayRecord>; syncedRecord?: DayRecord } {
  const normalizedBranch = branchId && branchId.trim() ? branchId.trim() : DEFAULT_BRANCH_ID;
  const targetKey = getBatteryRecordKey(normalizedBranch, targetDate);
  const targetRec = recordsMap[targetKey];
  if (!targetRec) return { updatedMap: recordsMap };

  const targetIso = toISODateString(targetDate);
  const priorEntries: Array<{ iso: string; rec: DayRecord }> = [];

  Object.entries(recordsMap).forEach(([k, r]) => {
    if (!r) return;
    const parsed = parseBatteryRecordKey(k);
    const bId = r.branchId || parsed.branchId || DEFAULT_BRANCH_ID;
    const d = r.date || parsed.date;
    if (bId === normalizedBranch && d !== targetDate) {
      const iso = toISODateString(d);
      if (iso < targetIso) {
        priorEntries.push({ iso, rec: { ...r, branchId: normalizedBranch, date: d } });
      }
    }
  });

  if (priorEntries.length === 0) return { updatedMap: recordsMap };
  priorEntries.sort((a, b) => a.iso.localeCompare(b.iso));
  const lastPrior = priorEntries[priorEntries.length - 1].rec;

  const targetTotals = calculateRecordTotals(targetRec, columns);
  const hasTransactions =
    targetTotals.inStockTotal !== 0 ||
    targetTotals.outStockTotal !== 0 ||
    targetTotals.repair.in !== 0 ||
    targetTotals.repair.out !== 0 ||
    targetTotals.service.in !== 0 ||
    targetTotals.service.out !== 0;

  const prevTs = parseTimestampMs(lastPrior.lastModified);
  const targetTs = parseTimestampMs(targetRec.lastModified);
  const shouldSyncOpening =
    Boolean(targetRec.isAutoGenerated) || !hasTransactions || prevTs > targetTs;

  if (!shouldSyncOpening) {
    return { updatedMap: recordsMap };
  }

  const prevTotals = calculateRecordTotals(lastPrior, columns);
  const allColIds = [...columns.map((c) => c.id), 'repair', 'service'];
  const nextOpening: Record<string, number> = { ...targetRec.stock };
  let diff = false;

  allColIds.forEach((id) => {
    const expected = prevTotals.closingStock[id] || 0;
    if ((nextOpening[id] || 0) !== expected) {
      nextOpening[id] = expected;
      diff = true;
    }
  });

  if (!diff) return { updatedMap: recordsMap };

  const syncedRecord: DayRecord = {
    ...targetRec,
    branchId: normalizedBranch,
    stock: nextOpening,
    lastModified: targetRec.isAutoGenerated ? lastPrior.lastModified || new Date().toISOString() : new Date().toISOString(),
  };

  return {
    updatedMap: { ...recordsMap, [targetKey]: syncedRecord },
    syncedRecord,
  };
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

function getSerialLatestTimestampMs(item?: BatterySerialItem): number {
  if (!item || !Array.isArray(item.history) || item.history.length === 0) return 0;
  let maxTs = 0;
  for (const evt of item.history) {
    const ms = parseTimestampMs(evt?.timestamp);
    if (ms > maxTs) maxTs = ms;
  }
  return maxTs;
}

function mergeUniqueSerialHistory(
  a: BatteryMovementEvent[] = [],
  b: BatteryMovementEvent[] = []
): BatteryMovementEvent[] {
  const seen = new Map<string, BatteryMovementEvent>();
  const addEvt = (evt: BatteryMovementEvent) => {
    if (!evt) return;
    const key = evt.id || `${evt.date}|${evt.type}|${evt.timestamp}|${evt.cause}`;
    if (!seen.has(key)) {
      seen.set(key, evt);
    }
  };
  a.forEach(addEvt);
  b.forEach(addEvt);
  return Array.from(seen.values()).sort((x, y) => {
    const tx = parseTimestampMs(x.timestamp);
    const ty = parseTimestampMs(y.timestamp);
    if (tx !== ty) return ty - tx;
    return toISODateString(y.date || '').localeCompare(toISODateString(x.date || ''));
  });
}

/**
 * Merge local & remote battery serial maps without ever overwriting
 * pending/in-flight serial saves or losing movement history events.
 */
export function mergeSerialsByHistory(
  localSerials: Record<string, BatterySerialItem>,
  remoteSerials: Record<string, BatterySerialItem>,
  protectedSerialNos: Set<string> = new Set()
): { merged: Record<string, BatterySerialItem>; localNewerSerials: BatterySerialItem[] } {
  const merged: Record<string, BatterySerialItem> = {};
  const localNewerSerials: BatterySerialItem[] = [];
  const allKeys = new Set([
    ...Object.keys(remoteSerials || {}),
    ...Object.keys(localSerials || {}),
  ]);

  allKeys.forEach((key) => {
    const localItem = localSerials?.[key];
    const remoteItem = remoteSerials?.[key];

    if (protectedSerialNos.has(key)) {
      if (localItem) {
        merged[key] = localItem;
        localNewerSerials.push(localItem);
      } else if (remoteItem) {
        merged[key] = remoteItem;
      }
      return;
    }

    if (localItem && !remoteItem) {
      merged[key] = localItem;
      localNewerSerials.push(localItem);
      return;
    }

    if (remoteItem && !localItem) {
      merged[key] = remoteItem;
      return;
    }

    if (localItem && remoteItem) {
      const localTs = getSerialLatestTimestampMs(localItem);
      const remoteTs = getSerialLatestTimestampMs(remoteItem);
      const combinedHistory = mergeUniqueSerialHistory(localItem.history, remoteItem.history);
      const localLen = localItem.history?.length || 0;
      const remoteLen = remoteItem.history?.length || 0;

      if (localTs > remoteTs || (localTs === remoteTs && localLen > remoteLen)) {
        const winner: BatterySerialItem = { ...localItem, history: combinedHistory };
        merged[key] = winner;
        localNewerSerials.push(winner);
      } else {
        merged[key] = { ...remoteItem, history: combinedHistory };
      }
    }
  });

  return { merged, localNewerSerials };
}


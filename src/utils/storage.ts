import {
  BatteryColumn,
  DayRecord,
  DEFAULT_BATTERY_COLUMNS,
  DEFAULT_TEAM_MEMBERS,
  INITIAL_RECORD_31_10_2026,
  TeamMember,
} from '../types/stock';
import { addDaysToDateString } from './date';

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

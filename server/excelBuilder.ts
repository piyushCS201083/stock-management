import * as XLSX from 'xlsx';
import {
  BRANCHES,
  BatteryColumn,
  BatterySerialItem,
  BranchTransfer,
  DEFAULT_BATTERY_COLUMNS,
  DEFAULT_BRANCH_ID,
  DayRecord,
  parseBatteryRecordKey,
} from '../src/types/stock.ts';

function computeTotals(record: DayRecord, columns: BatteryColumn[]) {
  let openingStockTotal = 0;
  let inStockTotal = 0;
  let outStockTotal = 0;
  let closingStockTotal = 0;
  const closingStock: Record<string, number> = {};

  columns.forEach((col) => {
    const open = Number(record.stock?.[col.id] || 0);
    const inward = Number(record.inStock?.[col.id] || 0);
    const outward = Number(record.outStock?.[col.id] || 0);
    const closing = open + inward + outward;
    closingStock[col.id] = closing;
    openingStockTotal += open;
    inStockTotal += inward;
    outStockTotal += outward;
    closingStockTotal += closing;
  });

  const repairOpen = Number(record.stock?.['repair'] || 0);
  const repairIn = Number(record.inStock?.['repair'] || 0);
  const repairOut = Number(record.outStock?.['repair'] || 0);
  const repairClosing = repairOpen + repairIn + repairOut;
  closingStock['repair'] = repairClosing;

  const serviceOpen = Number(record.stock?.['service'] || 0);
  const serviceIn = Number(record.inStock?.['service'] || 0);
  const serviceOut = Number(record.outStock?.['service'] || 0);
  const serviceClosing = serviceOpen + serviceIn + serviceOut;
  closingStock['service'] = serviceClosing;

  return {
    openingStockTotal,
    inStockTotal,
    outStockTotal,
    closingStockTotal,
    closingStock,
    repairClosing,
    serviceClosing,
  };
}

function toIsoDate(ddMmYyyy: string): string {
  const parts = String(ddMmYyyy || '').split('-');
  if (parts.length !== 3) return ddMmYyyy;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

export interface FullExcelInputState {
  records: Record<string, DayRecord>;
  columns: BatteryColumn[];
  serials?: Record<string, BatterySerialItem>;
  chargerRecords?: Record<string, any>;
  branchTransfers?: BranchTransfer[];
}

/**
 * Generates an Excel (.xlsx) workbook Buffer containing the complete
 * Stock Register database across all branches, dates, serials, chargers, and transfers.
 */
export function buildStockDatabaseExcelBuffer(state: FullExcelInputState): Buffer {
  const columns =
    Array.isArray(state.columns) && state.columns.length > 0
      ? state.columns
      : DEFAULT_BATTERY_COLUMNS;
  const recordsMap = state.records || {};

  const wb = XLSX.utils.book_new();

  // Group records cleanly by branch & chronological date
  const entries: Array<{
    branchId: string;
    branchName: string;
    date: string;
    iso: string;
    record: DayRecord;
  }> = [];

  Object.entries(recordsMap).forEach(([key, rec]) => {
    if (!rec) return;
    const parsed = parseBatteryRecordKey(key);
    const branchId = rec.branchId || parsed.branchId || DEFAULT_BRANCH_ID;
    const date = rec.date || parsed.date;
    if (!date) return;
    const branch = BRANCHES.find((b) => b.id === branchId);
    entries.push({
      branchId,
      branchName: branch?.name || branchId,
      date,
      iso: toIsoDate(date),
      record: { ...rec, branchId, date },
    });
  });

  entries.sort((a, b) => {
    if (a.branchId !== b.branchId) return a.branchId.localeCompare(b.branchId);
    return a.iso.localeCompare(b.iso);
  });

  // Sheet 1: Complete Chronological Stock Ledger (All Branches & Dates)
  const masterRows: any[][] = [
    [
      'Branch',
      'Date',
      'Particulars',
      ...columns.map((c) => c.name),
      'Total',
      'OLD BATTERY FOR REPAIR',
      'SERVICE BATTERY TOTAL',
      'Last Modified',
      'Notes',
    ],
  ];

  entries.forEach(({ branchName, date, record }) => {
    const t = computeTotals(record, columns);
    masterRows.push([
      branchName,
      date,
      'Stock',
      ...columns.map((c) => record.stock?.[c.id] || 0),
      t.openingStockTotal,
      record.stock?.['repair'] || 0,
      record.stock?.['service'] || 0,
      record.lastModified || '',
      record.notes || '',
    ]);
    masterRows.push([
      branchName,
      date,
      'In Stock',
      ...columns.map((c) => record.inStock?.[c.id] || 0),
      t.inStockTotal,
      record.inStock?.['repair'] || 0,
      record.inStock?.['service'] || 0,
      '',
      '',
    ]);
    masterRows.push([
      branchName,
      date,
      'CAUSE (In)',
      ...columns.map((c) => record.inCause?.[c.id] || ''),
      record.totalInCause || '',
      record.repairInCause || '',
      '',
      '',
      '',
    ]);
    masterRows.push([
      branchName,
      date,
      'Out Stock',
      ...columns.map((c) => record.outStock?.[c.id] || 0),
      t.outStockTotal,
      record.outStock?.['repair'] || 0,
      record.outStock?.['service'] || 0,
      '',
      '',
    ]);
    masterRows.push([
      branchName,
      date,
      'CAUSE (Out)',
      ...columns.map((c) => record.outCause?.[c.id] || ''),
      record.totalOutCause || '',
      record.repairOutCause || '',
      '',
      '',
      '',
    ]);
    masterRows.push([
      branchName,
      date,
      "Today's Stock",
      ...columns.map((c) => t.closingStock[c.id] || 0),
      t.closingStockTotal,
      t.repairClosing,
      t.serviceClosing,
      '',
      '',
    ]);
    masterRows.push([]); // Blank separator row between dates
  });

  const masterSheet = XLSX.utils.aoa_to_sheet(masterRows);
  masterSheet['!cols'] = [
    { wch: 24 },
    { wch: 13 },
    { wch: 15 },
    ...columns.map(() => ({ wch: 15 })),
    { wch: 14 },
    { wch: 22 },
    { wch: 22 },
    { wch: 24 },
    { wch: 36 },
  ];
  XLSX.utils.book_append_sheet(wb, masterSheet, 'All_Stock_Ledger');

  // Per-Branch Latest Stock Sheet (exact layout matching daily spreadsheet)
  BRANCHES.forEach((branch) => {
    const branchEntries = entries.filter((e) => e.branchId === branch.id);
    if (branchEntries.length === 0) return;
    const latest = branchEntries[branchEntries.length - 1];
    const t = computeTotals(latest.record, columns);
    const sheetRows: any[][] = [
      [
        'Date',
        'Particulars',
        ...columns.map((c) => c.name),
        'Total',
        'OLD BATTERY FOR REPAIR',
        'SERVICE BATTERY TOTAL',
      ],
      [
        latest.date,
        'Stock',
        ...columns.map((c) => latest.record.stock?.[c.id] || 0),
        t.openingStockTotal,
        latest.record.stock?.['repair'] || 0,
        latest.record.stock?.['service'] || 0,
      ],
      [
        '',
        'In Stock',
        ...columns.map((c) => latest.record.inStock?.[c.id] || 0),
        t.inStockTotal,
        latest.record.inStock?.['repair'] || 0,
        latest.record.inStock?.['service'] || 0,
      ],
      [
        '',
        'CAUSE',
        ...columns.map((c) => latest.record.inCause?.[c.id] || ''),
        latest.record.totalInCause || '',
        latest.record.repairInCause || '',
        '',
      ],
      [
        '',
        'Out Stock',
        ...columns.map((c) => latest.record.outStock?.[c.id] || 0),
        t.outStockTotal,
        latest.record.outStock?.['repair'] || 0,
        latest.record.outStock?.['service'] || 0,
      ],
      [
        '',
        'CAUSE',
        ...columns.map((c) => latest.record.outCause?.[c.id] || ''),
        latest.record.totalOutCause || '',
        latest.record.repairOutCause || '',
        '',
      ],
      [
        '',
        "Today's Stock",
        ...columns.map((c) => t.closingStock[c.id] || 0),
        t.closingStockTotal,
        t.repairClosing,
        t.serviceClosing,
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetRows);
    ws['!cols'] = [
      { wch: 13 },
      { wch: 14 },
      ...columns.map(() => ({ wch: 15 })),
      { wch: 16 },
      { wch: 22 },
      { wch: 22 },
    ];
    const tabName = `${branch.number}-${branch.shortName}`.replace(/[\\/*?:[\]]/g, '').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, tabName);
  });

  // Serial Numbers Sheet
  const serialItems = Object.values(state.serials || {});
  const serialRows: any[][] = [
    [
      'Serial No',
      'Branch',
      'Model',
      'Batch No',
      'Status',
      'Inward Date',
      'Inward Partner',
      'Inward Cause',
      'Outward Date',
      'Outward Partner',
      'Outward Cause',
    ],
  ];
  serialItems.forEach((s) => {
    const branchName =
      BRANCHES.find((b) => b.id === (s.branchId || DEFAULT_BRANCH_ID))?.name ||
      s.branchId ||
      DEFAULT_BRANCH_ID;
    serialRows.push([
      s.serialNo,
      branchName,
      s.modelName || s.modelId,
      s.batchNo || '',
      s.status,
      s.inwardDate || '',
      s.inwardPartner || '',
      s.inwardCause || '',
      s.outwardDate || '',
      s.outwardPartner || '',
      s.outwardCause || '',
    ]);
  });
  const serialSheet = XLSX.utils.aoa_to_sheet(serialRows);
  XLSX.utils.book_append_sheet(wb, serialSheet, 'Serial_Numbers');

  // Charger Stock Sheet
  const chargerRows: any[][] = [
    ['Key', 'Branch', 'Date', 'Updated At', 'Items JSON'],
  ];
  Object.entries(state.chargerRecords || {}).forEach(([k, val]) => {
    const branchName =
      BRANCHES.find((b) => b.id === val?.branchId)?.name || val?.branchId || '';
    chargerRows.push([
      k,
      branchName,
      val?.date || '',
      val?.updatedAt || '',
      JSON.stringify(val?.items || val || {}),
    ]);
  });
  const chargerSheet = XLSX.utils.aoa_to_sheet(chargerRows);
  XLSX.utils.book_append_sheet(wb, chargerSheet, 'Charger_Stock');

  // Inter-Branch Transfers Sheet
  const transferRows: any[][] = [
    ['Transfer ID', 'Date', 'From Branch', 'To Branch', 'Status', 'Partner', 'Items Summary', 'Created At'],
  ];
  (state.branchTransfers || []).forEach((t) => {
    const summary = (t.items || [])
      .map((i) => `${i.modelName} x${i.quantity} (${i.received ? 'Received' : 'Pending'})`)
      .join('; ');
    transferRows.push([
      t.id,
      t.date,
      t.fromBranchName,
      t.toBranchName,
      t.status,
      t.partner || '',
      summary,
      t.createdAt,
    ]);
  });
  const transferSheet = XLSX.utils.aoa_to_sheet(transferRows);
  XLSX.utils.book_append_sheet(wb, transferSheet, 'Branch_Transfers');

  const arrayBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.isBuffer(arrayBuffer) ? arrayBuffer : Buffer.from(arrayBuffer);
}

/**
 * Generates Excel 2 (.xlsx): All Battery Serial Numbers (In Stock, Dispatched/Out, Repair, Standby)
 * plus the complete historical movement log across all dates and branches.
 */
export function buildSerialHistoryExcelBuffer(state: FullExcelInputState): Buffer {
  const columns =
    Array.isArray(state.columns) && state.columns.length > 0
      ? state.columns
      : DEFAULT_BATTERY_COLUMNS;
  const serialItems = Object.values(state.serials || {});
  const wb = XLSX.utils.book_new();

  const branchLabel = (bId?: string) =>
    BRANCHES.find((b) => b.id === (bId || DEFAULT_BRANCH_ID))?.name || bId || DEFAULT_BRANCH_ID;

  const modelLabel = (item: BatterySerialItem) =>
    item.modelName || columns.find((c) => c.id === item.modelId)?.name || item.modelId;

  const inStockItems = serialItems.filter((s) => s.status === 'in_stock');
  const dispatchedItems = serialItems.filter(
    (s) => s.status === 'dispatched' || Boolean(s.outwardDate)
  );

  // Sheet 1: In Stock Serials
  const inStockRows: any[][] = [
    ['Serial No.', 'Model', 'Batch', 'Branch', 'Status', 'Inward Date', 'Received From / Partner', 'Inward Cause'],
    ...inStockItems.map((s) => [
      s.serialNo,
      modelLabel(s),
      s.batchNo || '',
      branchLabel(s.branchId),
      'IN STOCK',
      s.inwardDate || '',
      s.inwardPartner || '',
      s.inwardCause || '',
    ]),
  ];
  const wsIn = XLSX.utils.aoa_to_sheet(inStockRows);
  XLSX.utils.book_append_sheet(wb, wsIn, 'In_Stock_Serials');

  // Sheet 2: Dispatched / Out Serials
  const outRows: any[][] = [
    ['Serial No.', 'Model', 'Batch', 'Branch', 'Status', 'Inward Date', 'Inward Source', 'Outward Date', 'Dispatched To (Vehicle / Dealer)', 'Outward Cause'],
    ...dispatchedItems.map((s) => [
      s.serialNo,
      modelLabel(s),
      s.batchNo || '',
      branchLabel(s.branchId),
      s.status.toUpperCase(),
      s.inwardDate || '',
      s.inwardPartner || '',
      s.outwardDate || '',
      s.outwardPartner || '',
      s.outwardCause || '',
    ]),
  ];
  const wsOut = XLSX.utils.aoa_to_sheet(outRows);
  XLSX.utils.book_append_sheet(wb, wsOut, 'Dispatched_Out_Serials');

  // Sheet 3: All Serials Master
  const masterRows: any[][] = [
    ['Serial No.', 'Model', 'Batch', 'Branch', 'Status', 'Inward Date', 'Inward Partner', 'Inward Cause', 'Outward Date', 'Outward Partner', 'Outward Cause'],
    ...serialItems.map((s) => [
      s.serialNo,
      modelLabel(s),
      s.batchNo || '',
      branchLabel(s.branchId),
      s.status.replace('_', ' ').toUpperCase(),
      s.inwardDate || '',
      s.inwardPartner || '',
      s.inwardCause || '',
      s.outwardDate || '',
      s.outwardPartner || '',
      s.outwardCause || '',
    ]),
  ];
  const wsAll = XLSX.utils.aoa_to_sheet(masterRows);
  XLSX.utils.book_append_sheet(wb, wsAll, 'All_Battery_Serials');

  // Sheet 4: Complete Movement History Log
  const historyRows: any[][] = [
    ['Serial No.', 'Model', 'Branch', 'Current Status', 'Movement Date', 'Movement Type', 'Partner / Vehicle', 'Cause / Remarks', 'Timestamp'],
  ];
  serialItems.forEach((s) => {
    const events = Array.isArray(s.history) ? s.history : [];
    if (events.length === 0) {
      if (s.inwardDate) {
        historyRows.push([s.serialNo, modelLabel(s), branchLabel(s.branchId), s.status.toUpperCase(), s.inwardDate, 'IN', s.inwardPartner || '', s.inwardCause || '', '']);
      }
      if (s.outwardDate) {
        historyRows.push([s.serialNo, modelLabel(s), branchLabel(s.branchId), s.status.toUpperCase(), s.outwardDate, 'OUT', s.outwardPartner || '', s.outwardCause || '', '']);
      }
    } else {
      events.forEach((evt) => {
        historyRows.push([
          s.serialNo,
          modelLabel(s),
          branchLabel(evt.branchId || s.branchId),
          s.status.replace('_', ' ').toUpperCase(),
          evt.date || '',
          String(evt.type || '').toUpperCase().replace('_', ' '),
          evt.partner || evt.vehicleOrLocation || '',
          evt.cause || evt.notes || '',
          evt.timestamp || '',
        ]);
      });
    }
  });
  const wsHist = XLSX.utils.aoa_to_sheet(historyRows);
  XLSX.utils.book_append_sheet(wb, wsHist, 'Past_Movement_History');

  const arrayBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.isBuffer(arrayBuffer) ? arrayBuffer : Buffer.from(arrayBuffer);
}

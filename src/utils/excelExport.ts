import * as XLSX from 'xlsx';
import {
  BRANCHES,
  BatteryColumn,
  BatterySerialItem,
  BranchTransfer,
  DEFAULT_BRANCH_ID,
  DayRecord,
  parseBatteryRecordKey,
} from '../types/stock';
import { calculateRecordTotals } from './storage';
import { getIndianTodayDate, toISODateString } from './date';

/**
 * Excel 1 (Single Date): Quantity Stock Register for a specific date
 */
export function exportRecordToExcel(record: DayRecord, columns: BatteryColumn[]) {
  const totals = calculateRecordTotals(record, columns);

  const headerRow = [
    'Date',
    'Particulars',
    ...columns.map((c) => c.name),
    'Total',
    'OLD BATTERY FOR REPAIR',
    'SERVICE BATTERY TOTAL',
  ];

  const stockRow = [
    record.date,
    'Stock',
    ...columns.map((c) => record.stock[c.id] || 0),
    totals.openingStockTotal,
    record.stock['repair'] || 0,
    record.stock['service'] || 0,
  ];

  const inStockRow = [
    '',
    'In Stock',
    ...columns.map((c) => record.inStock[c.id] || 0),
    totals.inStockTotal,
    record.inStock['repair'] || 0,
    record.inStock['service'] || 0,
  ];

  const inCauseRow = [
    '',
    'CAUSE',
    ...columns.map((c) => record.inCause[c.id] || ''),
    record.totalInCause || '',
    record.repairInCause || '',
    record.inCause['service'] || '',
  ];

  const outStockRow = [
    '',
    'Out Stock',
    ...columns.map((c) => record.outStock[c.id] || 0),
    totals.outStockTotal,
    record.outStock['repair'] || 0,
    record.outStock['service'] || 0,
  ];

  const outCauseRow = [
    '',
    'CAUSE',
    ...columns.map((c) => record.outCause[c.id] || ''),
    record.totalOutCause || '',
    record.repairOutCause || '',
    record.outCause['service'] || '',
  ];

  const todayStockRow = [
    '',
    "Today's Stock",
    ...columns.map((c) => totals.closingStock[c.id] || 0),
    totals.closingStockTotal,
    totals.repair.closing,
    totals.service.closing,
  ];

  const sheetData = [
    headerRow,
    stockRow,
    inStockRow,
    inCauseRow,
    outStockRow,
    outCauseRow,
    todayStockRow,
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 14 },
    ...columns.map(() => ({ wch: 15 })),
    { wch: 18 },
    { wch: 22 },
    { wch: 22 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Quantity_${record.date}`);

  XLSX.writeFile(wb, `Battery_Quantity_Stock_${record.date}.xlsx`);
}

/**
 * Excel 1 (Complete History): Quantity Stock Register across all dates
 */
export function exportAllRecordsToExcel(records: Record<string, DayRecord>, columns: BatteryColumn[]) {
  const wb = XLSX.utils.book_new();
  const sortedDates = Object.keys(records).sort((a, b) =>
    toISODateString(parseBatteryRecordKey(a).date).localeCompare(
      toISODateString(parseBatteryRecordKey(b).date)
    )
  );

  sortedDates.forEach((dateKey) => {
    const record = records[dateKey];
    const totals = calculateRecordTotals(record, columns);

    const sheetData = [
      ['Date', 'Particulars', ...columns.map((c) => c.name), 'Total', 'OLD BATTERY FOR REPAIR', 'SERVICE BATTERY TOTAL'],
      [record.date, 'Stock', ...columns.map((c) => record.stock[c.id] || 0), totals.openingStockTotal, record.stock['repair'] || 0, record.stock['service'] || 0],
      ['', 'In Stock', ...columns.map((c) => record.inStock[c.id] || 0), totals.inStockTotal, record.inStock['repair'] || 0, record.inStock['service'] || 0],
      ['', 'CAUSE', ...columns.map((c) => record.inCause[c.id] || ''), record.totalInCause || '', record.repairInCause || '', record.inCause['service'] || ''],
      ['', 'Out Stock', ...columns.map((c) => record.outStock[c.id] || 0), totals.outStockTotal, record.outStock['repair'] || 0, record.outStock['service'] || 0],
      ['', 'CAUSE', ...columns.map((c) => record.outCause[c.id] || ''), record.totalOutCause || '', record.repairOutCause || '', record.outCause['service'] || ''],
      ['', "Today's Stock", ...columns.map((c) => totals.closingStock[c.id] || 0), totals.closingStockTotal, totals.repair.closing, totals.service.closing],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, dateKey.replace(/[\\/*?:[\]]/g, '_').substring(0, 31));
  });

  XLSX.writeFile(wb, `Battery_Quantity_Stock_Complete.xlsx`);
}

function getBranchLabel(branchId?: string): string {
  const id = branchId || DEFAULT_BRANCH_ID;
  return BRANCHES.find((b) => b.id === id)?.name || id;
}

function getModelLabel(item: BatterySerialItem, columns: BatteryColumn[]): string {
  if (item.modelName) return item.modelName;
  if (item.modelId === 'repair') return 'OLD BATTERY FOR REPAIR';
  if (item.modelId === 'service') return 'SERVICE BATTERY';
  return columns.find((c) => c.id === item.modelId)?.name || item.modelId;
}

function formatStatusLabel(status: BatterySerialItem['status']): string {
  return String(status || 'in_stock').replace(/_/g, ' ').toUpperCase();
}

/**
 * Excel 2: Complete Battery Serial Numbers + Every Movement + Every Daily Transaction & Transfer
 */
export function exportSerialHistoryToExcel(
  serials: Record<string, BatterySerialItem>,
  columns: BatteryColumn[],
  branchId?: string,
  records?: Record<string, DayRecord>,
  transfers?: BranchTransfer[]
) {
  const allList = Object.values(serials || {}).sort((a, b) => {
    const aBranch = a.branchId || DEFAULT_BRANCH_ID;
    const bBranch = b.branchId || DEFAULT_BRANCH_ID;
    if (branchId) {
      const aMatch = aBranch === branchId ? 0 : 1;
      const bMatch = bBranch === branchId ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    const isoCmp = toISODateString(b.inwardDate || '').localeCompare(
      toISODateString(a.inwardDate || '')
    );
    if (isoCmp !== 0) return isoCmp;
    return String(a.serialNo || '').localeCompare(String(b.serialNo || ''));
  });

  const inStockList = allList.filter(
    (s) => s.status === 'in_stock' || s.status === 'service_standby' || s.status === 'in_repair'
  );
  const dispatchedList = allList.filter(
    (s) =>
      s.status === 'dispatched' ||
      Boolean(s.outwardDate) ||
      (Array.isArray(s.history) && s.history.some((h) => h.type === 'out' || h.type === 'repair_out'))
  );

  const wb = XLSX.utils.book_new();

  // Sheet 1: Currently Available / In-Store Serial Numbers (In Stock, Service Standby, In Repair)
  const inStockRows: any[][] = [
    [
      'Serial No.',
      'Battery Model',
      'Batch',
      'Branch',
      'Status',
      'Inward Date',
      'Received From / Partner',
      'Inward Cause / Remarks',
    ],
    ...inStockList.map((item) => [
      item.serialNo,
      getModelLabel(item, columns),
      item.batchNo || '',
      getBranchLabel(item.branchId),
      formatStatusLabel(item.status),
      item.inwardDate || '',
      item.inwardPartner || '',
      item.inwardCause || '',
    ]),
  ];
  const wsInStock = XLSX.utils.aoa_to_sheet(inStockRows);
  wsInStock['!cols'] = [
    { wch: 22 },
    { wch: 22 },
    { wch: 18 },
    { wch: 24 },
    { wch: 16 },
    { wch: 14 },
    { wch: 24 },
    { wch: 38 },
  ];
  XLSX.utils.book_append_sheet(wb, wsInStock, 'In_Stock_Serials');

  // Sheet 2: Dispatched / Past Out Serial Numbers
  const dispatchedRows: any[][] = [
    [
      'Serial No.',
      'Battery Model',
      'Batch',
      'Branch',
      'Current Status',
      'Inward Date',
      'Inward Partner / Source',
      'Outward (Dispatched) Date',
      'Dispatched To (Vehicle / Dealer)',
      'Outward Cause / Remarks',
    ],
    ...dispatchedList.map((item) => [
      item.serialNo,
      getModelLabel(item, columns),
      item.batchNo || '',
      getBranchLabel(item.branchId),
      formatStatusLabel(item.status),
      item.inwardDate || '',
      item.inwardPartner || '',
      item.outwardDate || '',
      item.outwardPartner || '',
      item.outwardCause || '',
    ]),
  ];
  const wsDispatched = XLSX.utils.aoa_to_sheet(dispatchedRows);
  wsDispatched['!cols'] = [
    { wch: 22 },
    { wch: 22 },
    { wch: 18 },
    { wch: 24 },
    { wch: 16 },
    { wch: 14 },
    { wch: 22 },
    { wch: 18 },
    { wch: 28 },
    { wch: 38 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDispatched, 'Dispatched_Out_Serials');

  // Sheet 3: All Serial Numbers Master (Every Serial Registered Forever)
  const masterRows: any[][] = [
    [
      'Serial No.',
      'Battery Model',
      'Batch',
      'Branch',
      'Status',
      'Inward Date',
      'Inward Partner',
      'Inward Cause',
      'Outward Date',
      'Outward Partner / Vehicle',
      'Outward Cause',
      'Last Movement Date',
      'History Events Count',
    ],
    ...allList.map((item) => {
      const sortedEvents = [...(item.history || [])].sort((x, y) => {
        const isoCmp = toISODateString(y.date || '').localeCompare(toISODateString(x.date || ''));
        if (isoCmp !== 0) return isoCmp;
        return String(y.timestamp || '').localeCompare(String(x.timestamp || ''));
      });
      const lastEvtDate = sortedEvents[0]?.date || item.outwardDate || item.inwardDate || '';
      return [
        item.serialNo,
        getModelLabel(item, columns),
        item.batchNo || '',
        getBranchLabel(item.branchId),
        formatStatusLabel(item.status),
        item.inwardDate || '',
        item.inwardPartner || '',
        item.inwardCause || '',
        item.outwardDate || '',
        item.outwardPartner || '',
        item.outwardCause || '',
        lastEvtDate,
        (item.history || []).length,
      ];
    }),
  ];
  const wsMaster = XLSX.utils.aoa_to_sheet(masterRows);
  wsMaster['!cols'] = [
    { wch: 22 },
    { wch: 22 },
    { wch: 18 },
    { wch: 24 },
    { wch: 16 },
    { wch: 14 },
    { wch: 22 },
    { wch: 30 },
    { wch: 14 },
    { wch: 26 },
    { wch: 30 },
    { wch: 16 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsMaster, 'All_Battery_Serials');

  // Sheet 4: Complete Chronological Movement & Transaction History
  interface MovementLogEntry {
    isoDate: string;
    timestamp: string;
    row: any[];
  }
  const movementEntries: MovementLogEntry[] = [];

  allList.forEach((item) => {
    const model = getModelLabel(item, columns);
    const branchName = getBranchLabel(item.branchId);
    const statusText = formatStatusLabel(item.status);
    const events = Array.isArray(item.history) ? item.history : [];

    if (events.length === 0) {
      if (item.inwardDate) {
        movementEntries.push({
          isoDate: toISODateString(item.inwardDate),
          timestamp: '',
          row: [
            item.inwardDate,
            'SERIAL LIFECYCLE',
            branchName,
            'IN',
            model,
            1,
            item.serialNo,
            item.inwardPartner || '',
            item.inwardCause || '',
            statusText,
            '',
          ],
        });
      }
      if (item.outwardDate) {
        movementEntries.push({
          isoDate: toISODateString(item.outwardDate),
          timestamp: '',
          row: [
            item.outwardDate,
            'SERIAL LIFECYCLE',
            branchName,
            'OUT (DISPATCHED)',
            model,
            -1,
            item.serialNo,
            item.outwardPartner || '',
            item.outwardCause || '',
            statusText,
            '',
          ],
        });
      }
    } else {
      events.forEach((evt) => {
        const evtType = String(evt.type || '').toUpperCase().replace(/_/g, ' ');
        const isOut = evt.type === 'out' || evt.type === 'repair_out';
        movementEntries.push({
          isoDate: toISODateString(evt.date || item.inwardDate || ''),
          timestamp: evt.timestamp || '',
          row: [
            evt.date || '',
            'SERIAL LIFECYCLE',
            getBranchLabel(evt.branchId || item.branchId),
            evtType,
            model,
            isOut ? -1 : 1,
            item.serialNo,
            evt.partner || evt.vehicleOrLocation || '',
            evt.cause || evt.notes || '',
            statusText,
            evt.timestamp || '',
          ],
        });
      });
    }
  });

  // Include every daily ledger transaction (including direct spreadsheet edits & service/repair)
  const trackedModels: Array<{ id: string; name: string }> = [
    ...columns.map((c) => ({ id: c.id, name: c.name })),
    { id: 'repair', name: 'OLD BATTERY FOR REPAIR' },
    { id: 'service', name: 'SERVICE BATTERY' },
  ];

  Object.entries(records || {}).forEach(([key, rec]) => {
    if (!rec) return;
    const parsed = parseBatteryRecordKey(key);
    const recBranch = rec.branchId || parsed.branchId || DEFAULT_BRANCH_ID;
    const recDate = rec.date || parsed.date;
    if (!recDate) return;
    const branchName = getBranchLabel(recBranch);
    const isoDate = toISODateString(recDate);
    const ts = rec.lastModified || '';

    let hadColumnMovement = false;

    trackedModels.forEach((col) => {
      const inQty = Number(rec.inStock?.[col.id] || 0);
      const outQty = Number(rec.outStock?.[col.id] || 0);

      if (inQty !== 0) {
        hadColumnMovement = true;
        const causeStr =
          (col.id === 'repair' ? rec.repairInCause : rec.inCause?.[col.id]) ||
          rec.totalInCause ||
          rec.notes ||
          '';
        movementEntries.push({
          isoDate,
          timestamp: ts,
          row: [
            recDate,
            'DAILY LEDGER',
            branchName,
            col.id === 'repair' ? 'REPAIR IN (+)' : col.id === 'service' ? 'SERVICE IN (+)' : 'IN STOCK (+)',
            col.name,
            inQty,
            '',
            '',
            causeStr,
            'RECORDED',
            ts,
          ],
        });
      }

      if (outQty !== 0) {
        hadColumnMovement = true;
        const causeStr =
          (col.id === 'repair' ? rec.repairOutCause : rec.outCause?.[col.id]) ||
          rec.totalOutCause ||
          rec.notes ||
          '';
        movementEntries.push({
          isoDate,
          timestamp: ts,
          row: [
            recDate,
            'DAILY LEDGER',
            branchName,
            col.id === 'repair' ? 'REPAIR OUT (-)' : col.id === 'service' ? 'SERVICE OUT (-)' : 'OUT STOCK (-)',
            col.name,
            outQty > 0 ? -outQty : outQty,
            '',
            '',
            causeStr,
            'RECORDED',
            ts,
          ],
        });
      }
    });

    if (!hadColumnMovement && (rec.totalInCause?.trim() || rec.totalOutCause?.trim())) {
      if (rec.totalInCause?.trim()) {
        movementEntries.push({
          isoDate,
          timestamp: ts,
          row: [recDate, 'DAILY LEDGER', branchName, 'IN NOTE', 'All Models', 0, '', '', rec.totalInCause, 'RECORDED', ts],
        });
      }
      if (rec.totalOutCause?.trim()) {
        movementEntries.push({
          isoDate,
          timestamp: ts,
          row: [recDate, 'DAILY LEDGER', branchName, 'OUT NOTE', 'All Models', 0, '', '', rec.totalOutCause, 'RECORDED', ts],
        });
      }
    }
  });

  // Include every inter-branch transfer
  (transfers || []).forEach((trf) => {
    const isoDate = toISODateString(trf.date || '');
    (trf.items || []).forEach((item) => {
      const ts = item.receivedAt || trf.receivedAt || trf.createdAt || '';
      movementEntries.push({
        isoDate,
        timestamp: ts,
        row: [
          trf.date || '',
          'BRANCH TRANSFER',
          `${trf.fromBranchName} -> ${trf.toBranchName}`,
          `TRANSFER (${String(trf.status || 'pending').toUpperCase()})`,
          item.modelName,
          item.quantity,
          (item.serialNos || []).join(', '),
          trf.partner || trf.toBranchName,
          item.notes || trf.notes || '',
          item.received ? 'RECEIVED' : 'PENDING RECEIVE',
          ts,
        ],
      });
    });
  });

  movementEntries.sort((a, b) => {
    const dateCmp = a.isoDate.localeCompare(b.isoDate);
    if (dateCmp !== 0) return dateCmp;
    return String(a.timestamp || '').localeCompare(String(b.timestamp || ''));
  });

  const historyRows: any[][] = [
    [
      'Movement Date',
      'Entry Source',
      'Branch / Route',
      'Movement Type',
      'Battery Model',
      'Qty',
      'Serial No.(s)',
      'Partner / Vehicle / Destination',
      'Cause / Remarks',
      'Current Status',
      'Recorded Timestamp',
    ],
    ...movementEntries.map((e) => e.row),
  ];

  const wsHistory = XLSX.utils.aoa_to_sheet(historyRows);
  wsHistory['!cols'] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 28 },
    { wch: 20 },
    { wch: 22 },
    { wch: 8 },
    { wch: 24 },
    { wch: 28 },
    { wch: 38 },
    { wch: 16 },
    { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, wsHistory, 'Past_Movement_History');

  // Sheet 5: Complete Daily Transactions Ledger (Every Date & Branch Opening / IN / OUT / Closing)
  const ledgerEntries: Array<{ branchId: string; branchName: string; date: string; iso: string; rec: DayRecord }> = [];
  Object.entries(records || {}).forEach(([key, rec]) => {
    if (!rec) return;
    const parsed = parseBatteryRecordKey(key);
    const bId = rec.branchId || parsed.branchId || DEFAULT_BRANCH_ID;
    const cleanDate = rec.date || parsed.date;
    if (!cleanDate) return;
    ledgerEntries.push({
      branchId: bId,
      branchName: getBranchLabel(bId),
      date: cleanDate,
      iso: toISODateString(cleanDate),
      rec: { ...rec, branchId: bId, date: cleanDate },
    });
  });
  ledgerEntries.sort((a, b) => {
    const isoCmp = a.iso.localeCompare(b.iso);
    if (isoCmp !== 0) return isoCmp;
    return a.branchId.localeCompare(b.branchId);
  });

  const ledgerRows: any[][] = [
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

  ledgerEntries.forEach(({ branchName, date, rec }) => {
    const t = calculateRecordTotals(rec, columns);
    ledgerRows.push([
      branchName,
      date,
      'Stock',
      ...columns.map((c) => rec.stock?.[c.id] || 0),
      t.openingStockTotal,
      rec.stock?.['repair'] || 0,
      rec.stock?.['service'] || 0,
      rec.lastModified || '',
      rec.notes || '',
    ]);
    ledgerRows.push([
      branchName,
      date,
      'In Stock',
      ...columns.map((c) => rec.inStock?.[c.id] || 0),
      t.inStockTotal,
      rec.inStock?.['repair'] || 0,
      rec.inStock?.['service'] || 0,
      '',
      '',
    ]);
    ledgerRows.push([
      branchName,
      date,
      'CAUSE (In)',
      ...columns.map((c) => rec.inCause?.[c.id] || ''),
      rec.totalInCause || '',
      rec.repairInCause || '',
      rec.inCause?.['service'] || '',
      '',
      '',
    ]);
    ledgerRows.push([
      branchName,
      date,
      'Out Stock',
      ...columns.map((c) => rec.outStock?.[c.id] || 0),
      t.outStockTotal,
      rec.outStock?.['repair'] || 0,
      rec.outStock?.['service'] || 0,
      '',
      '',
    ]);
    ledgerRows.push([
      branchName,
      date,
      'CAUSE (Out)',
      ...columns.map((c) => rec.outCause?.[c.id] || ''),
      rec.totalOutCause || '',
      rec.repairOutCause || '',
      rec.outCause?.['service'] || '',
      '',
      '',
    ]);
    ledgerRows.push([
      branchName,
      date,
      "Today's Stock",
      ...columns.map((c) => t.closingStock[c.id] || 0),
      t.closingStockTotal,
      t.repair.closing,
      t.service.closing,
      '',
      '',
    ]);
    ledgerRows.push([]);
  });

  const wsLedger = XLSX.utils.aoa_to_sheet(ledgerRows);
  wsLedger['!cols'] = [
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
  XLSX.utils.book_append_sheet(wb, wsLedger, 'Daily_Transactions_Ledger');

  const todaySlug = getIndianTodayDate();
  const suffix = branchId ? `_${branchId}` : '_All_Branches';
  XLSX.writeFile(wb, `Battery_Serials_And_History${suffix}_${todaySlug}.xlsx`);
}


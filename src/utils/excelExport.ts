import * as XLSX from 'xlsx';
import {
  BRANCHES,
  BatteryColumn,
  BatterySerialItem,
  BranchTransfer,
  DEFAULT_BRANCH_ID,
  DEFAULT_CHARGER_COLUMNS,
  DEFAULT_VEHICLE_COLUMNS,
  DayRecord,
  StockTransactionEntry,
  parseBatteryRecordKey,
} from '../types/stock';
import { calculateRecordTotals } from './storage';
import { getIndianTodayDate, toISODateString } from './date';

function getBranchLabel(branchId?: string): string {
  const id = branchId || DEFAULT_BRANCH_ID;
  return BRANCHES.find((b) => b.id === id)?.name || id;
}

function buildFallbackDailyTransactions(
  record: DayRecord,
  columns: BatteryColumn[],
  category: 'battery' | 'charger' = 'battery'
): StockTransactionEntry[] {
  const branchId = record.branchId || DEFAULT_BRANCH_ID;
  const ts = record.lastModified || '';
  const actor = record.lastModifiedBy || '';
  const isCharger = category === 'charger';
  const tracked = [
    ...columns.map((c) => ({ id: c.id, name: c.name })),
    { id: 'repair', name: isCharger ? 'OLD CHARGER FOR REPAIR' : 'OLD BATTERY FOR REPAIR' },
    { id: 'service', name: isCharger ? 'SERVICE CHARGER' : 'SERVICE BATTERY' },
  ];
  const entries: StockTransactionEntry[] = [];
  tracked.forEach((col) => {
    const inQty = Number(record.inStock?.[col.id] || 0);
    if (inQty !== 0) {
      entries.push({
        id: `fallback_in_${col.id}`,
        timestamp: ts,
        date: record.date,
        branchId,
        category,
        action: col.id === 'repair' ? 'repair_in' : col.id === 'service' ? 'service' : 'in',
        modelId: col.id,
        modelName: col.name,
        quantity: inQty,
        cause:
          (col.id === 'repair' ? record.repairInCause : record.inCause?.[col.id]) ||
          record.totalInCause ||
          record.notes ||
          '',
        performedBy: actor,
      });
    }
    const outQty = Number(record.outStock?.[col.id] || 0);
    if (outQty !== 0) {
      entries.push({
        id: `fallback_out_${col.id}`,
        timestamp: ts,
        date: record.date,
        branchId,
        category,
        action: col.id === 'repair' ? 'repair_out' : col.id === 'service' ? 'service' : 'out',
        modelId: col.id,
        modelName: col.name,
        quantity: outQty > 0 ? -outQty : outQty,
        cause:
          (col.id === 'repair' ? record.repairOutCause : record.outCause?.[col.id]) ||
          record.totalOutCause ||
          record.notes ||
          '',
        performedBy: actor,
      });
    }
  });
  return entries;
}

function formatTransactionAction(tx: StockTransactionEntry): string {
  switch (tx.action) {
    case 'in':
      return 'IN (+)';
    case 'out':
      return 'OUT (-)';
    case 'repair_in':
      return 'REPAIR IN (+)';
    case 'repair_out':
      return 'REPAIR OUT (-)';
    case 'service':
      return tx.quantity >= 0 ? 'SERVICE IN (+)' : 'SERVICE OUT (-)';
    case 'transfer_in':
      return 'TRANSFER IN (+)';
    case 'transfer_out':
      return 'TRANSFER OUT (-)';
    default:
      return tx.quantity >= 0 ? 'IN (+)' : 'OUT (-)';
  }
}

/**
 * Excel 1 (Single Date): Quantity Stock Register for a specific date + Transaction Log with Login ID
 */
export function exportRecordToExcel(
  record: DayRecord,
  columns: BatteryColumn[],
  category: 'battery' | 'charger' = 'battery'
) {
  const totals = calculateRecordTotals(record, columns);
  const isCharger = category === 'charger';
  const repairHeader = isCharger ? 'OLD CHARGER FOR REPAIR' : 'OLD BATTERY FOR REPAIR';
  const serviceHeader = isCharger ? 'SERVICE CHARGER TOTAL' : 'SERVICE BATTERY TOTAL';

  const headerRow = [
    'Date',
    'Particulars',
    ...columns.map((c) => c.name),
    'Total',
    repairHeader,
    serviceHeader,
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

  const metaRow = [
    'Last Updated By (Login ID)',
    record.lastModifiedBy || '',
    'Branch',
    getBranchLabel(record.branchId),
    'Last Modified',
    record.lastModified || '',
  ];

  const sheetData = [
    headerRow,
    stockRow,
    inStockRow,
    inCauseRow,
    outStockRow,
    outCauseRow,
    todayStockRow,
    [],
    metaRow,
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 24 },
    { wch: 16 },
    ...columns.map(() => ({ wch: 15 })),
    { wch: 18 },
    { wch: 22 },
    { wch: 22 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Quantity_${record.date}`);

  // Sheet 2: Granular IN/OUT Transaction Log with Done By (Login ID)
  const txList =
    Array.isArray(record.transactions) && record.transactions.length > 0
      ? record.transactions
      : buildFallbackDailyTransactions(record, columns, category);

  const txRows: any[][] = [
    [
      'Timestamp',
      'Date',
      'Branch',
      'Category',
      'IN / OUT',
      'Model',
      'Qty',
      'Serial No.(s)',
      'Partner / Vehicle',
      'Cause / Remarks',
      'Done By (Login ID)',
    ],
    ...txList.map((tx) => [
      tx.timestamp || '',
      tx.date || record.date,
      getBranchLabel(tx.branchId || record.branchId),
      String(tx.category || category).toUpperCase(),
      formatTransactionAction(tx),
      tx.modelName || tx.modelId,
      tx.quantity,
      (tx.serialNos || []).join(', '),
      tx.partner || '',
      tx.cause || '',
      tx.performedBy || record.lastModifiedBy || '',
    ]),
  ];
  const wsTx = XLSX.utils.aoa_to_sheet(txRows);
  wsTx['!cols'] = [
    { wch: 24 },
    { wch: 13 },
    { wch: 24 },
    { wch: 12 },
    { wch: 18 },
    { wch: 22 },
    { wch: 8 },
    { wch: 24 },
    { wch: 24 },
    { wch: 34 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTx, 'Transaction_Log');

  const filePrefix = isCharger ? 'Charger' : 'Battery';
  XLSX.writeFile(wb, `${filePrefix}_Quantity_Stock_${record.date}.xlsx`);
}

/**
 * Excel 1 (Complete History): Quantity Stock Register across all dates + Consolidated Transactions Log
 */
export function exportAllRecordsToExcel(
  records: Record<string, DayRecord>,
  columns: BatteryColumn[],
  category: 'battery' | 'charger' = 'battery'
) {
  const wb = XLSX.utils.book_new();
  const isCharger = category === 'charger';
  const repairHeader = isCharger ? 'OLD CHARGER FOR REPAIR' : 'OLD BATTERY FOR REPAIR';
  const serviceHeader = isCharger ? 'SERVICE CHARGER TOTAL' : 'SERVICE BATTERY TOTAL';
  const sortedDates = Object.keys(records).sort((a, b) =>
    toISODateString(parseBatteryRecordKey(a).date).localeCompare(
      toISODateString(parseBatteryRecordKey(b).date)
    )
  );

  const consolidatedTxRows: any[][] = [
    [
      'Timestamp',
      'Date',
      'Branch',
      'Category',
      'IN / OUT',
      'Model',
      'Qty',
      'Serial No.(s)',
      'Partner / Vehicle',
      'Cause / Remarks',
      'Done By (Login ID)',
    ],
  ];

  sortedDates.forEach((dateKey) => {
    const record = records[dateKey];
    const totals = calculateRecordTotals(record, columns);

    const sheetData = [
      ['Date', 'Particulars', ...columns.map((c) => c.name), 'Total', repairHeader, serviceHeader],
      [record.date, 'Stock', ...columns.map((c) => record.stock[c.id] || 0), totals.openingStockTotal, record.stock['repair'] || 0, record.stock['service'] || 0],
      ['', 'In Stock', ...columns.map((c) => record.inStock[c.id] || 0), totals.inStockTotal, record.inStock['repair'] || 0, record.inStock['service'] || 0],
      ['', 'CAUSE', ...columns.map((c) => record.inCause[c.id] || ''), record.totalInCause || '', record.repairInCause || '', record.inCause['service'] || ''],
      ['', 'Out Stock', ...columns.map((c) => record.outStock[c.id] || 0), totals.outStockTotal, record.outStock['repair'] || 0, record.outStock['service'] || 0],
      ['', 'CAUSE', ...columns.map((c) => record.outCause[c.id] || ''), record.totalOutCause || '', record.repairOutCause || '', record.outCause['service'] || ''],
      ['', "Today's Stock", ...columns.map((c) => totals.closingStock[c.id] || 0), totals.closingStockTotal, totals.repair.closing, totals.service.closing],
      [],
      ['Last Updated By (Login ID)', record.lastModifiedBy || '', 'Branch', getBranchLabel(record.branchId), 'Last Modified', record.lastModified || ''],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, dateKey.replace(/[\\/*?:[\]]/g, '_').substring(0, 31));

    const txList =
      Array.isArray(record.transactions) && record.transactions.length > 0
        ? record.transactions
        : buildFallbackDailyTransactions(record, columns, category);

    txList.forEach((tx) => {
      consolidatedTxRows.push([
        tx.timestamp || '',
        tx.date || record.date,
        getBranchLabel(tx.branchId || record.branchId),
        String(tx.category || category).toUpperCase(),
        formatTransactionAction(tx),
        tx.modelName || tx.modelId,
        tx.quantity,
        (tx.serialNos || []).join(', '),
        tx.partner || '',
        tx.cause || '',
        tx.performedBy || record.lastModifiedBy || '',
      ]);
    });
  });

  const wsAllTx = XLSX.utils.aoa_to_sheet(consolidatedTxRows);
  wsAllTx['!cols'] = [
    { wch: 24 },
    { wch: 13 },
    { wch: 24 },
    { wch: 12 },
    { wch: 18 },
    { wch: 22 },
    { wch: 8 },
    { wch: 24 },
    { wch: 24 },
    { wch: 34 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAllTx, 'All_Transactions_By_LoginID');

  XLSX.writeFile(wb, `${isCharger ? 'Charger' : 'Battery'}_Quantity_Stock_Complete.xlsx`);
}

function getModelLabel(
  item: BatterySerialItem,
  columns: BatteryColumn[],
  category: 'battery' | 'charger' = 'battery'
): string {
  if (item.modelName) return item.modelName;
  if (item.modelId === 'repair') {
    return category === 'charger' ? 'OLD CHARGER FOR REPAIR' : 'OLD BATTERY FOR REPAIR';
  }
  if (item.modelId === 'service') {
    return category === 'charger' ? 'SERVICE CHARGER' : 'SERVICE BATTERY';
  }
  return columns.find((c) => c.id === item.modelId)?.name || item.modelId;
}

function formatStatusLabel(status: BatterySerialItem['status']): string {
  return String(status || 'in_stock').replace(/_/g, ' ').toUpperCase();
}

/**
 * Excel 2: Complete Serial Numbers + Every Movement + Every Daily Transaction & Transfer
 */
export function exportSerialHistoryToExcel(
  serials: Record<string, BatterySerialItem>,
  columns: BatteryColumn[],
  branchId?: string,
  records?: Record<string, DayRecord>,
  transfers?: BranchTransfer[],
  chargerRecords?: Record<string, any>,
  vehicleRecords?: Record<string, any>,
  category: 'battery' | 'charger' = 'battery'
) {
  const isCharger = category === 'charger';
  const modelColHeader = isCharger ? 'Charger Model' : 'Battery Model';
  const serialCatLabel = isCharger ? 'CHARGER SERIAL' : 'BATTERY SERIAL';
  const ledgerCatLabel = isCharger ? 'CHARGER LEDGER' : 'BATTERY LEDGER';
  const repairHeader = isCharger ? 'OLD CHARGER FOR REPAIR' : 'OLD BATTERY FOR REPAIR';
  const serviceHeader = isCharger ? 'SERVICE CHARGER TOTAL' : 'SERVICE BATTERY TOTAL';
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
      modelColHeader,
      'Batch',
      'Branch',
      'Status',
      'Inward Date',
      'Received From / Partner',
      'Inward Cause / Remarks',
      'Inward By (Login ID)',
    ],
    ...inStockList.map((item) => [
      item.serialNo,
      getModelLabel(item, columns, category),
      item.batchNo || '',
      getBranchLabel(item.branchId),
      formatStatusLabel(item.status),
      item.inwardDate || '',
      item.inwardPartner || '',
      item.inwardCause || '',
      item.inwardBy || item.lastUpdatedBy || '',
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
    { wch: 34 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsInStock, 'In_Stock_Serials');

  // Sheet 2: Dispatched / Past Out Serial Numbers
  const dispatchedRows: any[][] = [
    [
      'Serial No.',
      modelColHeader,
      'Batch',
      'Branch',
      'Current Status',
      'Inward Date',
      'Inward Partner / Source',
      'Inward By (Login ID)',
      'Outward (Dispatched) Date',
      'Dispatched To (Vehicle / Dealer)',
      'Outward Cause / Remarks',
      'Outward By (Login ID)',
    ],
    ...dispatchedList.map((item) => [
      item.serialNo,
      getModelLabel(item, columns, category),
      item.batchNo || '',
      getBranchLabel(item.branchId),
      formatStatusLabel(item.status),
      item.inwardDate || '',
      item.inwardPartner || '',
      item.inwardBy || '',
      item.outwardDate || '',
      item.outwardPartner || '',
      item.outwardCause || '',
      item.outwardBy || item.lastUpdatedBy || '',
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
    { wch: 18 },
    { wch: 28 },
    { wch: 34 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDispatched, 'Dispatched_Out_Serials');

  // Sheet 3: All Serial Numbers Master (Every Serial Registered Forever)
  const masterRows: any[][] = [
    [
      'Serial No.',
      modelColHeader,
      'Batch',
      'Branch',
      'Status',
      'Inward Date',
      'Inward Partner',
      'Inward Cause',
      'Inward By (Login ID)',
      'Outward Date',
      'Outward Partner / Vehicle',
      'Outward Cause',
      'Outward By (Login ID)',
      'Last Updated By (Login ID)',
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
        getModelLabel(item, columns, category),
        item.batchNo || '',
        getBranchLabel(item.branchId),
        formatStatusLabel(item.status),
        item.inwardDate || '',
        item.inwardPartner || '',
        item.inwardCause || '',
        item.inwardBy || '',
        item.outwardDate || '',
        item.outwardPartner || '',
        item.outwardCause || '',
        item.outwardBy || '',
        item.lastUpdatedBy || '',
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
    { wch: 28 },
    { wch: 18 },
    { wch: 14 },
    { wch: 26 },
    { wch: 28 },
    { wch: 18 },
    { wch: 20 },
    { wch: 16 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsMaster, isCharger ? 'All_Charger_Serials' : 'All_Battery_Serials');

  // Sheet 4: Complete Chronological Movement & Transaction History (ALL Categories + Login ID)
  interface MovementLogEntry {
    isoDate: string;
    timestamp: string;
    row: any[];
  }
  const movementEntries: MovementLogEntry[] = [];

  allList.forEach((item) => {
    const model = getModelLabel(item, columns, category);
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
            serialCatLabel,
            branchName,
            'IN',
            model,
            1,
            item.serialNo,
            item.inwardPartner || '',
            item.inwardCause || '',
            statusText,
            item.inwardBy || item.lastUpdatedBy || '',
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
            serialCatLabel,
            branchName,
            'OUT (DISPATCHED)',
            model,
            -1,
            item.serialNo,
            item.outwardPartner || '',
            item.outwardCause || '',
            statusText,
            item.outwardBy || item.lastUpdatedBy || '',
            '',
          ],
        });
      }
    } else {
      events.forEach((evt) => {
        const evtType = String(evt.type || '').toUpperCase().replace(/_/g, ' ');
        const isOut = evt.type === 'out' || evt.type === 'repair_out';
        const actor =
          evt.performedBy ||
          (isOut ? item.outwardBy : item.inwardBy) ||
          item.lastUpdatedBy ||
          '';
        movementEntries.push({
          isoDate: toISODateString(evt.date || item.inwardDate || ''),
          timestamp: evt.timestamp || '',
          row: [
            evt.date || '',
            serialCatLabel,
            getBranchLabel(evt.branchId || item.branchId),
            evtType,
            model,
            isOut ? -1 : 1,
            item.serialNo,
            evt.partner || evt.vehicleOrLocation || '',
            evt.cause || evt.notes || '',
            statusText,
            actor,
            evt.timestamp || '',
          ],
        });
      });
    }
  });

  const trackedModels: Array<{ id: string; name: string }> = [
    ...columns.map((c) => ({ id: c.id, name: c.name })),
    { id: 'repair', name: repairHeader },
    { id: 'service', name: isCharger ? 'SERVICE CHARGER' : 'SERVICE BATTERY' },
  ];

  // Include every daily battery ledger transaction (preferring per-transaction entries with loginId)
  Object.entries(records || {}).forEach(([key, rec]) => {
    if (!rec) return;
    const parsed = parseBatteryRecordKey(key);
    const recBranch = rec.branchId || parsed.branchId || DEFAULT_BRANCH_ID;
    const recDate = rec.date || parsed.date;
    if (!recDate) return;
    const branchName = getBranchLabel(recBranch);
    const isoDate = toISODateString(recDate);
    const ts = rec.lastModified || '';
    const txList = Array.isArray(rec.transactions) ? rec.transactions : [];

    if (txList.length > 0) {
      txList.forEach((tx) => {
        movementEntries.push({
          isoDate: toISODateString(tx.date || recDate),
          timestamp: tx.timestamp || ts,
          row: [
            tx.date || recDate,
            ledgerCatLabel,
            getBranchLabel(tx.branchId || recBranch),
            formatTransactionAction(tx),
            tx.modelName || tx.modelId,
            tx.quantity,
            (tx.serialNos || []).join(', '),
            tx.partner || '',
            tx.cause || '',
            'RECORDED',
            tx.performedBy || rec.lastModifiedBy || '',
            tx.timestamp || ts,
          ],
        });
      });
      return;
    }

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
            ledgerCatLabel,
            branchName,
            col.id === 'repair' ? 'REPAIR IN (+)' : col.id === 'service' ? 'SERVICE IN (+)' : 'IN STOCK (+)',
            col.name,
            inQty,
            '',
            '',
            causeStr,
            'RECORDED',
            rec.lastModifiedBy || '',
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
            ledgerCatLabel,
            branchName,
            col.id === 'repair' ? 'REPAIR OUT (-)' : col.id === 'service' ? 'SERVICE OUT (-)' : 'OUT STOCK (-)',
            col.name,
            outQty > 0 ? -outQty : outQty,
            '',
            '',
            causeStr,
            'RECORDED',
            rec.lastModifiedBy || '',
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
          row: [recDate, ledgerCatLabel, branchName, 'IN NOTE', 'All Models', 0, '', '', rec.totalInCause, 'RECORDED', rec.lastModifiedBy || '', ts],
        });
      }
      if (rec.totalOutCause?.trim()) {
        movementEntries.push({
          isoDate,
          timestamp: ts,
          row: [recDate, ledgerCatLabel, branchName, 'OUT NOTE', 'All Models', 0, '', '', rec.totalOutCause, 'RECORDED', rec.lastModifiedBy || '', ts],
        });
      }
    }
  });

  // Include Charger & Vehicle IN/OUT transactions
  const appendSecondaryEntries = (
    mapObj: Record<string, any> | undefined,
    catLabel: 'CHARGER STOCK' | 'VEHICLE STOCK',
    catalog: BatteryColumn[]
  ) => {
    Object.entries(mapObj || {}).forEach(([k, entry]) => {
      if (!entry) return;
      const parsed = parseBatteryRecordKey(k);
      const eBranch = entry.branchId || parsed.branchId || DEFAULT_BRANCH_ID;
      const eDate = entry.date || parsed.date;
      if (!eDate) return;
      const branchName = getBranchLabel(eBranch);
      const ts = entry.updatedAt || '';
      const txList: StockTransactionEntry[] = Array.isArray(entry.transactions) ? entry.transactions : [];

      if (txList.length > 0) {
        txList.forEach((tx) => {
          movementEntries.push({
            isoDate: toISODateString(tx.date || eDate),
            timestamp: tx.timestamp || ts,
            row: [
              tx.date || eDate,
              catLabel,
              getBranchLabel(tx.branchId || eBranch),
              formatTransactionAction(tx),
              tx.modelName || tx.modelId,
              tx.quantity,
              '',
              tx.partner || '',
              tx.cause || '',
              'RECORDED',
              tx.performedBy || entry.updatedBy || '',
              tx.timestamp || ts,
            ],
          });
        });
        return;
      }

      const items = entry.items || {};
      Object.entries(items).forEach(([modelId, row]: [string, any]) => {
        if (!row || typeof row !== 'object') return;
        const modelName = catalog.find((c) => c.id === modelId)?.name || modelId;
        const inQty = Number(row.inward ?? row.in ?? 0);
        const outQty = Number(row.outward ?? row.out ?? 0);
        if (inQty !== 0) {
          movementEntries.push({
            isoDate: toISODateString(eDate),
            timestamp: ts,
            row: [eDate, catLabel, branchName, 'IN (+)', modelName, inQty, '', '', row.inCause || '', 'RECORDED', entry.updatedBy || '', ts],
          });
        }
        if (outQty !== 0) {
          movementEntries.push({
            isoDate: toISODateString(eDate),
            timestamp: ts,
            row: [eDate, catLabel, branchName, 'OUT (-)', modelName, outQty > 0 ? -outQty : outQty, '', '', row.outCause || '', 'RECORDED', entry.updatedBy || '', ts],
          });
        }
      });
    });
  };

  appendSecondaryEntries(chargerRecords, 'CHARGER STOCK', DEFAULT_CHARGER_COLUMNS);
  appendSecondaryEntries(vehicleRecords, 'VEHICLE STOCK', DEFAULT_VEHICLE_COLUMNS);

  // Include every inter-branch transfer
  (transfers || []).forEach((trf) => {
    const isoDate = toISODateString(trf.date || '');
    (trf.items || []).forEach((item) => {
      const ts = item.receivedAt || trf.receivedAt || trf.createdAt || '';
      const actorStr = item.received
        ? `Sent: ${trf.createdBy || '-'} | Rcvd: ${trf.receivedByLoginId || trf.receivedBy || '-'}`
        : trf.createdBy || '';
      movementEntries.push({
        isoDate,
        timestamp: ts,
        row: [
          trf.date || '',
          `BRANCH TRANSFER (${String(trf.category || 'battery').toUpperCase()})`,
          `${trf.fromBranchName} -> ${trf.toBranchName}`,
          `TRANSFER (${String(trf.status || 'pending').toUpperCase()})`,
          item.modelName,
          item.quantity,
          (item.serialNos || []).join(', '),
          trf.partner || trf.toBranchName,
          item.notes || trf.notes || '',
          item.received ? 'RECEIVED' : 'PENDING RECEIVE',
          actorStr,
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
      'Model / Item',
      'Qty',
      'Serial No.(s)',
      'Partner / Vehicle / Destination',
      'Cause / Remarks',
      'Current Status',
      'Done By (Login ID)',
      'Recorded Timestamp',
    ],
    ...movementEntries.map((e) => e.row),
  ];

  const wsHistory = XLSX.utils.aoa_to_sheet(historyRows);
  wsHistory['!cols'] = [
    { wch: 14 },
    { wch: 18 },
    { wch: 28 },
    { wch: 20 },
    { wch: 22 },
    { wch: 8 },
    { wch: 24 },
    { wch: 26 },
    { wch: 36 },
    { wch: 16 },
    { wch: 22 },
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
      repairHeader,
      serviceHeader,
      'Updated By (Login ID)',
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
      rec.lastModifiedBy || '',
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
    { wch: 20 },
    { wch: 24 },
    { wch: 36 },
  ];
  XLSX.utils.book_append_sheet(wb, wsLedger, 'Daily_Transactions_Ledger');

  const todaySlug = getIndianTodayDate();
  const suffix = branchId ? `_${branchId}` : '_All_Branches';
  const filePrefix = isCharger ? 'Charger' : 'Battery';
  XLSX.writeFile(wb, `${filePrefix}_Serials_And_History${suffix}_${todaySlug}.xlsx`);
}

/**
 * Excel Export for Charger Stock or Vehicle Stock (Current Register + Transaction Log with Login ID)
 */
export function exportSecondaryStockToExcel(
  category: 'charger' | 'vehicle',
  branchId: string,
  activeDate: string,
  itemsMap: Record<string, any>,
  columns: BatteryColumn[],
  remoteRecords: Record<string, any>
) {
  const wb = XLSX.utils.book_new();
  const branchName = getBranchLabel(branchId);
  const compositeKey = `${branchId}::${activeDate}`;
  const activeEntry = remoteRecords?.[compositeKey];
  const updatedBy = activeEntry?.updatedBy || '';

  const dailyRows: any[][] = [
    [
      'Branch',
      'Date',
      'Model / Item',
      'Opening',
      'Inward (+)',
      'Inward Remarks',
      'Outward (-)',
      'Outward Remarks',
      'Closing Stock',
      'Last Updated By (Login ID)',
    ],
    ...columns.map((col) => {
      const row = itemsMap?.[col.id] || {};
      const open = Number(row.opening || 0);
      const inQ = Number(row.inward ?? row.in ?? 0);
      const outQ = Number(row.outward ?? row.out ?? 0);
      const closing = open + inQ + outQ;
      return [
        branchName,
        activeDate,
        col.name,
        open,
        inQ,
        row.inCause || '',
        outQ,
        row.outCause || '',
        closing,
        updatedBy,
      ];
    }),
  ];

  const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows);
  wsDaily['!cols'] = [
    { wch: 24 },
    { wch: 13 },
    { wch: 26 },
    { wch: 10 },
    { wch: 12 },
    { wch: 28 },
    { wch: 12 },
    { wch: 28 },
    { wch: 14 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(
    wb,
    wsDaily,
    category === 'charger' ? 'Charger_Register' : 'Vehicle_Register'
  );

  // Sheet 2: Chronological IN/OUT transactions for this category with Done By (Login ID)
  const txRows: any[][] = [
    [
      'Timestamp',
      'Date',
      'Branch',
      'Category',
      'IN / OUT',
      'Model / Item',
      'Qty',
      'Cause / Remarks',
      'Done By (Login ID)',
    ],
  ];

  Object.entries(remoteRecords || {}).forEach(([k, entry]) => {
    if (!entry) return;
    const parsed = parseBatteryRecordKey(k);
    const eBranch = entry.branchId || parsed.branchId || DEFAULT_BRANCH_ID;
    const eDate = entry.date || parsed.date;
    if (!eDate) return;
    const txList: StockTransactionEntry[] = Array.isArray(entry.transactions) ? entry.transactions : [];
    if (txList.length > 0) {
      txList.forEach((tx) => {
        txRows.push([
          tx.timestamp || entry.updatedAt || '',
          tx.date || eDate,
          getBranchLabel(tx.branchId || eBranch),
          category.toUpperCase(),
          formatTransactionAction(tx),
          tx.modelName || tx.modelId,
          tx.quantity,
          tx.cause || '',
          tx.performedBy || entry.updatedBy || '',
        ]);
      });
    } else {
      const items = entry.items || {};
      Object.entries(items).forEach(([modelId, row]: [string, any]) => {
        if (!row || typeof row !== 'object') return;
        const modelName = columns.find((c) => c.id === modelId)?.name || modelId;
        const inQ = Number(row.inward ?? row.in ?? 0);
        const outQ = Number(row.outward ?? row.out ?? 0);
        if (inQ !== 0) {
          txRows.push([
            entry.updatedAt || '',
            eDate,
            getBranchLabel(eBranch),
            category.toUpperCase(),
            'IN (+)',
            modelName,
            inQ,
            row.inCause || '',
            entry.updatedBy || '',
          ]);
        }
        if (outQ !== 0) {
          txRows.push([
            entry.updatedAt || '',
            eDate,
            getBranchLabel(eBranch),
            category.toUpperCase(),
            'OUT (-)',
            modelName,
            outQ > 0 ? -outQ : outQ,
            row.outCause || '',
            entry.updatedBy || '',
          ]);
        }
      });
    }
  });

  const wsTx = XLSX.utils.aoa_to_sheet(txRows);
  wsTx['!cols'] = [
    { wch: 24 },
    { wch: 13 },
    { wch: 24 },
    { wch: 12 },
    { wch: 14 },
    { wch: 26 },
    { wch: 8 },
    { wch: 32 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTx, 'Transaction_Log');

  const label = category === 'charger' ? 'Charger_Stock' : 'EV_Vehicle_Stock';
  XLSX.writeFile(wb, `${label}_${branchId}_${activeDate}.xlsx`);
}

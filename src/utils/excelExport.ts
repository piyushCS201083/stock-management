import * as XLSX from 'xlsx';
import {
  BRANCHES,
  BatteryColumn,
  BatterySerialItem,
  DEFAULT_BRANCH_ID,
  DayRecord,
} from '../types/stock';
import { calculateRecordTotals } from './storage';

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
    '',
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
    '',
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
  const sortedDates = Object.keys(records).sort();

  sortedDates.forEach((dateKey) => {
    const record = records[dateKey];
    const totals = calculateRecordTotals(record, columns);

    const sheetData = [
      ['Date', 'Particulars', ...columns.map((c) => c.name), 'Total', 'OLD BATTERY FOR REPAIR', 'SERVICE BATTERY TOTAL'],
      [record.date, 'Stock', ...columns.map((c) => record.stock[c.id] || 0), totals.openingStockTotal, record.stock['repair'] || 0, record.stock['service'] || 0],
      ['', 'In Stock', ...columns.map((c) => record.inStock[c.id] || 0), totals.inStockTotal, record.inStock['repair'] || 0, record.inStock['service'] || 0],
      ['', 'CAUSE', ...columns.map((c) => record.inCause[c.id] || ''), record.totalInCause || '', record.repairInCause || '', ''],
      ['', 'Out Stock', ...columns.map((c) => record.outStock[c.id] || 0), totals.outStockTotal, record.outStock['repair'] || 0, record.outStock['service'] || 0],
      ['', 'CAUSE', ...columns.map((c) => record.outCause[c.id] || ''), record.totalOutCause || '', record.repairOutCause || '', ''],
      ['', "Today's Stock", ...columns.map((c) => totals.closingStock[c.id] || 0), totals.closingStockTotal, totals.repair.closing, totals.service.closing],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, dateKey.substring(0, 31));
  });

  XLSX.writeFile(wb, `Battery_Quantity_Stock_Complete.xlsx`);
}

function getBranchLabel(branchId?: string): string {
  const id = branchId || DEFAULT_BRANCH_ID;
  return BRANCHES.find((b) => b.id === id)?.name || id;
}

/**
 * Excel 2: Complete Battery Serial Numbers + Past/Dispatched (Out) Serial History
 */
export function exportSerialHistoryToExcel(
  serials: Record<string, BatterySerialItem>,
  columns: BatteryColumn[],
  branchId?: string
) {
  const allList = Object.values(serials || {}).filter((s) =>
    branchId ? (s.branchId || DEFAULT_BRANCH_ID) === branchId : true
  );
  const inStockList = allList.filter((s) => s.status === 'in_stock');
  const dispatchedList = allList.filter(
    (s) => s.status === 'dispatched' || Boolean(s.outwardDate)
  );

  const wb = XLSX.utils.book_new();

  // Sheet 1: Currently In Stock Batteries with Serial Numbers
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
      item.modelName || columns.find((c) => c.id === item.modelId)?.name || item.modelId,
      item.batchNo || '',
      getBranchLabel(item.branchId),
      'IN STOCK',
      item.inwardDate || '',
      item.inwardPartner || '',
      item.inwardCause || '',
    ]),
  ];
  const wsInStock = XLSX.utils.aoa_to_sheet(inStockRows);
  wsInStock['!cols'] = [
    { wch: 22 },
    { wch: 18 },
    { wch: 16 },
    { wch: 22 },
    { wch: 12 },
    { wch: 14 },
    { wch: 24 },
    { wch: 36 },
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
      item.modelName || columns.find((c) => c.id === item.modelId)?.name || item.modelId,
      item.batchNo || '',
      getBranchLabel(item.branchId),
      item.status.toUpperCase(),
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
    { wch: 18 },
    { wch: 16 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 22 },
    { wch: 18 },
    { wch: 28 },
    { wch: 36 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDispatched, 'Dispatched_Out_Serials');

  // Sheet 3: All Serial Numbers Master (In Stock, Dispatched, Repair, Standby)
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
      'History Events Count',
    ],
    ...allList.map((item) => [
      item.serialNo,
      item.modelName || columns.find((c) => c.id === item.modelId)?.name || item.modelId,
      item.batchNo || '',
      getBranchLabel(item.branchId),
      item.status.replace('_', ' ').toUpperCase(),
      item.inwardDate || '',
      item.inwardPartner || '',
      item.inwardCause || '',
      item.outwardDate || '',
      item.outwardPartner || '',
      item.outwardCause || '',
      (item.history || []).length,
    ]),
  ];
  const wsMaster = XLSX.utils.aoa_to_sheet(masterRows);
  wsMaster['!cols'] = [
    { wch: 22 },
    { wch: 18 },
    { wch: 16 },
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 22 },
    { wch: 30 },
    { wch: 14 },
    { wch: 26 },
    { wch: 30 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsMaster, 'All_Battery_Serials');

  // Sheet 4: Complete Movement History Timeline (Every Past IN / OUT / Repair Event)
  const historyRows: any[][] = [
    [
      'Serial No.',
      'Battery Model',
      'Branch',
      'Current Status',
      'Movement Date',
      'Movement Type',
      'Partner / Customer Vehicle',
      'Cause / Remarks',
      'Recorded Timestamp',
    ],
  ];

  allList.forEach((item) => {
    const model = item.modelName || columns.find((c) => c.id === item.modelId)?.name || item.modelId;
    const branchName = getBranchLabel(item.branchId);
    const events = Array.isArray(item.history) ? item.history : [];

    if (events.length === 0) {
      if (item.inwardDate) {
        historyRows.push([
          item.serialNo,
          model,
          branchName,
          item.status.replace('_', ' ').toUpperCase(),
          item.inwardDate,
          'IN',
          item.inwardPartner || '',
          item.inwardCause || '',
          '',
        ]);
      }
      if (item.outwardDate) {
        historyRows.push([
          item.serialNo,
          model,
          branchName,
          item.status.replace('_', ' ').toUpperCase(),
          item.outwardDate,
          'OUT (DISPATCHED)',
          item.outwardPartner || '',
          item.outwardCause || '',
          '',
        ]);
      }
    } else {
      events.forEach((evt) => {
        historyRows.push([
          item.serialNo,
          model,
          getBranchLabel(evt.branchId || item.branchId),
          item.status.replace('_', ' ').toUpperCase(),
          evt.date || '',
          String(evt.type || '').toUpperCase().replace('_', ' '),
          evt.partner || evt.vehicleOrLocation || '',
          evt.cause || evt.notes || '',
          evt.timestamp || '',
        ]);
      });
    }
  });

  const wsHistory = XLSX.utils.aoa_to_sheet(historyRows);
  wsHistory['!cols'] = [
    { wch: 22 },
    { wch: 18 },
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 18 },
    { wch: 28 },
    { wch: 36 },
    { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, wsHistory, 'Past_Movement_History');

  const todaySlug = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
  const suffix = branchId ? `_${branchId}` : '_All_Branches';
  XLSX.writeFile(wb, `Battery_Serials_And_History${suffix}_${todaySlug}.xlsx`);
}

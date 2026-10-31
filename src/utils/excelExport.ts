import * as XLSX from 'xlsx';
import { BatteryColumn, DayRecord } from '../types/stock';
import { calculateRecordTotals } from './storage';

export function exportRecordToExcel(record: DayRecord, columns: BatteryColumn[]) {
  const totals = calculateRecordTotals(record, columns);

  // Headers
  const headerRow = [
    'Date',
    'Particulars',
    ...columns.map(c => c.name),
    'Total',
    'OLD BATTERY FOR REPAIR',
    'SERVICE BATTERY TOTAL',
  ];

  // Stock Row (Opening)
  const stockRow = [
    record.date,
    'Stock',
    ...columns.map(c => record.stock[c.id] || 0),
    totals.openingStockTotal,
    record.stock['repair'] || 0,
    record.stock['service'] || 0,
  ];

  // In Stock Row
  const inStockRow = [
    '',
    'In Stock',
    ...columns.map(c => record.inStock[c.id] || 0),
    totals.inStockTotal,
    record.inStock['repair'] || 0,
    record.inStock['service'] || 0,
  ];

  // In Cause Row
  const inCauseRow = [
    '',
    'CAUSE',
    ...columns.map(c => record.inCause[c.id] || ''),
    record.totalInCause || '',
    record.repairInCause || '',
    '',
  ];

  // Out Stock Row
  const outStockRow = [
    '',
    'Out Stock',
    ...columns.map(c => record.outStock[c.id] || 0),
    totals.outStockTotal,
    record.outStock['repair'] || 0,
    record.outStock['service'] || 0,
  ];

  // Out Cause Row
  const outCauseRow = [
    '',
    'CAUSE',
    ...columns.map(c => record.outCause[c.id] || ''),
    record.totalOutCause || '',
    record.repairOutCause || '',
    '',
  ];

  // Today's Stock Row (Closing)
  const todayStockRow = [
    '',
    "Today's Stock",
    ...columns.map(c => totals.closingStock[c.id] || 0),
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

  // Set column widths
  const colWidths = [
    { wch: 14 }, // Date
    { wch: 14 }, // Particulars
    ...columns.map(() => ({ wch: 15 })),
    { wch: 18 }, // Total
    { wch: 22 }, // Old Battery for repair
    { wch: 22 }, // Service battery total
  ];
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Register_${record.date}`);

  XLSX.writeFile(wb, `Battery_Stock_Register_${record.date}.xlsx`);
}

// Export full history of all recorded days
export function exportAllRecordsToExcel(records: Record<string, DayRecord>, columns: BatteryColumn[]) {
  const wb = XLSX.utils.book_new();
  const sortedDates = Object.keys(records).sort();

  sortedDates.forEach((dateKey) => {
    const record = records[dateKey];
    const totals = calculateRecordTotals(record, columns);

    const sheetData = [
      ['Date', 'Particulars', ...columns.map(c => c.name), 'Total', 'OLD BATTERY FOR REPAIR', 'SERVICE BATTERY TOTAL'],
      [record.date, 'Stock', ...columns.map(c => record.stock[c.id] || 0), totals.openingStockTotal, record.stock['repair'] || 0, record.stock['service'] || 0],
      ['', 'In Stock', ...columns.map(c => record.inStock[c.id] || 0), totals.inStockTotal, record.inStock['repair'] || 0, record.inStock['service'] || 0],
      ['', 'CAUSE', ...columns.map(c => record.inCause[c.id] || ''), record.totalInCause || '', record.repairInCause || '', ''],
      ['', 'Out Stock', ...columns.map(c => record.outStock[c.id] || 0), totals.outStockTotal, record.outStock['repair'] || 0, record.outStock['service'] || 0],
      ['', 'CAUSE', ...columns.map(c => record.outCause[c.id] || ''), record.totalOutCause || '', record.repairOutCause || '', ''],
      ['', "Today's Stock", ...columns.map(c => totals.closingStock[c.id] || 0), totals.closingStockTotal, totals.repair.closing, totals.service.closing],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, dateKey.substring(0, 31));
  });

  XLSX.writeFile(wb, `Battery_Stock_Ledger_Complete.xlsx`);
}

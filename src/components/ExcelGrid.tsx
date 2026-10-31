import React, { useState } from 'react';
import { BatteryColumn, DayRecord } from '../types/stock';
import { calculateRecordTotals } from '../utils/storage';
import { Edit3, Check, RotateCcw, Plus, Trash2, ArrowUpDown } from 'lucide-react';

interface ExcelGridProps {
  record: DayRecord;
  columns: BatteryColumn[];
  onUpdateRecord: (updated: DayRecord) => void;
  onAddColumn?: (name: string) => void;
  onRemoveColumn?: (id: string) => void;
  isCapturing?: boolean; // When capturing image, keep full crisp dimensions and no temporary edit borders
  tableRef?: React.RefObject<HTMLDivElement | null>;
}

export const ExcelGrid: React.FC<ExcelGridProps> = ({
  record,
  columns,
  onUpdateRecord,
  onAddColumn,
  onRemoveColumn,
  isCapturing = false,
  tableRef,
}) => {
  const totals = calculateRecordTotals(record, columns);
  const [editingCell, setEditingCell] = useState<{ row: string; colId: string } | null>(null);
  const [tempValue, setTempValue] = useState<string>('');
  const [newColName, setNewColName] = useState('');
  const [showAddCol, setShowAddCol] = useState(false);

  const startEdit = (row: string, colId: string, currentVal: number | string) => {
    if (isCapturing) return;
    setEditingCell({ row, colId });
    setTempValue(String(currentVal ?? ''));
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { row, colId } = editingCell;
    const updated = { ...record };

    if (row === 'stock') {
      const num = parseInt(tempValue, 10);
      updated.stock = { ...updated.stock, [colId]: isNaN(num) ? 0 : num };
    } else if (row === 'inStock') {
      const num = parseInt(tempValue, 10);
      updated.inStock = { ...updated.inStock, [colId]: isNaN(num) ? 0 : Math.abs(num) };
    } else if (row === 'inCause') {
      if (colId === 'total') {
        updated.totalInCause = tempValue;
      } else if (colId === 'repair') {
        updated.repairInCause = tempValue;
      } else {
        updated.inCause = { ...updated.inCause, [colId]: tempValue };
      }
    } else if (row === 'outStock') {
      const num = parseInt(tempValue, 10);
      // Ensure outStock is stored as negative number (e.g., -1) to match spreadsheet conventions
      const finalVal = isNaN(num) ? 0 : (num > 0 ? -num : num);
      updated.outStock = { ...updated.outStock, [colId]: finalVal };
    } else if (row === 'outCause') {
      if (colId === 'total') {
        updated.totalOutCause = tempValue;
      } else if (colId === 'repair') {
        updated.repairOutCause = tempValue;
      } else {
        updated.outCause = { ...updated.outCause, [colId]: tempValue };
      }
    }

    updated.lastModified = new Date().toISOString();
    onUpdateRecord(updated);
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  const handleAddColumnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newColName.trim() && onAddColumn) {
      onAddColumn(newColName.trim());
      setNewColName('');
      setShowAddCol(false);
    }
  };

  return (
    <div className="w-full">
      {/* Optional Top Mini-Toolbar for Column Addition */}
      {!isCapturing && (
        <div className="flex items-center justify-between pb-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-700">Daily Stock Sheet:</span>
            <span className="font-semibold text-blue-700">{record.date}</span>
            <span className="text-slate-400">· Click any cell to edit directly</span>
          </div>

          <div className="flex items-center gap-2">
            {onAddColumn && (
              <>
                {!showAddCol ? (
                  <button
                    onClick={() => setShowAddCol(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Battery Model</span>
                  </button>
                ) : (
                  <form onSubmit={handleAddColumnSubmit} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="e.g. 72×30 OLD"
                      value={newColName}
                      onChange={(e) => setNewColName(e.target.value)}
                      className="px-2 py-1 text-xs border border-blue-400 rounded bg-white text-slate-800 focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddCol(false)}
                      className="px-2 py-1 text-xs text-slate-600 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Spreadsheet Canvas Container (Ref for html-to-image capture) */}
      <div className="w-full overflow-x-auto border border-slate-300 shadow-sm bg-white rounded-none">
        <div
          ref={tableRef}
          id="battery-stock-sheet-table"
          className="w-max min-w-[1430px] select-text bg-white"
          style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
        >
          <table className="min-w-[1430px] border-collapse border border-slate-400 text-sm table-fixed">
            <thead>
              {/* Header Row - Royal Blue (#3066be) with Excel Centered Filters */}
              <tr className="bg-[#3066be] text-white text-[13px] font-bold tracking-tight">
                {/* Date */}
                <th className="w-[105px] min-w-[100px] p-0 border border-[#20498b] text-center font-bold">
                  <div className="flex flex-col items-center justify-between min-h-[56px] py-1.5 px-1">
                    <span className="text-[13px] font-bold text-white tracking-tight">Date</span>
                    <div className="mt-1">
                      <span className="w-3.5 h-3.5 bg-white border border-[#94a3b8] rounded-[2px] inline-flex items-center justify-center shadow-xs">
                        <span className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3.5px] border-t-[#224f94]"></span>
                      </span>
                    </div>
                  </div>
                </th>

                {/* Particulars */}
                <th className="w-[115px] min-w-[110px] p-0 border border-[#20498b] text-center font-bold">
                  <div className="flex flex-col items-center justify-between min-h-[56px] py-1.5 px-1">
                    <span className="text-[13px] font-bold text-white tracking-tight">Particulars</span>
                    <div className="mt-1">
                      <span className="w-3.5 h-3.5 bg-white border border-[#94a3b8] rounded-[2px] inline-flex items-center justify-center shadow-xs">
                        <span className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3.5px] border-t-[#224f94]"></span>
                      </span>
                    </div>
                  </div>
                </th>

                {/* Battery Columns - Centered name with centered Excel filter button below */}
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className="w-[98px] min-w-[94px] p-0 border border-[#20498b] text-center font-bold"
                  >
                    <div className="flex flex-col items-center justify-between min-h-[56px] py-1.5 px-1">
                      <div className="flex flex-col items-center justify-center flex-1">
                        <span className="text-[12.5px] font-bold text-white leading-tight whitespace-nowrap">
                          {col.name}
                        </span>
                      </div>
                      <div className="mt-1">
                        <span className="w-3.5 h-3.5 bg-white border border-[#94a3b8] rounded-[2px] inline-flex items-center justify-center shadow-xs">
                          <span className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3.5px] border-t-[#224f94]"></span>
                        </span>
                      </div>
                    </div>
                  </th>
                ))}

                {/* Total */}
                <th className="w-[90px] min-w-[85px] p-0 border border-[#20498b] text-center font-bold">
                  <div className="flex flex-col items-center justify-between min-h-[56px] py-1.5 px-1">
                    <span className="text-[13px] font-bold text-white tracking-tight">Total</span>
                    <div className="mt-1">
                      <span className="w-3.5 h-3.5 bg-white border border-[#94a3b8] rounded-[2px] inline-flex items-center justify-center shadow-xs">
                        <span className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3.5px] border-t-[#224f94]"></span>
                      </span>
                    </div>
                  </div>
                </th>

                {/* OLD BATTERY FOR REPAIR - 2 lines, centered, no filter */}
                <th className="w-[126px] min-w-[120px] p-0 border border-[#20498b] text-center font-bold">
                  <div className="flex flex-col items-center justify-center min-h-[56px] py-1.5 px-1 leading-snug">
                    <span className="text-[11.5px] font-bold text-white text-center">OLD BATTERY</span>
                    <span className="text-[11.5px] font-bold text-white text-center">FOR REPAIR</span>
                  </div>
                </th>

                {/* SERVICE BATTERY TOTAL - 3 lines, centered, no filter */}
                <th className="w-[110px] min-w-[105px] p-0 border border-[#20498b] text-center font-bold">
                  <div className="flex flex-col items-center justify-center min-h-[56px] py-1.5 px-1 leading-tight">
                    <span className="text-[11px] font-bold text-white text-center">SERVICE</span>
                    <span className="text-[11px] font-bold text-white text-center">BATTERY</span>
                    <span className="text-[11px] font-bold text-white text-center">TOTAL</span>
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              {/* Row 1: Stock (Opening Stock) - Pale Icy Blue (#eaf2fd) */}
              <tr className="bg-[#eaf2fd] hover:bg-[#e1edfc] transition-colors font-medium">
                {/* Date Cell (Merged visually across the daily block) */}
                <td
                  rowSpan={5}
                  className="border border-slate-400 text-center font-bold text-slate-900 text-[13px] bg-white align-middle px-1"
                >
                  <div>
                    <span className="block text-[14px] font-extrabold text-slate-800 tracking-tight">
                      {record.date}
                    </span>
                    {!isCapturing && (
                      <span className="block text-[10px] text-slate-400 mt-1 uppercase font-normal">
                        Daily Block
                      </span>
                    )}
                  </div>
                </td>

                {/* Particulars: Stock */}
                <td className="border border-slate-400 text-center font-bold text-slate-800 py-2.5 px-2">
                  Stock
                </td>

                {/* Stock values for battery columns */}
                {columns.map((col) => {
                  const val = record.stock[col.id] || 0;
                  const isEditing = editingCell?.row === 'stock' && editingCell?.colId === col.id;

                  return (
                    <td
                      key={col.id}
                      onClick={() => !isEditing && startEdit('stock', col.id, val)}
                      className={`border border-slate-400 text-center py-2 px-1 font-bold text-slate-900 tabular-nums cursor-pointer transition-colors ${
                        isEditing ? 'bg-amber-100 ring-2 ring-blue-500' : 'hover:bg-blue-100/50'
                      }`}
                    >
                      {isEditing ? (
                        <input
                          type="number"
                          value={tempValue}
                          onChange={(e) => setTempValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleKeyDown}
                          className="w-full text-center font-bold bg-white text-slate-900 rounded outline-none px-1"
                          autoFocus
                        />
                      ) : (
                        val
                      )}
                    </td>
                  );
                })}

                {/* Stock Total */}
                <td className="border border-slate-400 text-center font-bold text-slate-900 py-2 px-1 tabular-nums bg-[#dbe8f9]">
                  {totals.openingStockTotal}
                </td>

                {/* Old Battery for repair Stock */}
                <td
                  onClick={() => startEdit('stock', 'repair', record.stock['repair'] || 0)}
                  className="border border-slate-400 text-center font-bold text-slate-900 py-2 px-1 tabular-nums cursor-pointer hover:bg-blue-100/50"
                >
                  {editingCell?.row === 'stock' && editingCell?.colId === 'repair' ? (
                    <input
                      type="number"
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full text-center font-bold bg-white outline-none px-1"
                      autoFocus
                    />
                  ) : (
                    record.stock['repair'] || 0
                  )}
                </td>

                {/* Service Battery Total Stock */}
                <td
                  onClick={() => startEdit('stock', 'service', record.stock['service'] || 0)}
                  className="border border-slate-400 text-center font-bold text-slate-900 py-2 px-1 tabular-nums cursor-pointer hover:bg-blue-100/50"
                >
                  {editingCell?.row === 'stock' && editingCell?.colId === 'service' ? (
                    <input
                      type="number"
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full text-center font-bold bg-white outline-none px-1"
                      autoFocus
                    />
                  ) : (
                    record.stock['service'] || 0
                  )}
                </td>
              </tr>

              {/* Row 2: In Stock - Light Cream/Yellow (#fff9db) */}
              <tr className="bg-[#fff9db] hover:bg-[#fff5cd] transition-colors">
                <td className="border border-slate-400 text-center font-medium text-slate-800 py-2.5 px-2">
                  In Stock
                </td>

                {columns.map((col) => {
                  const val = record.inStock[col.id] || 0;
                  const isEditing = editingCell?.row === 'inStock' && editingCell?.colId === col.id;

                  return (
                    <td
                      key={col.id}
                      onClick={() => !isEditing && startEdit('inStock', col.id, val)}
                      className={`border border-slate-400 text-center py-2 px-1 font-semibold tabular-nums cursor-pointer ${
                        val > 0 ? 'text-emerald-700 font-bold' : 'text-slate-600'
                      } ${isEditing ? 'bg-amber-100 ring-2 ring-emerald-500' : 'hover:bg-amber-100/60'}`}
                    >
                      {isEditing ? (
                        <input
                          type="number"
                          value={tempValue}
                          onChange={(e) => setTempValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleKeyDown}
                          className="w-full text-center font-bold bg-white outline-none px-1"
                          autoFocus
                        />
                      ) : (
                        val
                      )}
                    </td>
                  );
                })}

                {/* In Stock Total */}
                <td className="border border-slate-400 text-center font-bold text-emerald-700 py-2 px-1 tabular-nums bg-[#fff2ba]">
                  {totals.inStockTotal}
                </td>

                {/* In Stock Repair */}
                <td
                  onClick={() => startEdit('inStock', 'repair', record.inStock['repair'] || 0)}
                  className="border border-slate-400 text-center font-bold text-emerald-700 py-2 px-1 tabular-nums cursor-pointer hover:bg-amber-100/60"
                >
                  {editingCell?.row === 'inStock' && editingCell?.colId === 'repair' ? (
                    <input
                      type="number"
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full text-center font-bold bg-white outline-none px-1"
                      autoFocus
                    />
                  ) : (
                    record.inStock['repair'] || 0
                  )}
                </td>

                {/* In Stock Service */}
                <td
                  onClick={() => startEdit('inStock', 'service', record.inStock['service'] || 0)}
                  className="border border-slate-400 text-center font-bold text-emerald-700 py-2 px-1 tabular-nums cursor-pointer hover:bg-amber-100/60"
                >
                  {editingCell?.row === 'inStock' && editingCell?.colId === 'service' ? (
                    <input
                      type="number"
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full text-center font-bold bg-white outline-none px-1"
                      autoFocus
                    />
                  ) : (
                    record.inStock['service'] || 0
                  )}
                </td>
              </tr>

              {/* Row 3: CAUSE (In Stock) - Light Cream/Yellow */}
              <tr className="bg-[#fff9db] text-[11px] leading-tight text-slate-800">
                <td className="border border-slate-400 text-center font-semibold text-slate-700 py-4 px-2">
                  CAUSE
                </td>

                {columns.map((col) => {
                  const cause = record.inCause[col.id] || '';
                  const isEditing = editingCell?.row === 'inCause' && editingCell?.colId === col.id;

                  return (
                    <td
                      key={col.id}
                      onClick={() => !isEditing && startEdit('inCause', col.id, cause)}
                      className={`border border-slate-400 p-1.5 align-middle text-center cursor-pointer ${
                        isEditing ? 'bg-amber-100 ring-2 ring-emerald-500' : 'hover:bg-amber-100/60'
                      }`}
                    >
                      {isEditing ? (
                        <textarea
                          value={tempValue}
                          onChange={(e) => setTempValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleKeyDown}
                          rows={2}
                          className="w-full text-xs p-1 bg-white border border-slate-300 rounded outline-none"
                          autoFocus
                        />
                      ) : (
                        <span className="whitespace-pre-line block">{cause || '—'}</span>
                      )}
                    </td>
                  );
                })}

                {/* Total Inward Cause */}
                <td
                  onClick={() => startEdit('inCause', 'total', record.totalInCause || '')}
                  className="border border-slate-400 p-1.5 align-middle text-center cursor-pointer hover:bg-amber-100/60 bg-[#fff2ba]"
                >
                  {editingCell?.row === 'inCause' && editingCell?.colId === 'total' ? (
                    <textarea
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      rows={2}
                      className="w-full text-xs p-1 bg-white border border-slate-300 rounded outline-none"
                      autoFocus
                    />
                  ) : (
                    <span className="whitespace-pre-line block font-medium">
                      {record.totalInCause || '—'}
                    </span>
                  )}
                </td>

                {/* Repair Inward Cause */}
                <td
                  onClick={() => startEdit('inCause', 'repair', record.repairInCause || '')}
                  className="border border-slate-400 p-1.5 align-middle text-center cursor-pointer hover:bg-amber-100/60"
                >
                  {editingCell?.row === 'inCause' && editingCell?.colId === 'repair' ? (
                    <textarea
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      rows={2}
                      className="w-full text-xs p-1 bg-white border border-slate-300 rounded outline-none"
                      autoFocus
                    />
                  ) : (
                    <span className="whitespace-pre-line block font-medium">
                      {record.repairInCause || '—'}
                    </span>
                  )}
                </td>

                {/* Service Inward Cause */}
                <td className="border border-slate-400 p-1.5 align-middle text-center text-slate-400">
                  —
                </td>
              </tr>

              {/* Row 4: Out Stock - Light Pink/Peach (#ffebe6) */}
              <tr className="bg-[#ffebe6] hover:bg-[#ffe3dc] transition-colors">
                <td className="border border-slate-400 text-center font-medium text-slate-800 py-2.5 px-2">
                  Out Stock
                </td>

                {columns.map((col) => {
                  const val = record.outStock[col.id] || 0;
                  const isEditing = editingCell?.row === 'outStock' && editingCell?.colId === col.id;

                  return (
                    <td
                      key={col.id}
                      onClick={() => !isEditing && startEdit('outStock', col.id, val)}
                      className={`border border-slate-400 text-center py-2 px-1 font-semibold tabular-nums cursor-pointer ${
                        val < 0 ? 'text-rose-700 font-bold' : 'text-slate-600'
                      } ${isEditing ? 'bg-rose-100 ring-2 ring-rose-500' : 'hover:bg-rose-100/60'}`}
                    >
                      {isEditing ? (
                        <input
                          type="number"
                          value={tempValue}
                          onChange={(e) => setTempValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleKeyDown}
                          className="w-full text-center font-bold bg-white outline-none px-1"
                          autoFocus
                        />
                      ) : (
                        val
                      )}
                    </td>
                  );
                })}

                {/* Out Stock Total */}
                <td className="border border-slate-400 text-center font-bold text-rose-700 py-2 px-1 tabular-nums bg-[#fddad2]">
                  {totals.outStockTotal}
                </td>

                {/* Out Stock Repair */}
                <td
                  onClick={() => startEdit('outStock', 'repair', record.outStock['repair'] || 0)}
                  className="border border-slate-400 text-center font-bold text-rose-700 py-2 px-1 tabular-nums cursor-pointer hover:bg-rose-100/60"
                >
                  {editingCell?.row === 'outStock' && editingCell?.colId === 'repair' ? (
                    <input
                      type="number"
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full text-center font-bold bg-white outline-none px-1"
                      autoFocus
                    />
                  ) : (
                    record.outStock['repair'] || 0
                  )}
                </td>

                {/* Out Stock Service */}
                <td
                  onClick={() => startEdit('outStock', 'service', record.outStock['service'] || 0)}
                  className="border border-slate-400 text-center font-bold text-rose-700 py-2 px-1 tabular-nums cursor-pointer hover:bg-rose-100/60"
                >
                  {editingCell?.row === 'outStock' && editingCell?.colId === 'service' ? (
                    <input
                      type="number"
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full text-center font-bold bg-white outline-none px-1"
                      autoFocus
                    />
                  ) : (
                    record.outStock['service'] || 0
                  )}
                </td>
              </tr>

              {/* Row 5: CAUSE (Out Stock) - Light Pink/Peach */}
              <tr className="bg-[#ffebe6] text-[11px] leading-tight text-slate-800">
                <td className="border border-slate-400 text-center font-semibold text-slate-700 py-4 px-2">
                  CAUSE
                </td>

                {columns.map((col) => {
                  const cause = record.outCause[col.id] || '';
                  const isEditing = editingCell?.row === 'outCause' && editingCell?.colId === col.id;

                  return (
                    <td
                      key={col.id}
                      onClick={() => !isEditing && startEdit('outCause', col.id, cause)}
                      className={`border border-slate-400 p-1.5 align-middle text-center cursor-pointer ${
                        isEditing ? 'bg-rose-100 ring-2 ring-rose-500' : 'hover:bg-rose-100/60'
                      }`}
                    >
                      {isEditing ? (
                        <textarea
                          value={tempValue}
                          onChange={(e) => setTempValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleKeyDown}
                          rows={2}
                          className="w-full text-xs p-1 bg-white border border-slate-300 rounded outline-none"
                          autoFocus
                        />
                      ) : (
                        <span className="whitespace-pre-line block">{cause || '—'}</span>
                      )}
                    </td>
                  );
                })}

                {/* Total Outward Cause */}
                <td
                  onClick={() => startEdit('outCause', 'total', record.totalOutCause || '')}
                  className="border border-slate-400 p-1.5 align-middle text-center cursor-pointer hover:bg-rose-100/60 bg-[#fddad2]"
                >
                  {editingCell?.row === 'outCause' && editingCell?.colId === 'total' ? (
                    <textarea
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      rows={2}
                      className="w-full text-xs p-1 bg-white border border-slate-300 rounded outline-none"
                      autoFocus
                    />
                  ) : (
                    <span className="whitespace-pre-line block font-medium">
                      {record.totalOutCause || '—'}
                    </span>
                  )}
                </td>

                {/* Repair Outward Cause */}
                <td
                  onClick={() => startEdit('outCause', 'repair', record.repairOutCause || '')}
                  className="border border-slate-400 p-1.5 align-middle text-center cursor-pointer hover:bg-rose-100/60"
                >
                  {editingCell?.row === 'outCause' && editingCell?.colId === 'repair' ? (
                    <textarea
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      rows={3}
                      className="w-full text-xs p-1 bg-white border border-slate-300 rounded outline-none"
                      autoFocus
                    />
                  ) : (
                    <span className="whitespace-pre-line block font-medium">
                      {record.repairOutCause || '—'}
                    </span>
                  )}
                </td>

                {/* Service Outward Cause */}
                <td className="border border-slate-400 p-1.5 align-middle text-center text-slate-400">
                  —
                </td>
              </tr>

              {/* Row 6: Today's Stock - Light Mint Sage (#e2f0d9) */}
              <tr className="bg-[#e2f0d9] hover:bg-[#d8ebd0] transition-colors font-bold">
                <td className="border border-slate-400 bg-white">
                  {/* Empty cell matching rowSpan=5 layout */}
                </td>

                <td className="border border-slate-400 text-center font-extrabold text-slate-900 py-2.5 px-2 text-[13px]">
                  Today's Stock
                </td>

                {columns.map((col) => {
                  const closing = totals.closingStock[col.id] || 0;
                  return (
                    <td
                      key={col.id}
                      className="border border-slate-400 text-center py-2.5 px-1 font-extrabold text-slate-900 tabular-nums text-[13px]"
                    >
                      {closing}
                    </td>
                  );
                })}

                {/* Today's Stock Total */}
                <td className="border border-slate-400 text-center font-black text-slate-950 py-2.5 px-1 tabular-nums text-[13.5px] bg-[#cde4c2]">
                  {totals.closingStockTotal}
                </td>

                {/* Today's Repair Stock */}
                <td className="border border-slate-400 text-center font-extrabold text-slate-900 py-2.5 px-1 tabular-nums text-[13px]">
                  {totals.repair.closing}
                </td>

                {/* Today's Service Stock */}
                <td className="border border-slate-400 text-center font-extrabold text-slate-900 py-2.5 px-1 tabular-nums text-[13px]">
                  {totals.service.closing}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

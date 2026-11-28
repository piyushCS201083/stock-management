import React, { useState, useEffect, useRef } from 'react';
import {
  ALL_STOCK_CATEGORIES,
  BatteryColumn,
  DEFAULT_VEHICLE_COLUMNS,
  BranchInfo,
  StockCategoryId,
  StockTransactionEntry,
} from '../types/stock';
import { apiSaveVehicleRecord } from '../services/api';
import {
  Car,
  Send,
  CheckCircle2,
  ArrowRight,
  Plus,
  FileSpreadsheet,
  Lock,
  History,
  UserCheck,
} from 'lucide-react';
import { getIndianCurrentTime } from '../utils/date';

const buildEmptyVehicleRecord = (cols: BatteryColumn[]) => {
  const init: Record<
    string,
    {
      opening: number;
      inward: number;
      inCause: string;
      outward: number;
      outCause: string;
    }
  > = {};
  cols.forEach((col) => {
    init[col.id] = { opening: 0, inward: 0, inCause: '', outward: 0, outCause: '' };
  });
  return init;
};

interface VehicleStockViewProps {
  branch: BranchInfo;
  onSwitchStockCategory: (category: StockCategoryId) => void;
  onOpenBranchPortal: () => void;
  activeDate: string;
  remoteVehicleRecords?: Record<string, any>;
  onSaveVehicleRecord?: (branchId: string, date: string, record: Record<string, any>) => void;
  isCloudDbConnected?: boolean;
  allowedCategories?: StockCategoryId[];
  canSwitchBranch?: boolean;
  currentLoginId?: string;
  isAdminAuthenticated?: boolean;
  onDownloadExcel?: (itemsMap: Record<string, any>) => void;
}

export const VehicleStockView: React.FC<VehicleStockViewProps> = ({
  branch,
  onSwitchStockCategory,
  onOpenBranchPortal,
  activeDate,
  remoteVehicleRecords,
  onSaveVehicleRecord,
  isCloudDbConnected = false,
  allowedCategories = ALL_STOCK_CATEGORIES,
  canSwitchBranch = true,
  currentLoginId,
  isAdminAuthenticated = false,
  onDownloadExcel,
}) => {
  const [columns, setColumns] = useState<BatteryColumn[]>(DEFAULT_VEHICLE_COLUMNS);
  const [newModelName, setNewModelName] = useState('');
  const [showAddModel, setShowAddModel] = useState(false);

  const compositeKey = `${branch.id}::${activeDate}`;
  const remoteEntry = remoteVehicleRecords?.[compositeKey];
  const lastUpdatedBy: string | undefined = remoteEntry?.updatedBy;
  const dayTransactions: StockTransactionEntry[] = Array.isArray(remoteEntry?.transactions)
    ? remoteEntry.transactions
    : [];
  const [vehicleRecord, setVehicleRecord] = useState<
    Record<
      string,
      {
        opening: number;
        inward: number;
        inCause: string;
        outward: number;
        outCause: string;
      }
    >
  >(() => {
    const remote = remoteVehicleRecords?.[compositeKey]?.items;
    return remote || buildEmptyVehicleRecord(DEFAULT_VEHICLE_COLUMNS);
  });

  const [toast, setToast] = useState<string | null>(null);
  const saveTimerRef = useRef<any>(null);
  const lastLocalEditAtRef = useRef<number>(0);

  useEffect(() => {
    if (saveTimerRef.current) return;
    if (Date.now() - lastLocalEditAtRef.current < 6000) return;

    const remote = remoteVehicleRecords?.[compositeKey]?.items;
    if (remote) {
      setVehicleRecord(remote);
      // Include any custom models present in remote record
      const extraCols = Object.keys(remote)
        .filter((id) => !columns.some((c) => c.id === id))
        .map((id) => ({
          id,
          name: id
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' '),
        }));
      if (extraCols.length > 0) {
        setColumns((prev) => [...prev, ...extraCols]);
      }
      return;
    }

    // Carry forward closing stock from latest prior record for this branch if available
    if (remoteVehicleRecords) {
      const prefix = `${branch.id}::`;
      const priorEntries = Object.entries(remoteVehicleRecords)
        .filter(([k]) => k.startsWith(prefix) && k !== compositeKey)
        .sort(([, a]: any, [, b]: any) =>
          String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || ''))
        );
      if (priorEntries.length > 0 && priorEntries[0][1]?.items) {
        const prevItems = priorEntries[0][1].items;
        const carried: Record<string, any> = {};
        const knownIds = new Set([
          ...columns.map((c) => c.id),
          ...Object.keys(prevItems),
        ]);
        knownIds.forEach((id) => {
          const r = prevItems[id] || { opening: 0, inward: 0, outward: 0 };
          const closing = (r.opening || 0) + (r.inward || 0) + (r.outward || 0);
          carried[id] = { opening: closing, inward: 0, inCause: '', outward: 0, outCause: '' };
        });
        setVehicleRecord(carried);
        return;
      }
    }

    setVehicleRecord(buildEmptyVehicleRecord(columns));
  }, [compositeKey, remoteVehicleRecords, branch.id, columns]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const persistRecord = (next: Record<string, any>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      lastLocalEditAtRef.current = Date.now();
      if (onSaveVehicleRecord) {
        onSaveVehicleRecord(branch.id, activeDate, next);
      } else {
        apiSaveVehicleRecord(branch.id, activeDate, next).catch(() => {});
      }
      showToast(
        isCloudDbConnected
          ? '✓ Vehicle stock synced to Supabase & Cloud Space'
          : '✓ Vehicle stock saved & live synced'
      );
    }, 450);
  };

  const handleUpdateField = (
    colId: string,
    field: 'opening' | 'inward' | 'inCause' | 'outward' | 'outCause',
    val: any
  ) => {
    lastLocalEditAtRef.current = Date.now();
    setVehicleRecord((prev) => {
      const next = {
        ...prev,
        [colId]: {
          ...(prev[colId] || { opening: 0, inward: 0, inCause: '', outward: 0, outCause: '' }),
          [field]: val,
        },
      };
      persistRecord(next);
      return next;
    });
  };

  const handleAddVehicleModel = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newModelName.trim();
    if (!clean) return;
    const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!id || columns.some((c) => c.id === id)) {
      showToast('Vehicle model already exists');
      return;
    }
    setColumns((prev) => [...prev, { id, name: clean }]);
    setVehicleRecord((prev) => {
      const next = {
        ...prev,
        [id]: { opening: 0, inward: 0, inCause: '', outward: 0, outCause: '' },
      };
      persistRecord(next);
      return next;
    });
    setNewModelName('');
    setShowAddModel(false);
    showToast(`Added vehicle model: ${clean}`);
  };

  let totalOpening = 0;
  let totalInward = 0;
  let totalOutward = 0;
  let totalClosing = 0;

  columns.forEach((col) => {
    const row = vehicleRecord[col.id] || { opening: 0, inward: 0, inCause: '', outward: 0, outCause: '' };
    totalOpening += row.opening || 0;
    totalInward += row.inward || 0;
    totalOutward += Math.abs(row.outward || 0);
    totalClosing += (row.opening || 0) + (row.inward || 0) + (row.outward || 0);
  });

  const handleShareWhatsApp = () => {
    const text = `🚗 *DAILY VEHICLE STOCK REGISTER - ${branch.name.toUpperCase()}*\n📅 *Date:* ${activeDate}\n━━━━━━━━━━━━━━━━━━━━━━\n🏭 *Opening Vehicles:* ${totalOpening} units\n📥 *Inward (+):* +${totalInward} units\n📤 *Outward (-):* -${totalOutward} units\n📦 *Today's Closing Stock:* ${totalClosing} units\n\n_Updated at: ${getIndianCurrentTime()}_`;
    window.open(`https://api.whatsapp.com/send?phone=919009156696&text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-2xl border border-slate-700 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Top Context & Switcher Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl">
            <Car className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-200">
                {branch.name}
              </span>
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-200">
                Vehicle Stock Register
              </span>
              {currentLoginId && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-300">
                  <UserCheck className="w-3 h-3 text-blue-600" />
                  <span>Login: {currentLoginId}</span>
                </span>
              )}
              {lastUpdatedBy && (
                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Last Saved By: {lastUpdatedBy}
                </span>
              )}
            </div>
            <h2 className="text-base font-extrabold text-slate-900 mt-0.5">
              EV Vehicle & Chassis Daily Stock Ledger
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Location: <strong>{branch.address}</strong> · Contact: Piyush Shivhare (9009156696)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {allowedCategories.includes('battery') && (
            <button
              onClick={() => onSwitchStockCategory('battery')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <span>Battery Stock</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {allowedCategories.includes('charger') && (
            <button
              onClick={() => onSwitchStockCategory('charger')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <span>Charger Stock</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onOpenBranchPortal}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors cursor-pointer"
          >
            <span>{canSwitchBranch ? 'Change Branch (1-5)' : 'Branch Categories'}</span>
          </button>
          {onDownloadExcel && (
            <button
              type="button"
              onClick={() => onDownloadExcel(vehicleRecord)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-900 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-lg transition-colors cursor-pointer shadow-xs"
              title={
                isAdminAuthenticated
                  ? 'Download Vehicle Stock Excel (.xlsx) with Login ID Transaction Log'
                  : 'Admin login required to download Vehicle Excel (.xlsx)'
              }
            >
              {!isAdminAuthenticated && <Lock className="w-3 h-3 text-emerald-800" />}
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-800" />
              <span>Excel (.xlsx)</span>
            </button>
          )}
          <button
            onClick={handleShareWhatsApp}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>WhatsApp Share</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Opening Vehicles</span>
          <div className="text-xl sm:text-2xl font-black text-slate-900 font-mono mt-1">{totalOpening}</div>
          <span className="text-[10px] text-slate-400">Units at start of day</span>
        </div>
        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 shadow-2xs">
          <span className="text-[11px] font-bold text-emerald-700 uppercase">Today's Inward</span>
          <div className="text-xl sm:text-2xl font-black text-emerald-800 font-mono mt-1">+{totalInward}</div>
          <span className="text-[10px] text-emerald-600">Manufactured / received</span>
        </div>
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/50 shadow-2xs">
          <span className="text-[11px] font-bold text-rose-700 uppercase">Today's Outward</span>
          <div className="text-xl sm:text-2xl font-black text-rose-800 font-mono mt-1">-{totalOutward}</div>
          <span className="text-[10px] text-rose-600">Dispatched & delivered</span>
        </div>
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/70 shadow-2xs">
          <span className="text-[11px] font-bold text-blue-700 uppercase">Today's Closing Stock</span>
          <div className="text-xl sm:text-2xl font-black text-blue-900 font-mono mt-1">{totalClosing}</div>
          <span className="text-[10px] text-blue-600">Verified balance in branch</span>
        </div>
      </div>

      {/* Vehicle Spreadsheet Grid */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold">Vehicle Stock Ledger Table — {branch.shortName}</h3>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {lastUpdatedBy && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-emerald-300">
                Done By: {lastUpdatedBy}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowAddModel((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Vehicle Model</span>
            </button>
            <span className="text-xs font-mono text-slate-300">Date: {activeDate}</span>
          </div>
        </div>

        {showAddModel && (
          <form
            onSubmit={handleAddVehicleModel}
            className="px-5 py-3 bg-emerald-50 border-b border-emerald-200 flex items-center gap-2 flex-wrap"
          >
            <input
              type="text"
              value={newModelName}
              onChange={(e) => setNewModelName(e.target.value)}
              placeholder="Enter new vehicle model name (e.g. E-Rickshaw Super Deluxe)"
              className="flex-1 min-w-[220px] px-3 py-1.5 text-xs border border-emerald-300 rounded-lg bg-white"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
            >
              Save Model
            </button>
            <button
              type="button"
              onClick={() => setShowAddModel(false)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-center">
                <th className="py-2.5 px-3 text-left border-r border-slate-200 w-48">Vehicle Model</th>
                <th className="py-2.5 px-3 border-r border-slate-200 w-24">Opening</th>
                <th className="py-2.5 px-3 border-r border-slate-200 w-24 bg-emerald-50 text-emerald-800">Inward (+)</th>
                <th className="py-2.5 px-3 border-r border-slate-200">Inward Remarks / Source</th>
                <th className="py-2.5 px-3 border-r border-slate-200 w-24 bg-rose-50 text-rose-800">Outward (-)</th>
                <th className="py-2.5 px-3 border-r border-slate-200">Outward Remarks / Recipient</th>
                <th className="py-2.5 px-3 bg-blue-50 text-blue-900 font-extrabold w-28">Closing Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
              {columns.map((col) => {
                const row = vehicleRecord[col.id] || { opening: 0, inward: 0, inCause: '', outward: 0, outCause: '' };
                const closing = (row.opening || 0) + (row.inward || 0) + (row.outward || 0);
                return (
                  <tr key={col.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 font-bold text-slate-900 border-r border-slate-200">
                      {col.name}
                    </td>
                    <td className="py-2 px-2 text-center border-r border-slate-200">
                      <input
                        type="number"
                        min="0"
                        value={row.opening}
                        onChange={(e) => handleUpdateField(col.id, 'opening', parseInt(e.target.value) || 0)}
                        className="w-16 px-1.5 py-1 text-center font-mono font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2 px-2 text-center border-r border-slate-200 bg-emerald-50/30">
                      <input
                        type="number"
                        min="0"
                        value={row.inward}
                        onChange={(e) => handleUpdateField(col.id, 'inward', parseInt(e.target.value) || 0)}
                        className="w-16 px-1.5 py-1 text-center font-mono font-bold text-emerald-700 bg-white border border-emerald-300 rounded focus:border-emerald-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2 px-2 border-r border-slate-200">
                      <input
                        type="text"
                        value={row.inCause}
                        onChange={(e) => handleUpdateField(col.id, 'inCause', e.target.value)}
                        placeholder="Manufactured / received from..."
                        className="w-full px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2 px-2 text-center border-r border-slate-200 bg-rose-50/30">
                      <input
                        type="number"
                        max="0"
                        value={row.outward}
                        onChange={(e) => handleUpdateField(col.id, 'outward', parseInt(e.target.value) || 0)}
                        className="w-16 px-1.5 py-1 text-center font-mono font-bold text-rose-700 bg-white border border-rose-300 rounded focus:border-rose-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2 px-2 border-r border-slate-200">
                      <input
                        type="text"
                        value={row.outCause}
                        onChange={(e) => handleUpdateField(col.id, 'outCause', e.target.value)}
                        placeholder="Dispatched to branch / dealer..."
                        className="w-full px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono font-black text-blue-900 bg-blue-50/50 text-sm">
                      {closing}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300 text-center">
                <td className="py-3 px-3 text-left border-r border-slate-300 uppercase tracking-wider text-xs">
                  Grand Total Vehicles
                </td>
                <td className="py-3 px-2 border-r border-slate-300 font-mono text-sm">{totalOpening}</td>
                <td className="py-3 px-2 border-r border-slate-300 font-mono text-emerald-800 text-sm">+{totalInward}</td>
                <td className="py-3 px-2 border-r border-slate-300 text-slate-400 text-[10px]">Total Inward</td>
                <td className="py-3 px-2 border-r border-slate-300 font-mono text-rose-800 text-sm">-{totalOutward}</td>
                <td className="py-3 px-2 border-r border-slate-300 text-slate-400 text-[10px]">Total Outward</td>
                <td className="py-3 px-3 bg-blue-100 font-mono text-blue-950 text-base">{totalClosing}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily Vehicle IN / OUT Audit Log with Login ID */}
      {dayTransactions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 uppercase tracking-wider">
              <History className="w-4 h-4 text-emerald-600" />
              <span>Vehicle IN / OUT Transaction Log ({dayTransactions.length})</span>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">
              Recorded automatically with active Login ID
            </span>
          </div>
          <div className="overflow-x-auto max-h-60">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Model</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3 text-right">Qty</th>
                  <th className="py-2 px-3">Remarks / Cause</th>
                  <th className="py-2 px-3">Done By (Login ID)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {[...dayTransactions].reverse().map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                      {tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : tx.date}
                    </td>
                    <td className="py-2 px-3 font-semibold text-slate-900">{tx.modelName}</td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          tx.action === 'in'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-rose-100 text-rose-800 border border-rose-200'
                        }`}
                      >
                        {tx.action}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                      {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                    </td>
                    <td className="py-2 px-3 text-slate-600 max-w-xs truncate">{tx.cause || '—'}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className="font-mono font-bold text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                        {tx.performedBy || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

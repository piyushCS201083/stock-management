import React, { useState } from 'react';
import {
  BatteryColumn,
  DEFAULT_CHARGER_COLUMNS,
  DayRecord,
  BranchInfo,
} from '../types/stock';
import {
  Zap,
  Plus,
  Send,
  Download,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { getIndianCurrentTime, getIndianTodayDate } from '../utils/date';

interface ChargerStockViewProps {
  branch: BranchInfo;
  onSwitchStockCategory: (category: 'battery' | 'charger') => void;
  onOpenBranchPortal: () => void;
  activeDate: string;
}

export const ChargerStockView: React.FC<ChargerStockViewProps> = ({
  branch,
  onSwitchStockCategory,
  onOpenBranchPortal,
  activeDate,
}) => {
  const [columns, setColumns] = useState<BatteryColumn[]>(DEFAULT_CHARGER_COLUMNS);
  const [chargerRecord, setChargerRecord] = useState<Record<string, {
    opening: number;
    inward: number;
    inCause: string;
    outward: number;
    outCause: string;
  }>>(() => {
    // Sensible baseline stock for chargers
    return {
      '48v_15a_smart': { opening: 8, inward: 2, inCause: 'Direct factory receipt', outward: -1, outCause: 'Issued to e-rickshaw dealer' },
      '60v_20a_fast': { opening: 5, inward: 0, inCause: '', outward: -2, outCause: 'Dispatched to customer' },
      '72v_25a_heavy': { opening: 4, inward: 1, inCause: 'Vendor shipment', outward: 0, outCause: '' },
      '48_60v_universal': { opening: 6, inward: 0, inCause: '', outward: -1, outCause: 'Replacement issued' },
      '72v_30a_lithium': { opening: 3, inward: 0, inCause: '', outward: 0, outCause: '' },
      'old_charger_repair': { opening: 2, inward: 1, inCause: 'Received burnt fan unit', outward: 0, outCause: '' },
    };
  });

  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleUpdateField = (
    colId: string,
    field: 'opening' | 'inward' | 'inCause' | 'outward' | 'outCause',
    val: any
  ) => {
    setChargerRecord((prev) => ({
      ...prev,
      [colId]: {
        ...(prev[colId] || { opening: 0, inward: 0, inCause: '', outward: 0, outCause: '' }),
        [field]: val,
      },
    }));
  };

  // Calculations
  let totalOpening = 0;
  let totalInward = 0;
  let totalOutward = 0;
  let totalClosing = 0;

  columns.forEach((col) => {
    const row = chargerRecord[col.id] || { opening: 0, inward: 0, inCause: '', outward: 0, outCause: '' };
    totalOpening += row.opening || 0;
    totalInward += row.inward || 0;
    totalOutward += Math.abs(row.outward || 0);
    totalClosing += (row.opening || 0) + (row.inward || 0) + (row.outward || 0);
  });

  const handleShareWhatsApp = () => {
    const text = `🔌 *DAILY CHARGER STOCK REGISTER - ${branch.name.toUpperCase()}*\n📅 *Date:* ${activeDate}\n━━━━━━━━━━━━━━━━━━━━━━\n⚡ *Total Opening Chargers:* ${totalOpening} units\n📥 *Inward (+):* +${totalInward} units\n📤 *Outward (-):* -${totalOutward} units\n📦 *Today's Closing Stock:* ${totalClosing} units\n\n_Updated at: ${getIndianCurrentTime()}_`;
    window.open(`https://api.whatsapp.com/send?phone=919009156696&text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-2xl border border-slate-700 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Top Context & Switcher Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-600 rounded-xl">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-200">
                {branch.name}
              </span>
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
                🔌 Charger Stock Register
              </span>
            </div>
            <h2 className="text-base font-extrabold text-slate-900 mt-0.5">
              EV & Industrial Charger Daily Ledger
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Location: <strong>{branch.address}</strong> · Contact: Piyush Shivhare (9009156696)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onSwitchStockCategory('battery')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer shadow-xs"
          >
            <span>Switch to Battery Stock</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenBranchPortal}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors cursor-pointer"
          >
            <span>Change Branch (1-4)</span>
          </button>
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
          <span className="text-[11px] font-bold text-slate-500 uppercase">Opening Stock</span>
          <div className="text-xl sm:text-2xl font-black text-slate-900 font-mono mt-1">{totalOpening}</div>
          <span className="text-[10px] text-slate-400">Total units at start of day</span>
        </div>
        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 shadow-2xs">
          <span className="text-[11px] font-bold text-emerald-700 uppercase">Today's Inward</span>
          <div className="text-xl sm:text-2xl font-black text-emerald-800 font-mono mt-1">+{totalInward}</div>
          <span className="text-[10px] text-emerald-600">Fresh factory receipts</span>
        </div>
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/50 shadow-2xs">
          <span className="text-[11px] font-bold text-rose-700 uppercase">Today's Outward</span>
          <div className="text-xl sm:text-2xl font-black text-rose-800 font-mono mt-1">-{totalOutward}</div>
          <span className="text-[10px] text-rose-600">Dispatched & sold chargers</span>
        </div>
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/70 shadow-2xs">
          <span className="text-[11px] font-bold text-blue-700 uppercase">Today's Closing Stock</span>
          <div className="text-xl sm:text-2xl font-black text-blue-900 font-mono mt-1">{totalClosing}</div>
          <span className="text-[10px] text-blue-600">Verified balance in branch</span>
        </div>
      </div>

      {/* Charger Spreadsheet Grid */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold">Charger Stock Ledger Table — {branch.shortName}</h3>
          </div>
          <span className="text-xs font-mono text-slate-300">Date: {activeDate}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-center">
                <th className="py-2.5 px-3 text-left border-r border-slate-200 w-44">Charger Model</th>
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
                const row = chargerRecord[col.id] || { opening: 0, inward: 0, inCause: '', outward: 0, outCause: '' };
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
                        placeholder="Inward source/dealer..."
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
                        placeholder="Outward reason/recipient..."
                        className="w-full px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono font-black text-blue-900 bg-blue-50/50 text-sm">
                      {closing}
                    </td>
                  </tr>
                );
              })}
              {/* Grand Total Row */}
              <tr className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300 text-center">
                <td className="py-3 px-3 text-left border-r border-slate-300 uppercase tracking-wider text-xs">
                  Grand Total Chargers
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
    </div>
  );
};

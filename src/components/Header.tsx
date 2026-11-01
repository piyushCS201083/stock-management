import React, { useState, useEffect } from 'react';
import {
  Send,
  FileSpreadsheet,
  Users,
  Clock,
  Building2,
  ChevronDown,
  Layers,
  BatteryCharging,
  Zap,
} from 'lucide-react';
import { getIndianCurrentTime } from '../utils/date';
import { BranchInfo, BRANCHES, StockCategoryId } from '../types/stock';

interface HeaderProps {
  onOpenQuickEntry: () => void;
  onOpenWhatsAppDispatch: () => void;
  onOpenTeamModal: () => void;
  onOpenCloudSettings: () => void;
  onOpenSerialTracker: () => void;
  onExportExcel: () => void;
  currentDate: string;
  activeBranch: BranchInfo;
  activeCategory: StockCategoryId;
  onOpenBranchPortal: () => void;
  onSelectCategory: (cat: StockCategoryId) => void;
  isRealtimeActive?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenQuickEntry,
  onOpenWhatsAppDispatch,
  onOpenTeamModal,
  onOpenCloudSettings,
  onOpenSerialTracker,
  onExportExcel,
  currentDate,
  activeBranch,
  activeCategory,
  onOpenBranchPortal,
  onSelectCategory,
  isRealtimeActive = true,
}) => {
  const [istTime, setIstTime] = useState<string>(() => getIndianCurrentTime());

  useEffect(() => {
    const timer = setInterval(() => {
      setIstTime(getIndianCurrentTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
      {/* Zone 1: Brand & Branch / Category Breadcrumb Selector */}
      <div className="flex items-center gap-3 shrink-0">
        <a href="/" className="text-sm sm:text-base font-black tracking-tight text-slate-900 whitespace-nowrap">
          Stock Register
        </a>

        {/* Clickable Branch & Category Hub Pill */}
        <button
          onClick={onOpenBranchPortal}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-bold text-slate-900 transition-all cursor-pointer shadow-2xs"
          title="Click to switch Branch (1-Chandravadni Naka, 2-Morar, 3-Yard, 4-Service Center) or stock category"
        >
          <Building2 className="w-3.5 h-3.5 text-blue-600" />
          <span className="font-bold text-blue-900">{activeBranch.shortName}</span>
          <span className="text-slate-400">›</span>
          <span className="text-slate-700 capitalize flex items-center gap-1">
            {activeCategory === 'battery' ? (
              <>
                <BatteryCharging className="w-3.5 h-3.5 text-blue-600 inline" />
                <span>Battery</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 text-amber-600 inline" />
                <span>Charger</span>
              </>
            )}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 ml-0.5" />
        </button>

        <div
          className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-[11px] font-mono text-amber-900"
          title="India Standard Time (UTC+5:30)"
        >
          <Clock className="w-3 h-3 text-amber-700" />
          <span>IST: {istTime}</span>
        </div>

        {/* Real-time Cloud Synchronization Indicator */}
        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${
            isRealtimeActive
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
              : 'bg-amber-50 border-amber-300 text-amber-800'
          }`}
          title={
            isRealtimeActive
              ? 'Real-Time Cloud Synchronization Active: All stock and serial changes persist permanently to cloud and sync instantly across all devices'
              : 'Reconnecting to Real-Time Cloud...'
          }
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isRealtimeActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
            }`}
          />
          <span className="hidden sm:inline">
            {isRealtimeActive ? 'Cloud Live Synced' : 'Syncing...'}
          </span>
        </div>
      </div>

      {/* Zone 2: Category Toggle Tabs & Quick Nav */}
      <nav className="hidden md:flex items-center gap-3 text-xs font-semibold text-slate-600">
        {/* Category Pills */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
          <button
            onClick={() => onSelectCategory('battery')}
            className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeCategory === 'battery'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BatteryCharging className="w-3.5 h-3.5" />
            <span>Battery Stock</span>
          </button>
          <button
            onClick={() => onSelectCategory('charger')}
            className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeCategory === 'charger'
                ? 'bg-amber-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Charger Stock</span>
          </button>
        </div>

        {activeCategory === 'battery' && (
          <>
            <button
              onClick={onOpenQuickEntry}
              className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Quick Entry
            </button>
            <button
              onClick={onOpenSerialTracker}
              className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer text-blue-700 font-bold"
            >
              Serial Tracker
            </button>
            <button
              onClick={onOpenTeamModal}
              className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Team (Piyush)
            </button>
            <button
              onClick={onOpenCloudSettings}
              className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cloud DBMS
            </button>
            <button
              onClick={onExportExcel}
              className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Excel .XLSX
            </button>
          </>
        )}
      </nav>

      {/* Zone 3: Primary Action */}
      <div className="flex items-center gap-2 shrink-0">
        {activeCategory === 'battery' ? (
          <button
            onClick={onOpenWhatsAppDispatch}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>WhatsApp Dispatch</span>
          </button>
        ) : (
          <button
            onClick={onOpenBranchPortal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
          >
            <Building2 className="w-3.5 h-3.5 text-blue-600" />
            <span>All 4 Branches</span>
          </button>
        )}
      </div>
    </header>
  );
};

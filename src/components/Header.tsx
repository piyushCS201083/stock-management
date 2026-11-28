import React from 'react';
import {
  Building2,
  ChevronDown,
  BatteryCharging,
  Zap,
  Car,
  ShieldCheck,
  Lock,
  LogOut,
} from 'lucide-react';
import { BranchInfo, StockCategoryId } from '../types/stock';

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
  isCloudDbConnected?: boolean;
  pendingReceiveCount?: number;
  isAdminAuthenticated?: boolean;
  onOpenAdminPortal?: () => void;
  branchLoginId?: string;
  branchRole?: 'branch' | 'master';
  canSwitchBranch?: boolean;
  onBranchLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeBranch,
  activeCategory,
  onOpenBranchPortal,
  pendingReceiveCount = 0,
  isAdminAuthenticated = false,
  onOpenAdminPortal,
  branchLoginId,
  branchRole,
  canSwitchBranch = true,
  onBranchLogout,
}) => {
  return (
    <header className="w-full bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
      <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 py-2 sm:py-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-3">
        {/* Left: Brand & Branch Selector */}
        <div className="contents sm:flex sm:items-center sm:gap-2.5 sm:min-w-0">
          <a
            href="/"
            className="order-1 sm:order-none text-sm sm:text-base font-black tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Stock Register
          </a>

          <button
            onClick={onOpenBranchPortal}
            className="order-3 sm:order-none w-full sm:w-auto inline-flex items-center justify-between sm:justify-start gap-1.5 px-2.5 py-1.5 sm:py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-bold text-slate-900 transition-all cursor-pointer shadow-2xs min-w-0"
            title={
              canSwitchBranch
                ? 'Click to switch Branch (1-5) or stock category'
                : 'Click to switch Stock Category (Battery / Charger / Vehicle) for this branch'
            }
          >
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span className="font-bold text-blue-900 truncate sm:max-w-[220px]">
                {activeBranch.shortName}
              </span>
              <span className="text-slate-400 shrink-0">›</span>
              <span className="text-slate-700 capitalize flex items-center gap-1 shrink-0">
                {activeCategory === 'battery' ? (
                  <>
                    <BatteryCharging className="w-3.5 h-3.5 text-blue-600 inline" />
                    <span>Battery</span>
                  </>
                ) : activeCategory === 'charger' ? (
                  <>
                    <Zap className="w-3.5 h-3.5 text-amber-600 inline" />
                    <span>Charger</span>
                  </>
                ) : (
                  <>
                    <Car className="w-3.5 h-3.5 text-emerald-600 inline" />
                    <span>Vehicle</span>
                  </>
                )}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 shrink-0">
              {pendingReceiveCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400 text-slate-950 animate-pulse shrink-0">
                  {pendingReceiveCount} Receive
                </span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            </span>
          </button>
        </div>

        {/* Right: Account Logout & Admin Login */}
        <div className="order-2 sm:order-none flex items-center gap-1.5 sm:gap-2 shrink-0">
          {branchLoginId && onBranchLogout && (
            <button
              type="button"
              onClick={onBranchLogout}
              className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
              title={`Signed in as "${branchLoginId}" (${branchRole === 'master' ? 'Master - All Branches' : activeBranch.shortName}). Click to sign out.`}
            >
              <span className="hidden sm:inline font-mono text-slate-900">
                {branchRole === 'master' ? 'Master' : `ID: ${branchLoginId}`}
              </span>
              <LogOut className="w-3.5 h-3.5 text-rose-600" />
              <span className="sm:hidden">Logout</span>
            </button>
          )}

          {onOpenAdminPortal && (
            <button
              type="button"
              onClick={onOpenAdminPortal}
              className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isAdminAuthenticated
                  ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                  : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
              }`}
              title={
                isAdminAuthenticated
                  ? 'Open Admin Analytics, Password Manager, Excel Exports & Factory Reset'
                  : 'Sign in to Admin Portal for Password Manager, Data Analysis & Factory Reset'
              }
            >
              {isAdminAuthenticated ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Lock className="w-3.5 h-3.5 text-slate-600" />
              )}
              <span>{isAdminAuthenticated ? 'Admin' : 'Admin Login'}</span>
              {isAdminAuthenticated && <span className="hidden sm:inline">Console</span>}
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

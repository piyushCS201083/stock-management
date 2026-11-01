import React from 'react';
import {
  BRANCHES,
  BranchInfo,
  StockCategoryId,
} from '../types/stock';
import {
  Building2,
  Warehouse,
  Truck,
  Wrench,
  BatteryCharging,
  Zap,
  ArrowRight,
  ChevronRight,
  Layers,
  MapPin,
  Phone,
  User,
  ShieldCheck,
  CheckCircle2,
  Boxes,
  Plus,
} from 'lucide-react';

interface BranchCategoryPortalProps {
  currentBranchId: string;
  currentCategoryId: StockCategoryId;
  onSelectBranchAndCategory: (branchId: string, categoryId: StockCategoryId) => void;
  onClose?: () => void;
  isModal?: boolean;
}

export const BranchCategoryPortal: React.FC<BranchCategoryPortalProps> = ({
  currentBranchId,
  currentCategoryId,
  onSelectBranchAndCategory,
  onClose,
  isModal = false,
}) => {
  const [selectedBranchId, setSelectedBranchId] = React.useState<string>(currentBranchId || 'chandravadni_naka');
  const [viewStep, setViewStep] = React.useState<'branches' | 'categories'>('branches');

  const selectedBranch = BRANCHES.find((b) => b.id === selectedBranchId) || BRANCHES[0];

  const getBranchIcon = (number: number) => {
    switch (number) {
      case 1:
        return <Building2 className="w-6 h-6 text-blue-600" />;
      case 2:
        return <Warehouse className="w-6 h-6 text-emerald-600" />;
      case 3:
        return <Truck className="w-6 h-6 text-amber-600" />;
      case 4:
        return <Wrench className="w-6 h-6 text-rose-600" />;
      default:
        return <Building2 className="w-6 h-6 text-slate-600" />;
    }
  };

  const handleBranchClick = (branchId: string) => {
    setSelectedBranchId(branchId);
    setViewStep('categories');
  };

  const content = (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Top Banner & Breadcrumb */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-xl border border-slate-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-xs font-semibold mb-3">
              <Boxes className="w-3.5 h-3.5" />
              <span>Multi-Location Warehouse Inventory System</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {viewStep === 'branches'
                ? 'Select Branch Location'
                : `Select Stock Category for ${selectedBranch.shortName}`}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">
              {viewStep === 'branches'
                ? 'Manage and maintain verified daily stock across 4 regional branches and storage depots.'
                : 'Choose the inventory register to view closing balances, serial tracker, and daily dispatches.'}
            </p>
          </div>

          {/* Quick Breadcrumb Switch */}
          {viewStep === 'categories' && (
            <button
              onClick={() => setViewStep('branches')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-200 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-lg transition-colors cursor-pointer self-start md:self-auto"
            >
              <span>← All 4 Branches</span>
            </button>
          )}
        </div>
      </div>

      {/* STEP 1: Branch Selection Grid (4 Branches) */}
      {viewStep === 'branches' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              <span>Available Branches (4 Locations)</span>
            </h2>
            <span className="text-xs text-slate-500 font-medium">Click a branch to view its stock</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {BRANCHES.map((branch) => {
              const isSelected = branch.id === currentBranchId;
              return (
                <div
                  key={branch.id}
                  onClick={() => handleBranchClick(branch.id)}
                  className={`group relative p-5 rounded-2xl border-2 transition-all cursor-pointer bg-white hover:shadow-lg ${
                    isSelected
                      ? 'border-blue-600 ring-4 ring-blue-500/10 shadow-md'
                      : 'border-slate-200 hover:border-blue-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3.5">
                      <div className="p-3 bg-slate-50 border border-slate-200 group-hover:bg-blue-50 group-hover:border-blue-200 rounded-xl transition-colors">
                        {getBranchIcon(branch.number)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-black text-slate-900 group-hover:text-blue-600 transition-colors">
                            {branch.name}
                          </h3>
                          {branch.badge && (
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                branch.number === 1
                                  ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                  : 'bg-slate-100 text-slate-700 border border-slate-200'
                              }`}
                            >
                              {branch.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 font-medium">{branch.subtitle}</p>

                        <div className="mt-3 space-y-1 text-[11px] text-slate-600">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{branch.address}</span>
                          </div>
                          {branch.contactPerson && (
                            <div className="flex items-center gap-1.5">
                              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{branch.contactPerson}</span>
                              {branch.phone && (
                                <span className="font-mono text-slate-500">({branch.phone})</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="p-2 rounded-lg bg-slate-50 text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all shrink-0">
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </div>

                  {/* Stock Highlights footer */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-slate-700 font-semibold">
                        <BatteryCharging className="w-3.5 h-3.5 text-blue-600" />
                        <span>Battery Stock</span>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="flex items-center gap-1 text-slate-700 font-semibold">
                        <Zap className="w-3.5 h-3.5 text-amber-600" />
                        <span>Charger Stock</span>
                      </span>
                    </div>

                    <span className="text-blue-600 font-bold group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                      <span>View Stock</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* STEP 2: Stock Category Selection for the Chosen Branch */
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-200">
                {selectedBranch.code}
              </span>
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                {selectedBranch.name} — Select Inventory Category
              </h2>
            </div>
            <button
              onClick={() => setViewStep('branches')}
              className="text-xs text-blue-600 hover:text-blue-800 font-bold cursor-pointer"
            >
              Switch Branch
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* 1. BATTERY STOCK CARD (Opens our verified full register!) */}
            <div
              onClick={() => onSelectBranchAndCategory(selectedBranch.id, 'battery')}
              className="group relative p-6 rounded-2xl border-2 border-slate-200 hover:border-blue-500 bg-white hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="p-3.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <BatteryCharging className="w-8 h-8" />
                </div>
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Full Register Active
                </span>
              </div>

              <div className="mt-4">
                <h3 className="text-lg font-black text-slate-900 group-hover:text-blue-600 transition-colors flex items-center gap-2">
                  <span>Battery Stock</span>
                  <ArrowRight className="w-4 h-4 text-blue-600 group-hover:translate-x-1 transition-transform" />
                </h3>
                <p className="text-xs text-slate-600 mt-1 font-medium leading-relaxed">
                  Daily battery spreadsheet, verified 31-10-2026 photo baseline, live inward/outward causes, individual serial tracker, ZXing barcode scanner, and automated WhatsApp dispatch.
                </p>

                <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] font-mono text-slate-600">
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">60×24 OLD</span>
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">60×24 FLAT</span>
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">60×30</span>
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">60×36</span>
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">Old for Repair</span>
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">Service Stock</span>
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500 font-semibold">Location: {selectedBranch.shortName}</span>
                <button
                  type="button"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  <span>Open Battery Stock</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 2. CHARGER STOCK CARD */}
            <div
              onClick={() => onSelectBranchAndCategory(selectedBranch.id, 'charger')}
              className="group relative p-6 rounded-2xl border-2 border-slate-200 hover:border-amber-500 bg-white hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="p-3.5 bg-amber-50 text-amber-600 border border-amber-200 rounded-xl group-hover:bg-amber-600 group-hover:text-white transition-colors">
                  <Zap className="w-8 h-8" />
                </div>
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                  EV & Industrial Chargers
                </span>
              </div>

              <div className="mt-4">
                <h3 className="text-lg font-black text-slate-900 group-hover:text-amber-600 transition-colors flex items-center gap-2">
                  <span>Charger Stock</span>
                  <ArrowRight className="w-4 h-4 text-amber-600 group-hover:translate-x-1 transition-transform" />
                </h3>
                <p className="text-xs text-slate-600 mt-1 font-medium leading-relaxed">
                  Track EV & commercial battery chargers (48V 15A, 60V 20A, 72V 25A Fast Chargers, Universal Auto-Cut), serial warranties, inward receipts, and service dispatches.
                </p>

                <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] font-mono text-slate-600">
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">48V 15A Smart</span>
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">60V 20A Fast</span>
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">72V 25A Heavy</span>
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">Universal Auto-Cut</span>
                  <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">Defective / Repair</span>
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500 font-semibold">Location: {selectedBranch.shortName}</span>
                <button
                  type="button"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  <span>Open Charger Stock</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
        <div className="bg-slate-50 rounded-2xl shadow-2xl border border-slate-300 w-full max-w-4xl max-h-[92vh] overflow-y-auto p-4 sm:p-6 relative">
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-lg text-slate-400 hover:text-slate-800 bg-white border border-slate-200 shadow-xs cursor-pointer z-20"
              title="Close Portal"
            >
              ✕
            </button>
          )}
          {content}
        </div>
      </div>
    );
  }

  return <div className="py-2">{content}</div>;
};

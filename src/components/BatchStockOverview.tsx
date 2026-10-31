import React, { useState, useMemo } from 'react';
import { BatteryColumn, BatterySerialItem, DayRecord } from '../types/stock';
import {
  Search,
  Barcode,
  Tag,
  AlertCircle,
  CheckCircle2,
  Clock,
  Truck,
  Wrench,
  BatteryCharging,
  Plus,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  History,
  Copy,
  Check,
  Edit2,
} from 'lucide-react';

interface BatchStockOverviewProps {
  currentRecord: DayRecord;
  columns: BatteryColumn[];
  serials: Record<string, BatterySerialItem>;
  closingStock: Record<string, number>;
  onOpenAssignModal: (modelId: string, modelName: string, currentStock: number) => void;
  onOpenSerialTrackerModal: () => void;
  onUpdateSerial: (item: BatterySerialItem) => void;
  onSelectSerialHistory: (item: BatterySerialItem) => void;
}

export const BatchStockOverview: React.FC<BatchStockOverviewProps> = ({
  currentRecord,
  columns,
  serials,
  closingStock,
  onOpenAssignModal,
  onOpenSerialTrackerModal,
  onUpdateSerial,
  onSelectSerialHistory,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedQuickFilter, setSelectedQuickFilter] = useState<
    'all' | 'in_stock' | 'dispatched' | 'missing' | 'repair'
  >('all');
  const [copiedSerial, setCopiedSerial] = useState<string | null>(null);
  const [isBatchCardsExpanded, setIsBatchCardsExpanded] = useState(true);

  const serialList = useMemo(() => Object.values(serials), [serials]);

  // Combine standard columns and special columns (Repair & Service) into the complete Batches list
  const allBatches = useMemo(() => {
    const list: Array<{ id: string; name: string; isSpecial?: boolean }> = [
      ...columns.map((c) => ({ id: c.id, name: c.name, isSpecial: false })),
      { id: 'repair', name: 'OLD BATTERY FOR REPAIR', isSpecial: true },
      { id: 'service', name: 'SERVICE BATTERY TOTAL', isSpecial: true },
    ];
    return list;
  }, [columns]);

  // Calculate batch-wise statistics (Stock count vs assigned in-stock serials)
  const batchStats = useMemo(() => {
    return allBatches.map((batch) => {
      const stock = closingStock[batch.id] || 0;
      // Find all serials belonging to this model/batch
      const matchingSerials = serialList.filter(
        (s) => s.modelId === batch.id || s.modelName === batch.name || s.batchNo === batch.name
      );
      const inStockSerials = matchingSerials.filter((s) => s.status === 'in_stock');
      const dispatchedSerials = matchingSerials.filter((s) => s.status === 'dispatched');
      const repairSerials = matchingSerials.filter((s) => s.status === 'in_repair');

      // Unassigned = if positive stock exists but has fewer serials assigned in stock
      const missingCount = stock > 0 ? Math.max(0, stock - inStockSerials.length) : 0;

      return {
        ...batch,
        stock,
        totalSerials: matchingSerials.length,
        inStockCount: inStockSerials.length,
        dispatchedCount: dispatchedSerials.length,
        repairCount: repairSerials.length,
        missingCount,
        isFullySerialized: stock > 0 ? missingCount === 0 : true,
      };
    });
  }, [allBatches, closingStock, serialList]);

  // Summary counts
  const totalStockSum = useMemo(() => {
    return batchStats.reduce((sum, b) => sum + (b.stock > 0 ? b.stock : 0), 0);
  }, [batchStats]);

  const totalMissingSerials = useMemo(() => {
    return batchStats.reduce((sum, b) => sum + b.missingCount, 0);
  }, [batchStats]);

  const totalTrackedInStock = useMemo(() => {
    return serialList.filter((s) => s.status === 'in_stock').length;
  }, [serialList]);

  // Search results across serial numbers, customer vehicle, dealer, and model
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    return serialList.filter((item) => {
      const matchSerial = item.serialNo.toLowerCase().includes(q);
      const matchModel = item.modelName.toLowerCase().includes(q);
      const matchBatch = item.batchNo && item.batchNo.toLowerCase().includes(q);
      const matchInPartner = item.inwardPartner && item.inwardPartner.toLowerCase().includes(q);
      const matchOutPartner = item.outwardPartner && item.outwardPartner.toLowerCase().includes(q);
      const matchInCause = item.inwardCause && item.inwardCause.toLowerCase().includes(q);
      const matchOutCause = item.outwardCause && item.outwardCause.toLowerCase().includes(q);
      const matchInDate = item.inwardDate && item.inwardDate.includes(q);
      const matchOutDate = item.outwardDate && item.outwardDate.includes(q);

      return (
        matchSerial ||
        matchModel ||
        matchBatch ||
        matchInPartner ||
        matchOutPartner ||
        matchInCause ||
        matchOutCause ||
        matchInDate ||
        matchOutDate
      );
    });
  }, [serialList, searchQuery]);

  const handleCopySerial = (s: string) => {
    navigator.clipboard.writeText(s);
    setCopiedSerial(s);
    setTimeout(() => setCopiedSerial(null), 2000);
  };

  return (
    <div className="space-y-3.5 mb-4">
      {/* =========================================================================
          SECTION 1: SEARCH & FILTER ANY BATTERY SERIAL NO. & LIFECYCLE HISTORY
         ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Search Bar Top Header */}
        <div className="p-3.5 sm:p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-xs">
                <Search className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold tracking-tight">
                    Search & Trace Battery Serial History
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                    Live Database
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Search any serial number to verify when it arrived in stock, when it went out, and to which customer vehicle / dealer.
                </p>
              </div>
            </div>

            <button
              onClick={onOpenSerialTrackerModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer self-start sm:self-auto shrink-0"
            >
              <Barcode className="w-3.5 h-3.5" />
              <span>Full Serial Database ({serialList.length})</span>
            </button>
          </div>

          {/* Search Input Bar */}
          <div className="mt-3 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Battery Serial No. (e.g. BAT-6024F-101), Customer Vehicle, Dealer (e.g. Sonu Bhaiya, Morar, Luvkush)..."
              className="w-full pl-10 pr-9 py-2.5 text-xs sm:text-sm bg-slate-800/90 hover:bg-slate-800 focus:bg-slate-950 text-white placeholder-slate-400 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono tracking-wide"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-3 text-slate-400 hover:text-white cursor-pointer"
                title="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Quick Filter Pills */}
          <div className="flex items-center gap-2 mt-2.5 flex-wrap text-[11px]">
            <span className="text-slate-400">Quick Filters:</span>
            {[
              { id: 'all', label: `All Serials (${serialList.length})` },
              {
                id: 'in_stock',
                label: `In Stock (${serialList.filter((s) => s.status === 'in_stock').length})`,
              },
              {
                id: 'dispatched',
                label: `Dispatched to Vehicle/Dealer (${
                  serialList.filter((s) => s.status === 'dispatched').length
                })`,
              },
              {
                id: 'missing',
                label: `Missing Serials (${totalMissingSerials})`,
                alert: totalMissingSerials > 0,
              },
            ].map((pill) => (
              <button
                key={pill.id}
                onClick={() => {
                  if (pill.id === 'missing') {
                    // Scroll to or highlight batchwise cards
                    setIsBatchCardsExpanded(true);
                  }
                  setSelectedQuickFilter(pill.id as any);
                  if (pill.id !== 'all' && pill.id !== 'missing') {
                    setSearchQuery(pill.id === 'in_stock' ? 'in_stock' : 'dispatched');
                  } else if (pill.id === 'all') {
                    setSearchQuery('');
                  }
                }}
                className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                  pill.alert
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                    : selectedQuickFilter === pill.id
                    ? 'bg-white/20 text-white border border-white/30'
                    : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {/* Live Search Results / Traced Battery History Card */}
        {searchQuery.trim().length > 0 && (
          <div className="p-4 bg-slate-50 border-t border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-blue-600" />
                Found {searchResults.length} matching battery record(s) in database for "{searchQuery}"
              </span>
              <button
                onClick={() => setSearchQuery('')}
                className="text-xs text-slate-500 hover:text-slate-800 font-medium"
              >
                Close Search Results
              </button>
            </div>

            {searchResults.length === 0 ? (
              <div className="p-6 text-center bg-white rounded-lg border border-slate-200 space-y-2">
                <Barcode className="w-8 h-8 text-slate-300 mx-auto" />
                <div className="text-xs font-bold text-slate-700">
                  No battery found with serial or keyword "{searchQuery}"
                </div>
                <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                  If this battery is physically in stock or newly arrived, you can register and assign its serial number below under its Battery Model batch.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {searchResults.map((item) => (
                  <div
                    key={item.serialNo}
                    className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-3 hover:border-blue-300 transition-all"
                  >
                    {/* Top Row: Serial Badge, Model Batch, Status */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <div className="flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
                          <Barcode className="w-4 h-4 text-blue-700" />
                          <span className="font-mono font-extrabold text-blue-800 text-sm">
                            {item.serialNo}
                          </span>
                          <button
                            onClick={() => handleCopySerial(item.serialNo)}
                            className="p-1 text-slate-400 hover:text-slate-600 rounded"
                            title="Copy Serial Number"
                          >
                            {copiedSerial === item.serialNo ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        <span className="text-xs font-bold text-slate-800 px-2.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                          Batch: {item.modelName}
                        </span>
                      </div>

                      {/* Status badge */}
                      <div>
                        {item.status === 'in_stock' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            IN STOCK (Available in Store)
                          </span>
                        )}
                        {item.status === 'dispatched' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-300">
                            <Truck className="w-3.5 h-3.5 text-slate-600" />
                            DISPATCHED (Out of Stock)
                          </span>
                        )}
                        {item.status === 'in_repair' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200">
                            <Wrench className="w-3.5 h-3.5 text-amber-600" />
                            IN REPAIR
                          </span>
                        )}
                        {item.status === 'service_standby' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-900 border border-purple-200">
                            <BatteryCharging className="w-3.5 h-3.5 text-purple-600" />
                            SERVICE STANDBY
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle Grid: Inward vs Outward Detailed History */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {/* Inward Details */}
                      <div className="p-3 bg-emerald-50/40 rounded-lg border border-emerald-100 space-y-1.5">
                        <div className="flex items-center justify-between font-bold text-emerald-900">
                          <span className="flex items-center gap-1">
                            <span>📥 Inward (When It Came In Stock)</span>
                          </span>
                          <span className="font-mono text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-200">
                            {item.inwardDate || '—'}
                          </span>
                        </div>
                        <div className="text-slate-700">
                          <span className="font-semibold text-slate-600">Brought By / Dealer:</span>{' '}
                          <strong className="text-slate-900">
                            {item.inwardPartner || 'Store Receiving'}
                          </strong>
                        </div>
                        {item.inwardCause && (
                          <div className="text-slate-600 text-[11px] italic bg-white/80 p-1.5 rounded border border-emerald-100">
                            "{item.inwardCause}"
                          </div>
                        )}
                      </div>

                      {/* Outward Details */}
                      <div
                        className={`p-3 rounded-lg border space-y-1.5 ${
                          item.outwardDate
                            ? 'bg-rose-50/40 border-rose-100'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold text-slate-900">
                          <span>📤 Outward (When It Went Out)</span>
                          {item.outwardDate ? (
                            <span className="font-mono text-rose-800 bg-white px-2 py-0.5 rounded border border-rose-200">
                              {item.outwardDate}
                            </span>
                          ) : (
                            <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-100 px-2 py-0.5 rounded">
                              Still in Store
                            </span>
                          )}
                        </div>

                        {item.outwardDate ? (
                          <>
                            <div className="text-slate-700">
                              <span className="font-semibold text-slate-600">
                                Customer Vehicle / Dealer:
                              </span>{' '}
                              <strong className="text-rose-900">
                                {item.outwardPartner || 'Dispatched Customer / Workshop'}
                              </strong>
                            </div>
                            {item.outwardCause && (
                              <div className="text-slate-600 text-[11px] italic bg-white/80 p-1.5 rounded border border-rose-100">
                                "{item.outwardCause}"
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-slate-500 text-[11px] pt-1">
                            Battery has not been dispatched yet. It is physically in stock ready for sale or vehicle fitment.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={() => onSelectSerialHistory(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
                      >
                        <History className="w-3.5 h-3.5" />
                        <span>View Full Lifecycle Timeline</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          SECTION 2: BATCHWISE CURRENT STOCK (BATTERY MODELS)
         ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                Batch-wise Current Stock (Battery Models)
              </h2>
              <span className="text-[11px] px-2 py-0.5 rounded font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                Batch = Battery Model
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Current available stock by model. For any stock showing in app without serial numbers, click{' '}
              <strong className="text-amber-700">Assign Serial No.</strong> to register its unique serial.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {totalMissingSerials > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-amber-900 bg-amber-100 border border-amber-300 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                <span>{totalMissingSerials} Batteries Missing Serials</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 rounded-lg">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>All Current Stock Serialized</span>
              </span>
            )}

            <button
              onClick={() => setIsBatchCardsExpanded(!isBatchCardsExpanded)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
              title={isBatchCardsExpanded ? 'Collapse Batch Cards' : 'Expand Batch Cards'}
            >
              {isBatchCardsExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Batch Cards Grid */}
        {isBatchCardsExpanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 pt-4">
            {batchStats.map((batch) => {
              const hasMissing = batch.missingCount > 0;
              const hasStock = batch.stock > 0;

              return (
                <div
                  key={batch.id}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                    hasMissing
                      ? 'border-amber-300 bg-amber-50/40 hover:border-amber-400 shadow-2xs'
                      : hasStock
                      ? 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-2xs'
                      : 'border-slate-100 bg-slate-50/60 opacity-80'
                  }`}
                >
                  <div>
                    {/* Model Name (Batch) */}
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-bold text-xs text-slate-900 leading-tight">
                        {batch.name}
                      </span>
                      {batch.isSpecial && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-slate-200 text-slate-700 font-bold shrink-0">
                          Special
                        </span>
                      )}
                    </div>

                    {/* Stock Figure */}
                    <div className="mt-2 flex items-baseline justify-between">
                      <div>
                        <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
                          {batch.stock}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500 ml-1">in stock</span>
                      </div>
                    </div>

                    {/* Serial tracking status */}
                    <div className="mt-2 pt-2 border-t border-slate-100 space-y-1 text-[11px]">
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Serials Assigned:</span>
                        <strong className="font-mono text-slate-800">{batch.inStockCount}</strong>
                      </div>

                      {hasMissing ? (
                        <div className="flex items-center gap-1 font-bold text-amber-700">
                          <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                          <span>{batch.missingCount} unit(s) without serial</span>
                        </div>
                      ) : hasStock ? (
                        <div className="flex items-center gap-1 font-semibold text-emerald-700">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span>All serialized</span>
                        </div>
                      ) : (
                        <div className="text-slate-400">0 available in store</div>
                      )}
                    </div>
                  </div>

                  {/* Action Button: Update / Assign Serial */}
                  <div className="mt-3 pt-2">
                    {hasMissing ? (
                      <button
                        onClick={() => onOpenAssignModal(batch.id, batch.name, batch.stock)}
                        className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg shadow-2xs transition-colors cursor-pointer ring-1 ring-amber-400/50"
                        title="Assign serial numbers to stock batteries without serial numbers"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Assign Serial No.</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => onOpenAssignModal(batch.id, batch.name, batch.stock)}
                        className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                        title="View or update serial numbers for this battery model"
                      >
                        <Edit2 className="w-3 h-3 text-slate-500" />
                        <span>
                          {batch.totalSerials > 0 ? `Update Serials (${batch.totalSerials})` : 'Manage'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

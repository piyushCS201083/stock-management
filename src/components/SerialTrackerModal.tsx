import React, { useState, useMemo } from 'react';
import { BatteryColumn, BatterySerialItem, BatteryMovementEvent } from '../types/stock';
import {
  Search,
  Filter,
  Barcode,
  Tag,
  Clock,
  ArrowRight,
  CheckCircle2,
  Truck,
  Wrench,
  BatteryCharging,
  History,
  Copy,
  Check,
  Plus,
  X,
  FileSpreadsheet,
  Camera,
} from 'lucide-react';
import { BarcodeScannerModal } from './BarcodeScannerModal';

interface SerialTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  serials: Record<string, BatterySerialItem>;
  columns: BatteryColumn[];
  onSaveSerial: (item: BatterySerialItem) => void;
}

export const SerialTrackerModal: React.FC<SerialTrackerModalProps> = ({
  isOpen,
  onClose,
  serials,
  columns,
  onSaveSerial,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_stock' | 'dispatched' | 'in_repair' | 'service_standby'>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [batchFilter, setBatchFilter] = useState<string>('all');
  const [selectedSerial, setSelectedSerial] = useState<BatterySerialItem | null>(null);
  const [copiedSerial, setCopiedSerial] = useState<string | null>(null);

  // New Serial Quick Add Form
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSerialNo, setNewSerialNo] = useState('');
  const [newModelId, setNewModelId] = useState(columns[0]?.id || '60x24_flat');
  const [newBatchNo, setNewBatchNo] = useState('');
  const [newStatus, setNewStatus] = useState<'in_stock' | 'dispatched' | 'in_repair' | 'service_standby'>('in_stock');
  const [newPartner, setNewPartner] = useState('');
  const [newCause, setNewCause] = useState('');

  // Barcode Camera Scanner state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<'search' | 'add'>('search');

  const handleScanCompleted = (scannedSerial: string, detectedBatch?: string) => {
    const trimmed = scannedSerial.trim();
    if (!trimmed) return;

    if (scannerTarget === 'search') {
      setSearchTerm(trimmed);
      const match = serialList.find(
        (s) => s.serialNo.toLowerCase() === trimmed.toLowerCase()
      );
      if (match) {
        setSelectedSerial(match);
      }
    } else {
      setNewSerialNo(trimmed);
      if (detectedBatch && !newBatchNo) {
        setNewBatchNo(detectedBatch);
      }
      setShowAddModal(true);
    }
  };

  const serialList = useMemo(() => Object.values(serials), [serials]);

  // Unique batches (Battery Models)
  const availableBatches = useMemo(() => {
    const set = new Set<string>();
    serialList.forEach((s) => {
      const b = s.modelName || s.batchNo;
      if (b) set.add(b);
    });
    return Array.from(set);
  }, [serialList]);

  // Filtered Serials
  const filteredSerials = useMemo(() => {
    return serialList.filter((item) => {
      // Search
      const search = searchTerm.toLowerCase();
      const matchSearch =
        !search ||
        item.serialNo.toLowerCase().includes(search) ||
        (item.batchNo && item.batchNo.toLowerCase().includes(search)) ||
        item.modelName.toLowerCase().includes(search) ||
        (item.inwardPartner && item.inwardPartner.toLowerCase().includes(search)) ||
        (item.outwardPartner && item.outwardPartner.toLowerCase().includes(search)) ||
        (item.inwardCause && item.inwardCause.toLowerCase().includes(search)) ||
        (item.outwardCause && item.outwardCause.toLowerCase().includes(search));

      // Status
      const matchStatus = statusFilter === 'all' || item.status === statusFilter;

      // Model
      const matchModel = modelFilter === 'all' || item.modelId === modelFilter;

      // Batch (Battery Model)
      const matchBatch =
        batchFilter === 'all' ||
        item.batchNo === batchFilter ||
        item.modelName === batchFilter;

      return matchSearch && matchStatus && matchModel && matchBatch;
    });
  }, [serialList, searchTerm, statusFilter, modelFilter, batchFilter]);

  // Batch-wise breakdown (Batch = Battery Model)
  const batchSummary = useMemo(() => {
    const summary: Record<string, { total: number; inStock: number; dispatched: number; repair: number }> = {};
    serialList.forEach((item) => {
      const b = item.modelName || item.batchNo || 'Battery Model';
      if (!summary[b]) {
        summary[b] = { total: 0, inStock: 0, dispatched: 0, repair: 0 };
      }
      summary[b].total += 1;
      if (item.status === 'in_stock') summary[b].inStock += 1;
      if (item.status === 'dispatched') summary[b].dispatched += 1;
      if (item.status === 'in_repair') summary[b].repair += 1;
    });
    return summary;
  }, [serialList]);

  const handleCopySerial = (s: string) => {
    navigator.clipboard.writeText(s);
    setCopiedSerial(s);
    setTimeout(() => setCopiedSerial(null), 2000);
  };

  const handleCreateNewSerial = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSerialNo.trim()) return;

    const col = columns.find((c) => c.id === newModelId) || { id: newModelId, name: newModelId };
    const nowIso = new Date().toISOString();
    const today = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');

    const event: BatteryMovementEvent = {
      id: `evt_${Date.now()}`,
      timestamp: nowIso,
      date: today,
      type: newStatus === 'dispatched' ? 'out' : newStatus === 'in_repair' ? 'repair_in' : 'in',
      cause: newCause.trim() || 'Direct manual registration',
      partner: newPartner.trim() || undefined,
    };

    const newItem: BatterySerialItem = {
      serialNo: newSerialNo.trim().toUpperCase(),
      batchNo: newBatchNo.trim() || undefined,
      modelId: col.id,
      modelName: col.name,
      status: newStatus,
      inwardDate: today,
      inwardCause: newCause.trim() || undefined,
      inwardPartner: newPartner.trim() || undefined,
      outwardDate: newStatus === 'dispatched' ? today : undefined,
      outwardPartner: newStatus === 'dispatched' ? newPartner.trim() : undefined,
      history: [event],
    };

    onSaveSerial(newItem);
    setNewSerialNo('');
    setNewBatchNo('');
    setNewPartner('');
    setNewCause('');
    setShowAddModal(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div
        className="bg-white rounded-2xl shadow-2xl border-2 border-slate-300 w-full max-w-5xl flex flex-col overflow-hidden my-auto ring-1 ring-slate-900/10"
        style={{ maxHeight: 'min(90vh, calc(100% - 2rem))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600/30 flex items-center justify-center text-blue-400">
              <Barcode className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">Battery Serial & Batch Inventory Tracker</h2>
                <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                  In-App Private Details
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Track full lifecycle: date received, person who brought it, date dispatched, and dealer/vehicle
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Battery Serial</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Batch-wise Stock Summary Strip */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-blue-600" />
              Batch-wise Stock Breakdown (Batch = Battery Model)
            </span>
            <span className="text-xs text-slate-500">
              Total Tracked Batteries: <strong className="text-slate-900">{serialList.length}</strong>
            </span>
          </div>

          <div className="flex gap-2.5 overflow-x-auto pb-1 text-xs">
            {Object.entries(batchSummary).map(([batch, stats]) => (
              <div
                key={batch}
                onClick={() => setBatchFilter(batchFilter === batch ? 'all' : batch)}
                className={`p-2.5 rounded-lg border transition-all cursor-pointer shrink-0 min-w-[180px] ${
                  batchFilter === batch
                    ? 'border-blue-500 bg-blue-50/80 shadow-2xs'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between font-bold text-slate-900">
                  <span className="truncate">{batch}</span>
                  <span className="font-mono text-slate-600">{stats.total}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                  <span className="text-emerald-700 font-semibold">{stats.inStock} In Stock</span>
                  <span>·</span>
                  <span className="text-rose-700">{stats.dispatched} Out</span>
                  {stats.repair > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-amber-700">{stats.repair} Repair</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="p-4 sm:px-6 bg-white border-b border-slate-200 shrink-0 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md flex items-center">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search Serial No, Batch, Model, Dealer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-20 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
              />
              <div className="absolute right-1.5 flex items-center gap-1">
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setScannerTarget('search');
                    setIsScannerOpen(true);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[11px] font-semibold cursor-pointer transition-colors"
                  title="Scan barcode with camera to find battery"
                >
                  <Camera className="w-3 h-3 text-blue-600" />
                  <span>Scan</span>
                </button>
              </div>
            </div>

            {/* Model & Batch Dropdowns */}
            <div className="flex items-center gap-2">
              <select
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 font-medium"
              >
                <option value="all">All Battery Models</option>
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.name}
                  </option>
                ))}
              </select>

              {availableBatches.length > 0 && (
                <select
                  value={batchFilter}
                  onChange={(e) => setBatchFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 font-medium"
                >
                  <option value="all">All Batches</option>
                  {availableBatches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Status Segmented Filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-slate-500 mr-1">Status:</span>
            {[
              { id: 'all', label: `All (${serialList.length})` },
              { id: 'in_stock', label: `In Stock (${serialList.filter((s) => s.status === 'in_stock').length})` },
              { id: 'dispatched', label: `Dispatched (${serialList.filter((s) => s.status === 'dispatched').length})` },
              { id: 'in_repair', label: `In Repair (${serialList.filter((s) => s.status === 'in_repair').length})` },
              { id: 'service_standby', label: `Service Standby (${serialList.filter((s) => s.status === 'service_standby').length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id as any)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Results Table View */}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {filteredSerials.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <Barcode className="w-10 h-10 text-slate-300 mx-auto" />
              <div className="text-sm font-bold text-slate-700">No matching battery serials found</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Whenever you log Inward or Outward battery transactions, enter the serial number to automatically track its complete history here!
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Register First Serial</span>
              </button>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden shadow-2xs bg-white">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <th className="py-2.5 px-3">Serial No.</th>
                    <th className="py-2.5 px-3">Model</th>
                    <th className="py-2.5 px-3">Batch</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Inward (Received)</th>
                    <th className="py-2.5 px-3">Outward (Dispatched)</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {filteredSerials.map((item) => (
                    <tr key={item.serialNo} className="hover:bg-slate-50/80 transition-colors">
                      {/* Serial No. */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-blue-700 text-[12.5px]">
                            {item.serialNo}
                          </span>
                          <button
                            onClick={() => handleCopySerial(item.serialNo)}
                            className="p-1 text-slate-400 hover:text-slate-600 rounded"
                            title="Copy Serial No"
                          >
                            {copiedSerial === item.serialNo ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Model */}
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        {item.modelName}
                      </td>

                      {/* Batch */}
                      <td className="py-2.5 px-3 font-mono text-slate-600 text-[11px]">
                        {item.batchNo || '—'}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3">
                        {item.status === 'in_stock' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            In Stock
                          </span>
                        )}
                        {item.status === 'dispatched' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            <Truck className="w-3 h-3 text-slate-500" />
                            Dispatched
                          </span>
                        )}
                        {item.status === 'in_repair' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            <Wrench className="w-3 h-3 text-amber-600" />
                            In Repair
                          </span>
                        )}
                        {item.status === 'service_standby' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                            <BatteryCharging className="w-3 h-3 text-blue-600" />
                            Service Standby
                          </span>
                        )}
                      </td>

                      {/* Inward Details */}
                      <td className="py-2.5 px-3 text-[11px] text-slate-600 max-w-[200px]">
                        <div className="font-semibold text-slate-900">{item.inwardDate}</div>
                        {item.inwardPartner && (
                          <div className="text-slate-700 truncate">By: {item.inwardPartner}</div>
                        )}
                        {item.inwardCause && (
                          <div className="text-slate-500 truncate" title={item.inwardCause}>
                            {item.inwardCause}
                          </div>
                        )}
                      </td>

                      {/* Outward Details */}
                      <td className="py-2.5 px-3 text-[11px] text-slate-600 max-w-[220px]">
                        {item.outwardDate ? (
                          <>
                            <div className="font-semibold text-rose-800 flex items-center gap-1">
                              <span>Dispatched:</span>
                              <span className="font-mono">{item.outwardDate}</span>
                            </div>
                            {item.outwardPartner && (
                              <div className="text-slate-900 font-semibold truncate" title={item.outwardPartner}>
                                To: {item.outwardPartner}
                              </div>
                            )}
                            {item.outwardCause && (
                              <div className="text-slate-500 truncate text-[10.5px]" title={item.outwardCause}>
                                {item.outwardCause}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-800 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            In Store Stock
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => setSelectedSerial(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors cursor-pointer"
                        >
                          <History className="w-3 h-3" />
                          <span>History</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-100 border-t-2 border-slate-200 shrink-0 rounded-b-2xl">
          <span className="text-xs text-slate-500">
            Showing <strong>{filteredSerials.length}</strong> of {serialList.length} total tracked serial numbers.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>

      {/* Battery Complete Lifecycle History Modal */}
      {selectedSerial && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
              <div className="flex items-center gap-2">
                <Barcode className="w-5 h-5 text-blue-400" />
                <div>
                  <h3 className="text-sm font-bold">Serial No: {selectedSerial.serialNo}</h3>
                  <span className="text-[11px] text-slate-400">{selectedSerial.modelName}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedSerial(null)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto text-xs">
              {/* Quick Status Pill */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-slate-500 block text-[11px]">Current Status:</span>
                  <span className="font-bold text-sm capitalize text-slate-900">
                    {selectedSerial.status.replace('_', ' ')}
                  </span>
                </div>
                {selectedSerial.batchNo && (
                  <div className="text-right">
                    <span className="text-slate-500 block text-[11px]">Batch:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {selectedSerial.batchNo}
                    </span>
                  </div>
                )}
              </div>

              {/* Lifecycle Events Timeline */}
              <div className="space-y-3">
                <span className="font-bold text-slate-900 uppercase tracking-wider text-[11px] block">
                  Complete Movement History Timeline
                </span>

                <div className="space-y-3 relative before:absolute before:inset-0 before:left-3 before:w-0.5 before:bg-slate-200 pl-6">
                  {/* Inward Event */}
                  <div className="relative">
                    <span className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-xs"></span>
                    <div className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-lg space-y-1">
                      <div className="flex items-center justify-between font-bold text-emerald-900">
                        <span>📥 Inward (Stock Received)</span>
                        <span className="font-mono text-[11px] text-emerald-700">
                          {selectedSerial.inwardDate}
                        </span>
                      </div>
                      {selectedSerial.inwardPartner && (
                        <div className="text-slate-700">
                          <strong>Brought by / Dealer:</strong> {selectedSerial.inwardPartner}
                        </div>
                      )}
                      {selectedSerial.inwardCause && (
                        <div className="text-slate-600 italic">
                          "{selectedSerial.inwardCause}"
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Outward Event (if dispatched) */}
                  {selectedSerial.outwardDate && (
                    <div className="relative">
                      <span className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-rose-500 border-2 border-white shadow-xs"></span>
                      <div className="p-3 bg-rose-50/50 border border-rose-200 rounded-lg space-y-1">
                        <div className="flex items-center justify-between font-bold text-rose-900">
                          <span>📤 Outward (Dispatched)</span>
                          <span className="font-mono text-[11px] text-rose-700">
                            {selectedSerial.outwardDate}
                          </span>
                        </div>
                        {selectedSerial.outwardPartner && (
                          <div className="text-slate-700">
                            <strong>To / Dealer / Vehicle:</strong> {selectedSerial.outwardPartner}
                          </div>
                        )}
                        {selectedSerial.outwardCause && (
                          <div className="text-slate-600 italic">
                            "{selectedSerial.outwardCause}"
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Remaining history logs */}
                  {selectedSerial.history && selectedSerial.history.length > 0 && (
                    <div className="pt-1 space-y-2">
                      {selectedSerial.history.map((evt, idx) => (
                        <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-700">
                          <div className="flex items-center justify-between font-bold text-slate-900 mb-0.5">
                            <span className="capitalize">{evt.type.replace('_', ' ')}</span>
                            <span className="font-mono text-slate-500">{evt.date}</span>
                          </div>
                          <div>{evt.cause}</div>
                          {evt.partner && <div className="text-slate-500">Contact: {evt.partner}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end px-6 py-3 bg-slate-50 border-t border-slate-200">
              <button
                onClick={() => setSelectedSerial(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Add Battery Serial Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold">Register Battery Serial</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewSerial} className="p-6 space-y-3.5 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-medium text-slate-700">
                    Serial Number *
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setScannerTarget('add');
                      setIsScannerOpen(true);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
                  >
                    <Camera className="w-3 h-3" />
                    <span>Scan with Camera</span>
                  </button>
                </div>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    required
                    placeholder="e.g. 6024-FLAT-0091"
                    value={newSerialNo}
                    onChange={(e) => setNewSerialNo(e.target.value)}
                    className="w-full pl-2.5 pr-18 py-1.5 border border-slate-300 rounded font-mono uppercase bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setScannerTarget('add');
                      setIsScannerOpen(true);
                    }}
                    className="absolute right-1 px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-semibold cursor-pointer"
                  >
                    Scan
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Model *
                  </label>
                  <select
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                  >
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Batch No.
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. BATCH-OCT26"
                    value={newBatchNo}
                    onChange={(e) => setNewBatchNo(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Current Status
                </label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white font-medium"
                >
                  <option value="in_stock">In Stock (Currently in store)</option>
                  <option value="dispatched">Dispatched (Out to vehicle / dealer)</option>
                  <option value="in_repair">In Repair</option>
                  <option value="service_standby">Service Standby Pool</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Person / Dealer Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Luvkush / Aman Wadhwani / Reena Ent"
                  value={newPartner}
                  onChange={(e) => setNewPartner(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Cause / Remarks
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Service center se aaya, testing ok"
                  value={newCause}
                  onChange={(e) => setNewCause(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                >
                  Save Serial
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Barcode Camera Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanComplete={handleScanCompleted}
      />
    </div>
  );
};

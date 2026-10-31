import React, { useState } from 'react';
import { BatteryColumn, DayRecord } from '../types/stock';
import {
  PlusCircle,
  MinusCircle,
  Wrench,
  BatteryCharging,
  Check,
  X,
  ArrowRight,
  Barcode,
  Tag,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export interface SerialEntryPayload {
  serialNo: string;
  batchNo?: string;
  modelId: string;
  modelName: string;
  type: 'in' | 'out' | 'repair_in' | 'repair_out' | 'service';
  cause: string;
  partner?: string;
  vehicle?: string;
}

interface QuickEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: DayRecord;
  columns: BatteryColumn[];
  onSaveRecord: (
    updated: DayRecord,
    triggerWhatsApp?: boolean,
    serialEntries?: SerialEntryPayload[]
  ) => void;
}

export const QuickEntryModal: React.FC<QuickEntryModalProps> = ({
  isOpen,
  onClose,
  record,
  columns,
  onSaveRecord,
}) => {
  const [entryType, setEntryType] = useState<'in' | 'out' | 'repair_in' | 'repair_out' | 'service'>('in');
  const [selectedColId, setSelectedColId] = useState<string>(columns[0]?.id || '60x24_old');
  const [quantity, setQuantity] = useState<number>(1);
  const [cause, setCause] = useState<string>('');
  const [partnerName, setPartnerName] = useState<string>(''); // e.g. Luvkush, Aman Wadhwani, Reena Ent, Nikhil
  const [vehicleOrLocation, setVehicleOrLocation] = useState<string>(''); // e.g. Service center, Morar, Maa Sati
  const [serialInput, setSerialInput] = useState<string>(''); // Serial numbers (comma or newline separated)
  const [batchNo, setBatchNo] = useState<string>(''); // Optional batch number

  if (!isOpen) return null;

  const handleAutoGenerateSerials = () => {
    const colName = columns.find((c) => c.id === selectedColId)?.name || 'BAT';
    const cleanPrefix = colName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
    const generated: string[] = [];
    const baseNum = Math.floor(1000 + Math.random() * 9000);
    for (let i = 0; i < quantity; i++) {
      generated.push(`${cleanPrefix}-${baseNum + i}`);
    }
    setSerialInput(generated.join(', '));
  };

  const handleSave = (andSendWhatsApp = false) => {
    const updated = { ...record };
    let fullCause = cause.trim();

    if (partnerName.trim() || vehicleOrLocation.trim()) {
      const parts = [
        vehicleOrLocation.trim(),
        partnerName.trim(),
        cause.trim()
      ].filter(Boolean);
      fullCause = parts.join(' , ');
    }

    if (entryType === 'in') {
      const currentIn = updated.inStock[selectedColId] || 0;
      updated.inStock = { ...updated.inStock, [selectedColId]: currentIn + quantity };
      
      const currentCause = updated.inCause[selectedColId] || '';
      updated.inCause = {
        ...updated.inCause,
        [selectedColId]: currentCause ? `${currentCause}\n${fullCause}` : fullCause,
      };

      const targetCol = columns.find(c => c.id === selectedColId);
      const summaryLine = `${targetCol?.name || selectedColId}: ${fullCause}`;
      updated.totalInCause = updated.totalInCause
        ? `${updated.totalInCause}\n${summaryLine}`
        : summaryLine;

    } else if (entryType === 'out') {
      const currentOut = updated.outStock[selectedColId] || 0;
      // Stored as negative number
      updated.outStock = { ...updated.outStock, [selectedColId]: currentOut - quantity };

      const currentCause = updated.outCause[selectedColId] || '';
      updated.outCause = {
        ...updated.outCause,
        [selectedColId]: currentCause ? `${currentCause}\n${fullCause}` : fullCause,
      };

      const targetCol = columns.find(c => c.id === selectedColId);
      const summaryLine = `${targetCol?.name || selectedColId}: ${fullCause}`;
      updated.totalOutCause = updated.totalOutCause
        ? `${updated.totalOutCause}\n${summaryLine}`
        : summaryLine;

    } else if (entryType === 'repair_in') {
      const current = updated.inStock['repair'] || 0;
      updated.inStock = { ...updated.inStock, repair: current + quantity };
      updated.repairInCause = updated.repairInCause
        ? `${updated.repairInCause}\n${fullCause}`
        : fullCause;

    } else if (entryType === 'repair_out') {
      const current = updated.outStock['repair'] || 0;
      updated.outStock = { ...updated.outStock, repair: current - quantity };
      updated.repairOutCause = updated.repairOutCause
        ? `${updated.repairOutCause}\n${fullCause}`
        : fullCause;

    } else if (entryType === 'service') {
      const current = updated.stock['service'] || 0;
      updated.stock = { ...updated.stock, service: current + quantity };
    }

    // Process Serial Numbers entered (clean list)
    const rawSerials = serialInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const targetModel =
      entryType === 'repair_in' || entryType === 'repair_out'
        ? { id: 'repair', name: 'OLD BATTERY FOR REPAIR' }
        : entryType === 'service'
        ? { id: 'service', name: 'SERVICE BATTERY' }
        : columns.find((c) => c.id === selectedColId) || { id: selectedColId, name: selectedColId };

    const serialEntries: SerialEntryPayload[] = rawSerials.map((s) => ({
      serialNo: s,
      batchNo: batchNo.trim() || targetModel.name,
      modelId: targetModel.id,
      modelName: targetModel.name,
      type: entryType,
      cause: fullCause,
      partner: partnerName.trim() || undefined,
      vehicle: vehicleOrLocation.trim() || undefined,
    }));

    updated.lastModified = new Date().toISOString();
    onSaveRecord(updated, andSendWhatsApp, serialEntries);
    onClose();

    // Reset form
    setQuantity(1);
    setCause('');
    setPartnerName('');
    setVehicleOrLocation('');
    setSerialInput('');
    setBatchNo('');
  };

  const selectedCol = columns.find((c) => c.id === selectedColId);
  const currentOpen = selectedCol ? (record.stock[selectedCol.id] || 0) : 0;
  const currentIn = selectedCol ? (record.inStock[selectedCol.id] || 0) : 0;
  const currentOut = selectedCol ? (record.outStock[selectedCol.id] || 0) : 0;
  const currentClosing = currentOpen + currentIn + currentOut;

  const previewClosing =
    entryType === 'in'
      ? currentClosing + quantity
      : entryType === 'out'
      ? currentClosing - quantity
      : currentClosing;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden my-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold">Log Battery Transaction & Serials</h2>
            <span className="text-xs text-slate-400 font-mono">({record.date})</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Movement Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Transaction Category:
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setEntryType('in')}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border text-xs font-semibold transition-all ${
                  entryType === 'in'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <PlusCircle className="w-5 h-5 text-emerald-600 mb-1" />
                <span>In Stock</span>
                <span className="text-[10px] text-emerald-600 font-normal">Add Inward</span>
              </button>

              <button
                type="button"
                onClick={() => setEntryType('out')}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border text-xs font-semibold transition-all ${
                  entryType === 'out'
                    ? 'border-rose-500 bg-rose-50 text-rose-800 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <MinusCircle className="w-5 h-5 text-rose-600 mb-1" />
                <span>Out Stock</span>
                <span className="text-[10px] text-rose-600 font-normal">Dispatch/Vehicle</span>
              </button>

              <button
                type="button"
                onClick={() => setEntryType('repair_in')}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border text-xs font-semibold transition-all ${
                  entryType === 'repair_in' || entryType === 'repair_out'
                    ? 'border-amber-500 bg-amber-50 text-amber-800 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Wrench className="w-5 h-5 text-amber-600 mb-1" />
                <span>Repair Battery</span>
                <span className="text-[10px] text-amber-600 font-normal">Maa Sati/Morar</span>
              </button>

              <button
                type="button"
                onClick={() => setEntryType('service')}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border text-xs font-semibold transition-all ${
                  entryType === 'service'
                    ? 'border-blue-500 bg-blue-50 text-blue-800 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <BatteryCharging className="w-5 h-5 text-blue-600 mb-1" />
                <span>Service Total</span>
                <span className="text-[10px] text-blue-600 font-normal">Standby Pool</span>
              </button>
            </div>
          </div>

          {/* If Repair Battery selected, choose In vs Out */}
          {(entryType === 'repair_in' || entryType === 'repair_out') && (
            <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs">
              <span className="font-semibold text-amber-900">Repair Action:</span>
              <button
                type="button"
                onClick={() => setEntryType('repair_in')}
                className={`px-3 py-1 rounded font-medium ${
                  entryType === 'repair_in'
                    ? 'bg-amber-600 text-white'
                    : 'bg-white text-amber-800 border border-amber-300'
                }`}
              >
                Received for Repair (+In)
              </button>
              <button
                type="button"
                onClick={() => setEntryType('repair_out')}
                className={`px-3 py-1 rounded font-medium ${
                  entryType === 'repair_out'
                    ? 'bg-amber-600 text-white'
                    : 'bg-white text-amber-800 border border-amber-300'
                }`}
              >
                Sent for Repair (-Out)
              </button>
            </div>
          )}

          {/* Battery Model Selection (for In/Out) */}
          {entryType !== 'repair_in' && entryType !== 'repair_out' && entryType !== 'service' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Battery Specification / Model:
                </label>
                <select
                  value={selectedColId}
                  onChange={(e) => setSelectedColId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  {columns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name} (Current: {record.stock[col.id] || 0} units)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Quantity (Units):
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-bold tabular-nums focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Particulars / Cause Details */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Person / Dealer Name:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Luvkush / Aman Wadhwani / Reena Ent"
                  value={partnerName}
                  onChange={(e) => setPartnerName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Location / Vehicle / Notes:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Service center se / Morar se / Gaadi mai lagi"
                  value={vehicleOrLocation}
                  onChange={(e) => setVehicleOrLocation(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Cause / Reason Line:
              </label>
              <textarea
                rows={2}
                placeholder="e.g. Service center se, luvkush le kar aaya"
                value={cause}
                onChange={(e) => setCause(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>

          {/* Dedicated Serial No. & Batch Section */}
          <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-xs text-blue-900">
                <Barcode className="w-4 h-4 text-blue-700" />
                <span>Battery Serial Numbers & Batch Tracking (In-App Only)</span>
              </div>
              <button
                type="button"
                onClick={handleAutoGenerateSerials}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline"
              >
                <Sparkles className="w-3 h-3" />
                <span>Auto-fill {quantity} Serials</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Serial Number(s) <span className="text-slate-400">(comma or enter separated)</span>:
                </label>
                <input
                  type="text"
                  placeholder="e.g. 6024-FLAT-001, 6024-FLAT-002"
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Batch (Battery Model):
                </label>
                <input
                  type="text"
                  placeholder={selectedCol?.name || 'e.g. 60×24 FLAT'}
                  value={batchNo}
                  onChange={(e) => setBatchNo(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-blue-800 pt-0.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>
                <strong>Confidential:</strong> Serial numbers are saved for in-app tracking and history search, and will <strong>NOT</strong> appear on the WhatsApp Excel photo.
              </span>
            </div>
          </div>

          {/* Live Preview Box */}
          {entryType !== 'repair_in' && entryType !== 'repair_out' && entryType !== 'service' && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
              <span className="text-slate-600 font-medium">
                Effect on <strong className="text-slate-900">{selectedCol?.name}</strong>:
              </span>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-slate-500">Current: {currentClosing}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span
                  className={`font-bold ${
                    entryType === 'in' ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  New Closing: {previewClosing}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSave(false)}
              className="px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Update Excel & Serials
            </button>

            <button
              type="button"
              onClick={() => handleSave(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Update & Send WhatsApp</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

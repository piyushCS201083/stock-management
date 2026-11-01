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
  Send,
  Calendar,
  Camera,
  CheckCircle2,
} from 'lucide-react';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import {
  toISODateString,
  fromISODateString,
  getIndianTodayDate,
  getIndianTodayISODate,
  isAfterTodayIST,
} from '../utils/date';

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
  recordedDates?: string[];
  onSelectDate?: (date: string) => void;
}

export const QuickEntryModal: React.FC<QuickEntryModalProps> = ({
  isOpen,
  onClose,
  record,
  columns,
  onSaveRecord,
  recordedDates,
  onSelectDate,
}) => {
  const [entryType, setEntryType] = useState<'in' | 'out' | 'repair_in' | 'repair_out' | 'service'>('in');
  const [selectedColId, setSelectedColId] = useState<string>(columns[0]?.id || '60x24_old');
  const [quantity, setQuantity] = useState<number>(1);
  const [cause, setCause] = useState<string>('');
  const [partnerName, setPartnerName] = useState<string>(''); // e.g. Luvkush, Aman Wadhwani, Reena Ent, Nikhil
  const [vehicleOrLocation, setVehicleOrLocation] = useState<string>(''); // e.g. Service center, Morar, Maa Sati
  const [serialInput, setSerialInput] = useState<string>(''); // Serial numbers (comma or newline separated)
  const [batchNo, setBatchNo] = useState<string>(''); // Optional batch number
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [lastScannedSerial, setLastScannedSerial] = useState<string | null>(null);

  const todayIST = getIndianTodayDate();
  const todayISO = getIndianTodayISODate();

  const handleScanComplete = (scannedSerial: string, detectedBatch?: string) => {
    const trimmed = scannedSerial.trim();
    if (!trimmed) return;

    setSerialInput((prev) => {
      if (!prev || !prev.trim()) {
        return trimmed;
      }
      const existingList = prev.split(/[\n,]+/).map((s) => s.trim());
      if (existingList.includes(trimmed)) {
        return prev;
      }
      return `${prev.trim()}, ${trimmed}`;
    });

    if (detectedBatch && !batchNo) {
      setBatchNo(detectedBatch);
    }

    setLastScannedSerial(trimmed);
    setTimeout(() => {
      setLastScannedSerial(null);
    }, 5000);
  };

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

    // Process Serial Numbers (user-provided or auto-serialized for 100% cloud tracking)
    let finalSerials = serialInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const targetModel =
      entryType === 'repair_in' || entryType === 'repair_out'
        ? { id: 'repair', name: 'OLD BATTERY FOR REPAIR' }
        : entryType === 'service'
        ? { id: 'service', name: 'SERVICE BATTERY' }
        : columns.find((c) => c.id === selectedColId) || { id: selectedColId, name: selectedColId };

    // If inward transaction and user didn't enter all serials, auto-generate unique serials for remaining units
    if (entryType === 'in' && finalSerials.length < quantity) {
      const cleanPrefix = targetModel.name
        .replace(/[×x\s]/g, '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .slice(0, 6) || 'BAT';
      const randomBase = Math.floor(1000 + Math.random() * 9000);
      const needed = quantity - finalSerials.length;
      const generated = Array.from({ length: needed }, (_, i) => `BAT-${cleanPrefix}-${randomBase + i}`);
      finalSerials = [...finalSerials, ...generated];
    }

    const serialEntries: SerialEntryPayload[] = finalSerials.map((s) => ({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div
        className="bg-white rounded-2xl shadow-2xl border-2 border-slate-300 w-full max-w-xl flex flex-col overflow-hidden my-auto ring-1 ring-slate-900/10"
        style={{ maxHeight: 'min(90vh, calc(100% - 2rem))' }}
      >
        {/* Header - Fixed & Rounded Top */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 bg-slate-900 text-white shrink-0 rounded-t-2xl gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm sm:text-base font-bold whitespace-nowrap">Log Battery Transaction & Serials</h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-lg text-xs font-mono transition-colors">
              <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <input
                type="date"
                aria-label="Change transaction date till today"
                title={`Change transaction date (Max till today in IST: ${todayIST})`}
                max={todayISO}
                value={toISODateString(record.date)}
                onChange={(e) => {
                  const iso = e.target.value;
                  if (!iso) return;
                  const targetDate = fromISODateString(iso);
                  if (targetDate && !isAfterTodayIST(targetDate)) {
                    onSelectDate?.(targetDate);
                  }
                }}
                className="bg-transparent text-slate-100 text-xs font-semibold focus:outline-none cursor-pointer [color-scheme:dark]"
              />
              {record.date !== todayIST && onSelectDate && (
                <button
                  type="button"
                  onClick={() => onSelectDate(todayIST)}
                  title={`Jump to today: ${todayIST}`}
                  className="px-1.5 py-0.5 text-[10px] bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold font-sans rounded transition-colors cursor-pointer"
                >
                  Today
                </button>
              )}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body - Smooth internal scroll, cleanly contained */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-3.5 overscroll-contain">
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

          {/* Live Preview Box - Placed ABOVE before Particulars and Serials */}
          {entryType !== 'repair_in' && entryType !== 'repair_out' && entryType !== 'service' ? (
            <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <span className="text-slate-700 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                <span>Stock Impact on</span>
                <strong className="text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-300 font-bold">
                  {selectedCol?.name}
                </strong>
                :
              </span>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-slate-600 bg-white px-2.5 py-1 rounded border border-slate-200 text-xs">
                  Current: <strong className="text-slate-900">{currentClosing}</strong>
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-blue-600" />
                <span
                  className={`font-bold px-2.5 py-1 rounded border text-xs shadow-2xs ${
                    entryType === 'in'
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      : 'bg-rose-100 text-rose-900 border-rose-300'
                  }`}
                >
                  New Closing: {previewClosing} ({entryType === 'in' ? `+${quantity}` : `-${quantity}`})
                </span>
              </div>
            </div>
          ) : (entryType === 'repair_in' || entryType === 'repair_out') ? (
            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <span className="text-amber-900 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-600 animate-pulse"></span>
                <span>Repair Battery Pool Impact:</span>
              </span>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-slate-600 bg-white px-2.5 py-1 rounded border border-amber-200 text-xs">
                  Current: <strong className="text-slate-900">{record.stock['repair'] || 0}</strong>
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-amber-600" />
                <span className="font-bold px-2.5 py-1 rounded border border-amber-300 bg-amber-100 text-amber-900 text-xs">
                  New Closing: {entryType === 'repair_in' ? (record.stock['repair'] || 0) + quantity : (record.stock['repair'] || 0) - quantity}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <span className="text-indigo-900 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
                <span>Service Standby Pool Impact:</span>
              </span>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-slate-600 bg-white px-2.5 py-1 rounded border border-indigo-200 text-xs">
                  Current: <strong className="text-slate-900">{record.stock['service'] || 0}</strong>
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-indigo-600" />
                <span className="font-bold px-2.5 py-1 rounded border border-indigo-300 bg-indigo-100 text-indigo-900 text-xs">
                  New Closing: {(record.stock['service'] || 0) + quantity}
                </span>
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 font-bold text-xs text-blue-900">
                <Barcode className="w-4 h-4 text-blue-700" />
                <span>Battery Serial Numbers & Batch Tracking (In-App Only)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsScannerOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-md shadow-xs transition-colors cursor-pointer"
                  title="Scan barcode with camera or capture battery label photo"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Scan Barcode (Camera)</span>
                </button>
                <button
                  type="button"
                  onClick={handleAutoGenerateSerials}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Auto-fill {quantity}</span>
                </button>
              </div>
            </div>

            {/* Notification badge for recently scanned barcode */}
            {lastScannedSerial && (
              <div className="p-2 bg-emerald-100/90 border border-emerald-300 rounded-md text-emerald-900 text-xs font-semibold flex items-center justify-between animate-fade-in">
                <span className="flex items-center gap-1.5 font-mono">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Scanned & Added: <strong>{lastScannedSerial}</strong></span>
                </span>
                <span className="text-[10px] text-emerald-700 font-sans font-normal">Ready for next or Save</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold text-slate-700">
                    Serial Number(s) <span className="text-slate-400 font-normal">(comma or enter separated)</span>:
                  </label>
                  {serialInput.trim() && (
                    <button
                      type="button"
                      onClick={() => setSerialInput('')}
                      className="text-[10px] text-rose-600 hover:text-rose-800 underline cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    placeholder="e.g. 6024-FLAT-001 (or click Camera to scan)"
                    value={serialInput}
                    onChange={(e) => setSerialInput(e.target.value)}
                    className="w-full pl-2.5 pr-24 py-2 text-xs font-mono font-medium border border-blue-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                  />
                  <button
                    type="button"
                    onClick={() => setIsScannerOpen(true)}
                    className="absolute right-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-md text-[11px] font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                    title="Open Camera to scan battery barcode or label"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Scan</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Batch (Battery Model):
                </label>
                <input
                  type="text"
                  placeholder={selectedCol?.name || 'e.g. 60×24 FLAT'}
                  value={batchNo}
                  onChange={(e) => setBatchNo(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-mono border border-blue-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
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
        </div>

        {/* Pinned Footer - Completes closed rounded shape from below */}
        <div className="shrink-0 bg-slate-100 border-t-2 border-slate-200 px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/80 rounded-lg transition-colors order-3 sm:order-1 text-center cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 order-1 sm:order-2">
            <button
              type="button"
              onClick={() => handleSave(false)}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-all shadow-xs active:scale-[0.98] cursor-pointer"
              title="Save changes and update spreadsheet ledger"
            >
              <Check className="w-4 h-4 text-slate-600" />
              <span>Update Excel & Serials</span>
            </button>

            <button
              type="button"
              onClick={() => handleSave(true)}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-lg transition-all shadow-sm active:scale-[0.98] cursor-pointer ring-2 ring-emerald-500/30"
              title="Save transaction and immediately open WhatsApp dispatch"
            >
              <Send className="w-4 h-4" />
              <span>Update & Send WhatsApp</span>
            </button>
          </div>
        </div>
      </div>

      {/* Camera Barcode Scanner Viewfinder Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanComplete={handleScanComplete}
        initialModelName={selectedCol?.name}
      />
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { BatteryColumn, BRANCHES, BranchInfo, DayRecord } from '../types/stock';
import {
  PlusCircle,
  MinusCircle,
  ArrowLeftRight,
  Wrench,
  BatteryCharging,
  Check,
  X,
  ArrowRight,
  Barcode,
  ShieldCheck,
  Sparkles,
  Send,
  Calendar,
  Camera,
  CheckCircle2,
  Building2,
  Plus,
  Trash2,
} from 'lucide-react';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import {
  toISODateString,
  fromISODateString,
  getIndianTodayDate,
  getIndianTodayISODate,
  isAfterTodayIST,
} from '../utils/date';

export type QuickEntryType = 'in' | 'out' | 'both' | 'repair_in' | 'repair_out' | 'service';

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

export interface BranchTransferDispatchPayload {
  toBranchId: string;
  date: string;
  items: Array<{
    modelId: string;
    modelName: string;
    quantity: number;
    serialNos?: string[];
    notes?: string;
  }>;
  partner?: string;
  notes?: string;
}

interface QuickEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: DayRecord;
  columns: BatteryColumn[];
  activeBranch: BranchInfo;
  initialEntryType?: QuickEntryType;
  onSaveRecord: (
    updated: DayRecord,
    triggerWhatsApp?: boolean,
    serialEntries?: SerialEntryPayload[]
  ) => void;
  onCreateBranchTransfer?: (transfer: BranchTransferDispatchPayload) => Promise<void> | void;
  recordedDates?: string[];
  onSelectDate?: (date: string) => void;
}

export const QuickEntryModal: React.FC<QuickEntryModalProps> = ({
  isOpen,
  onClose,
  record,
  columns,
  activeBranch,
  initialEntryType = 'in',
  onSaveRecord,
  onCreateBranchTransfer,
  onSelectDate,
}) => {
  const [entryType, setEntryType] = useState<QuickEntryType>(initialEntryType);

  // Primary fields (used for IN / OUT / Repair / Service, and as OUT side when entryType === 'both')
  const [selectedColId, setSelectedColId] = useState<string>(columns[0]?.id || '60x24_old');
  const [quantity, setQuantity] = useState<number>(1);
  const [cause, setCause] = useState<string>('');
  const [partnerName, setPartnerName] = useState<string>('');
  const [vehicleOrLocation, setVehicleOrLocation] = useState<string>('');
  const [serialInput, setSerialInput] = useState<string>('');
  const [batchNo, setBatchNo] = useState<string>('');

  // Inter-Branch Transfer fields (when dispatching OUT to another branch)
  const [targetBranchId, setTargetBranchId] = useState<string>('');
  const [extraOutItems, setExtraOutItems] = useState<Array<{ modelId: string; quantity: number }>>([]);

  // Additional INWARD fields used exclusively when entryType === 'both'
  const [inColId, setInColId] = useState<string>(columns[0]?.id || '60x24_old');
  const [inQuantity, setInQuantity] = useState<number>(1);
  const [inPartner, setInPartner] = useState<string>('');
  const [inCauseText, setInCauseText] = useState<string>('');
  const [inSerialInput, setInSerialInput] = useState<string>('');

  const [scannerTarget, setScannerTarget] = useState<'primary' | 'both_in'>('primary');
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [lastScannedSerial, setLastScannedSerial] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEntryType(initialEntryType || 'in');
    }
  }, [isOpen, initialEntryType]);

  const todayIST = getIndianTodayDate();
  const todayISO = getIndianTodayISODate();

  const otherBranches = BRANCHES.filter((b) => b.id !== activeBranch.id);

  const handleScanComplete = (scannedSerial: string, detectedBatch?: string) => {
    const trimmed = scannedSerial.trim();
    if (!trimmed) return;

    const setter = scannerTarget === 'both_in' ? setInSerialInput : setSerialInput;
    setter((prev) => {
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

  const handleAutoGenerateSerials = (colId: string, qty: number, target: 'primary' | 'both_in') => {
    const colName = columns.find((c) => c.id === colId)?.name || 'BAT';
    const cleanPrefix = colName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
    const generated: string[] = [];
    const baseNum = Math.floor(1000 + Math.random() * 9000);
    for (let i = 0; i < qty; i++) {
      generated.push(`${cleanPrefix}-${baseNum + i}`);
    }
    if (target === 'both_in') {
      setInSerialInput(generated.join(', '));
    } else {
      setSerialInput(generated.join(', '));
    }
  };

  const buildSerialList = (raw: string): string[] =>
    raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const generateRemainingInSerials = (existing: string[], modelName: string, qty: number): string[] => {
    if (existing.length >= qty) return existing;
    const cleanPrefix =
      modelName
        .replace(/[×x\s]/g, '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .slice(0, 6) || 'BAT';
    const randomBase = Math.floor(1000 + Math.random() * 9000);
    const needed = qty - existing.length;
    const generated = Array.from({ length: needed }, (_, i) => `BAT-${cleanPrefix}-${randomBase + i}`);
    return [...existing, ...generated];
  };

  const handleSave = async (andSendWhatsApp = false) => {
    const updated: DayRecord = {
      ...record,
      branchId: activeBranch.id,
      stock: { ...record.stock },
      inStock: { ...record.inStock },
      inCause: { ...record.inCause },
      outStock: { ...record.outStock },
      outCause: { ...record.outCause },
    };

    const targetBranch = targetBranchId ? BRANCHES.find((b) => b.id === targetBranchId) : undefined;
    const allSerialEntries: SerialEntryPayload[] = [];
    let transferPayload: BranchTransferDispatchPayload | null = null;

    if (entryType === 'both') {
      // 1. Apply INWARD (IN) side
      const inCol = columns.find((c) => c.id === inColId) || { id: inColId, name: inColId };
      const inFullCause =
        [inPartner.trim(), inCauseText.trim()].filter(Boolean).join(' , ') ||
        `Inward stock (+${inQuantity})`;

      updated.inStock[inColId] = (updated.inStock[inColId] || 0) + inQuantity;
      updated.inCause[inColId] = updated.inCause[inColId]
        ? `${updated.inCause[inColId]}\n${inFullCause}`
        : inFullCause;
      const inSummary = `${inCol.name}: ${inFullCause}`;
      updated.totalInCause = updated.totalInCause
        ? `${updated.totalInCause}\n${inSummary}`
        : inSummary;

      const inSerials = generateRemainingInSerials(buildSerialList(inSerialInput), inCol.name, inQuantity);
      inSerials.forEach((s) => {
        allSerialEntries.push({
          serialNo: s,
          batchNo: batchNo.trim() || inCol.name,
          modelId: inCol.id,
          modelName: inCol.name,
          type: 'in',
          cause: inFullCause,
          partner: inPartner.trim() || undefined,
        });
      });

      // 2. Apply OUTWARD (OUT) side
      const outCol = columns.find((c) => c.id === selectedColId) || { id: selectedColId, name: selectedColId };
      const outLocationPart = targetBranch
        ? `Sent to ${targetBranch.name}`
        : vehicleOrLocation.trim();
      const outFullCause =
        [outLocationPart, partnerName.trim(), cause.trim()].filter(Boolean).join(' , ') ||
        `Outward dispatch (-${quantity})`;

      const outItems = [
        { modelId: selectedColId, modelName: outCol.name, quantity },
        ...extraOutItems
          .filter((item) => item.quantity > 0)
          .map((item) => {
            const col = columns.find((c) => c.id === item.modelId);
            return {
              modelId: item.modelId,
              modelName: col?.name || item.modelId,
              quantity: item.quantity,
            };
          }),
      ];

      outItems.forEach((item) => {
        updated.outStock[item.modelId] = (updated.outStock[item.modelId] || 0) - item.quantity;
        updated.outCause[item.modelId] = updated.outCause[item.modelId]
          ? `${updated.outCause[item.modelId]}\n${outFullCause}`
          : outFullCause;
        const outSummary = `${item.modelName}: ${outFullCause}`;
        updated.totalOutCause = updated.totalOutCause
          ? `${updated.totalOutCause}\n${outSummary}`
          : outSummary;
      });

      const outSerials = buildSerialList(serialInput);
      outSerials.forEach((s) => {
        allSerialEntries.push({
          serialNo: s,
          batchNo: batchNo.trim() || outCol.name,
          modelId: outCol.id,
          modelName: outCol.name,
          type: 'out',
          cause: outFullCause,
          partner: partnerName.trim() || targetBranch?.name || undefined,
          vehicle: outLocationPart || undefined,
        });
      });

      if (targetBranch && onCreateBranchTransfer) {
        transferPayload = {
          toBranchId: targetBranch.id,
          date: updated.date,
          items: outItems.map((it, idx) => ({
            ...it,
            serialNos: idx === 0 && outSerials.length > 0 ? outSerials : undefined,
            notes: outFullCause,
          })),
          partner: partnerName.trim() || undefined,
          notes: cause.trim() || outFullCause,
        };
      }
    } else {
      const locationPart =
        entryType === 'out' && targetBranch ? `Sent to ${targetBranch.name}` : vehicleOrLocation.trim();
      const parts = [locationPart, partnerName.trim(), cause.trim()].filter(Boolean);
      const fullCause = parts.join(' , ');

      if (entryType === 'in') {
        const targetCol = columns.find((c) => c.id === selectedColId);
        updated.inStock[selectedColId] = (updated.inStock[selectedColId] || 0) + quantity;
        updated.inCause[selectedColId] = updated.inCause[selectedColId]
          ? `${updated.inCause[selectedColId]}\n${fullCause}`
          : fullCause;
        const summaryLine = `${targetCol?.name || selectedColId}: ${fullCause}`;
        updated.totalInCause = updated.totalInCause
          ? `${updated.totalInCause}\n${summaryLine}`
          : summaryLine;
      } else if (entryType === 'out') {
        const outItems = [
          {
            modelId: selectedColId,
            modelName: columns.find((c) => c.id === selectedColId)?.name || selectedColId,
            quantity,
          },
          ...extraOutItems
            .filter((item) => item.quantity > 0)
            .map((item) => {
              const col = columns.find((c) => c.id === item.modelId);
              return {
                modelId: item.modelId,
                modelName: col?.name || item.modelId,
                quantity: item.quantity,
              };
            }),
        ];

        outItems.forEach((item) => {
          updated.outStock[item.modelId] = (updated.outStock[item.modelId] || 0) - item.quantity;
          updated.outCause[item.modelId] = updated.outCause[item.modelId]
            ? `${updated.outCause[item.modelId]}\n${fullCause}`
            : fullCause;
          const summaryLine = `${item.modelName}: ${fullCause}`;
          updated.totalOutCause = updated.totalOutCause
            ? `${updated.totalOutCause}\n${summaryLine}`
            : summaryLine;
        });

        if (targetBranch && onCreateBranchTransfer) {
          const outSerials = buildSerialList(serialInput);
          transferPayload = {
            toBranchId: targetBranch.id,
            date: updated.date,
            items: outItems.map((it, idx) => ({
              ...it,
              serialNos: idx === 0 && outSerials.length > 0 ? outSerials : undefined,
              notes: fullCause,
            })),
            partner: partnerName.trim() || undefined,
            notes: cause.trim() || fullCause,
          };
        }
      } else if (entryType === 'repair_in') {
        updated.inStock['repair'] = (updated.inStock['repair'] || 0) + quantity;
        updated.repairInCause = updated.repairInCause
          ? `${updated.repairInCause}\n${fullCause}`
          : fullCause;
      } else if (entryType === 'repair_out') {
        updated.outStock['repair'] = (updated.outStock['repair'] || 0) - quantity;
        updated.repairOutCause = updated.repairOutCause
          ? `${updated.repairOutCause}\n${fullCause}`
          : fullCause;
      } else if (entryType === 'service') {
        updated.stock['service'] = (updated.stock['service'] || 0) + quantity;
      }

      const targetModel =
        entryType === 'repair_in' || entryType === 'repair_out'
          ? { id: 'repair', name: 'OLD BATTERY FOR REPAIR' }
          : entryType === 'service'
          ? { id: 'service', name: 'SERVICE BATTERY' }
          : columns.find((c) => c.id === selectedColId) || { id: selectedColId, name: selectedColId };

      let finalSerials = buildSerialList(serialInput);
      if (entryType === 'in') {
        finalSerials = generateRemainingInSerials(finalSerials, targetModel.name, quantity);
      }

      finalSerials.forEach((s) => {
        allSerialEntries.push({
          serialNo: s,
          batchNo: batchNo.trim() || targetModel.name,
          modelId: targetModel.id,
          modelName: targetModel.name,
          type: entryType,
          cause: fullCause,
          partner: partnerName.trim() || targetBranch?.name || undefined,
          vehicle: locationPart || undefined,
        });
      });
    }

    updated.lastModified = new Date().toISOString();
    onSaveRecord(updated, andSendWhatsApp, allSerialEntries);
    if (transferPayload && onCreateBranchTransfer) {
      await onCreateBranchTransfer(transferPayload);
    }
    onClose();

    // Reset form
    setQuantity(1);
    setInQuantity(1);
    setCause('');
    setInCauseText('');
    setPartnerName('');
    setInPartner('');
    setVehicleOrLocation('');
    setSerialInput('');
    setInSerialInput('');
    setBatchNo('');
    setTargetBranchId('');
    setExtraOutItems([]);
  };

  const selectedCol = columns.find((c) => c.id === selectedColId);
  const currentOpen = selectedCol ? record.stock[selectedCol.id] || 0 : 0;
  const currentIn = selectedCol ? record.inStock[selectedCol.id] || 0 : 0;
  const currentOut = selectedCol ? record.outStock[selectedCol.id] || 0 : 0;
  const currentClosing = currentOpen + currentIn + currentOut;

  const previewClosing =
    entryType === 'in'
      ? currentClosing + quantity
      : entryType === 'out'
      ? currentClosing - quantity
      : currentClosing;

  const inSelectedCol = columns.find((c) => c.id === inColId);
  const inColClosing = inSelectedCol
    ? (record.stock[inSelectedCol.id] || 0) +
      (record.inStock[inSelectedCol.id] || 0) +
      (record.outStock[inSelectedCol.id] || 0)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div
        className="bg-white rounded-2xl shadow-2xl border-2 border-slate-300 w-full max-w-2xl flex flex-col overflow-hidden my-auto ring-1 ring-slate-900/10"
        style={{ maxHeight: 'min(92vh, calc(100% - 2rem))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 bg-slate-900 text-white shrink-0 rounded-t-2xl gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm sm:text-base font-bold whitespace-nowrap">
              Log Battery IN / OUT ({activeBranch.shortName})
            </h2>
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

        {/* Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-3.5 overscroll-contain">
          {/* Movement Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Transaction Category:
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <button
                type="button"
                onClick={() => setEntryType('in')}
                className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                  entryType === 'in'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 shadow-xs ring-1 ring-emerald-500/30'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <PlusCircle className="w-5 h-5 text-emerald-600 mb-1" />
                <span>In Stock</span>
                <span className="text-[10px] text-emerald-600 font-normal">Add Inward (+)</span>
              </button>

              <button
                type="button"
                onClick={() => setEntryType('out')}
                className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                  entryType === 'out'
                    ? 'border-rose-500 bg-rose-50 text-rose-800 shadow-xs ring-1 ring-rose-500/30'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <MinusCircle className="w-5 h-5 text-rose-600 mb-1" />
                <span>Out Stock</span>
                <span className="text-[10px] text-rose-600 font-normal">Send / Transfer (-)</span>
              </button>

              <button
                type="button"
                onClick={() => setEntryType('both')}
                className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                  entryType === 'both'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900 shadow-xs ring-1 ring-indigo-500/30'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ArrowLeftRight className="w-5 h-5 text-indigo-600 mb-1" />
                <span>Both IN & OUT</span>
                <span className="text-[10px] text-indigo-600 font-normal">Log Both Together</span>
              </button>

              <button
                type="button"
                onClick={() => setEntryType('repair_in')}
                className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
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
                className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
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

          {/* ===================================================================
              MODE: BOTH IN & OUT SIDE-BY-SIDE PANELS
             =================================================================== */}
          {entryType === 'both' ? (
            <div className="space-y-3.5">
              {/* Panel A: INWARD (+) */}
              <div className="p-3.5 bg-emerald-50/70 border border-emerald-300 rounded-xl space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <PlusCircle className="w-4 h-4 text-emerald-700" />
                    <span className="text-xs font-black text-emerald-950 uppercase tracking-wide">
                      1. Stock IN (Inward +)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-white text-emerald-800 border border-emerald-300">
                    {inSelectedCol?.name}: {inColClosing} → {inColClosing + inQuantity} (+{inQuantity})
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Inward Model:
                    </label>
                    <select
                      value={inColId}
                      onChange={(e) => setInColId(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs border border-emerald-300 rounded-lg bg-white text-slate-800 font-medium"
                    >
                      {columns.map((col) => (
                        <option key={col.id} value={col.id}>
                          {col.name} (Open: {record.stock[col.id] || 0})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      IN Qty (+):
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={inQuantity}
                      onChange={(e) => setInQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full px-2.5 py-2 text-xs border border-emerald-300 rounded-lg bg-white font-bold tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    placeholder="From Person / Dealer (e.g. Service Center / Luvkush)"
                    value={inPartner}
                    onChange={(e) => setInPartner(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-emerald-200 rounded-lg bg-white placeholder-slate-400"
                  />
                  <input
                    type="text"
                    placeholder="Inward Reason / Cause"
                    value={inCauseText}
                    onChange={(e) => setInCauseText(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-emerald-200 rounded-lg bg-white placeholder-slate-400"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="IN Serial Numbers (optional — auto-generated if blank)"
                    value={inSerialInput}
                    onChange={(e) => setInSerialInput(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-emerald-200 rounded-lg bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setScannerTarget('both_in');
                      setIsScannerOpen(true);
                    }}
                    className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Scan</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAutoGenerateSerials(inColId, inQuantity, 'both_in')}
                    className="text-[11px] font-semibold text-emerald-800 underline cursor-pointer shrink-0"
                  >
                    Auto-fill
                  </button>
                </div>
              </div>

              {/* Panel B: OUTWARD (-) */}
              <div className="p-3.5 bg-rose-50/70 border border-rose-300 rounded-xl space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <MinusCircle className="w-4 h-4 text-rose-700" />
                    <span className="text-xs font-black text-rose-950 uppercase tracking-wide">
                      2. Stock OUT (Dispatch / Branch Transfer -)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-white text-rose-800 border border-rose-300">
                    {selectedCol?.name}: {currentClosing} → {currentClosing - quantity} (-{quantity})
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Outward Model:
                    </label>
                    <select
                      value={selectedColId}
                      onChange={(e) => setSelectedColId(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs border border-rose-300 rounded-lg bg-white text-slate-800 font-medium"
                    >
                      {columns.map((col) => (
                        <option key={col.id} value={col.id}>
                          {col.name} (Open: {record.stock[col.id] || 0})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      OUT Qty (-):
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full px-2.5 py-2 text-xs border border-rose-300 rounded-lg bg-white font-bold tabular-nums"
                    />
                  </div>
                </div>

                {/* Inter-Branch Destination Selector */}
                <div className="p-2.5 bg-white border border-rose-200 rounded-lg space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800">
                    <Building2 className="w-3.5 h-3.5 text-blue-600" />
                    <span>Send To Another Branch? (Triggers Receive Goods Notification)</span>
                  </label>
                  <select
                    value={targetBranchId}
                    onChange={(e) => setTargetBranchId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 font-semibold text-slate-800"
                  >
                    <option value="">External Customer / Vehicle / Dealer (No branch transfer)</option>
                    {otherBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        Transfer to: {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    placeholder="Driver / Dealer / Person Name"
                    value={partnerName}
                    onChange={(e) => setPartnerName(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-rose-200 rounded-lg bg-white placeholder-slate-400"
                  />
                  <input
                    type="text"
                    placeholder="Outward Reason / Vehicle / Remarks"
                    value={cause}
                    onChange={(e) => setCause(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-rose-200 rounded-lg bg-white placeholder-slate-400"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="OUT Serial Numbers (optional)"
                    value={serialInput}
                    onChange={(e) => setSerialInput(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-rose-200 rounded-lg bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setScannerTarget('primary');
                      setIsScannerOpen(true);
                    }}
                    className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Scan</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* If Repair Battery selected, choose In vs Out */}
              {(entryType === 'repair_in' || entryType === 'repair_out') && (
                <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs">
                  <span className="font-semibold text-amber-900">Repair Action:</span>
                  <button
                    type="button"
                    onClick={() => setEntryType('repair_in')}
                    className={`px-3 py-1 rounded font-medium cursor-pointer ${
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
                    className={`px-3 py-1 rounded font-medium cursor-pointer ${
                      entryType === 'repair_out'
                        ? 'bg-amber-600 text-white'
                        : 'bg-white text-amber-800 border border-amber-300'
                    }`}
                  >
                    Sent for Repair (-Out)
                  </button>
                </div>
              )}

              {/* Battery Model & Quantity Selection (for In/Out) */}
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

              {/* Quantity input for Repair / Service */}
              {(entryType === 'repair_in' || entryType === 'repair_out' || entryType === 'service') && (
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
              )}

              {/* Inter-Branch Transfer Option when OUT */}
              {entryType === 'out' && (
                <div className="p-3 bg-amber-50/80 border border-amber-300 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
                      <Building2 className="w-4 h-4 text-amber-700" />
                      <span>Send Stock to Another Branch (Inter-Branch Transfer)</span>
                    </label>
                    {targetBranchId && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                        Will Notify Receiving Branch
                      </span>
                    )}
                  </div>

                  <select
                    value={targetBranchId}
                    onChange={(e) => setTargetBranchId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-amber-300 rounded-lg bg-white text-slate-900 font-semibold focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">External Customer / Vehicle / Dealer (Regular Dispatch)</option>
                    {otherBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        Transfer from {activeBranch.shortName} → {b.name}
                      </option>
                    ))}
                  </select>

                  {targetBranchId && (
                    <div className="space-y-2 pt-1">
                      {extraOutItems.map((extra, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select
                            value={extra.modelId}
                            onChange={(e) =>
                              setExtraOutItems((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, modelId: e.target.value } : it))
                              )
                            }
                            className="flex-1 px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white font-medium"
                          >
                            {columns.map((col) => (
                              <option key={col.id} value={col.id}>
                                {col.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={extra.quantity}
                            onChange={(e) =>
                              setExtraOutItems((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, quantity: Math.max(1, parseInt(e.target.value) || 1) } : it
                                )
                              )
                            }
                            className="w-20 px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white font-bold tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() => setExtraOutItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg cursor-pointer"
                            title="Remove model"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() =>
                          setExtraOutItems((prev) => [
                            ...prev,
                            { modelId: columns[1]?.id || columns[0]?.id || '60x24_flat', quantity: 1 },
                          ])
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 hover:text-amber-950 underline cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add another battery model to this branch transfer</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Live Preview Box */}
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
              ) : entryType === 'repair_in' || entryType === 'repair_out' ? (
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
                      New Closing:{' '}
                      {entryType === 'repair_in'
                        ? (record.stock['repair'] || 0) + quantity
                        : (record.stock['repair'] || 0) - quantity}
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
                      Person / Dealer / Driver Name:
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
                      placeholder={
                        targetBranchId
                          ? `Sending to ${BRANCHES.find((b) => b.id === targetBranchId)?.shortName}`
                          : 'e.g. Service center se / Morar se / Gaadi mai lagi'
                      }
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
                      onClick={() => {
                        setScannerTarget('primary');
                        setIsScannerOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-md shadow-xs transition-colors cursor-pointer"
                      title="Scan barcode with camera or capture battery label photo"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Scan Barcode (Camera)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAutoGenerateSerials(selectedColId, quantity, 'primary')}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Auto-fill {quantity}</span>
                    </button>
                  </div>
                </div>

                {lastScannedSerial && (
                  <div className="p-2 bg-emerald-100/90 border border-emerald-300 rounded-md text-emerald-900 text-xs font-semibold flex items-center justify-between animate-fade-in">
                    <span className="flex items-center gap-1.5 font-mono">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Scanned & Added: <strong>{lastScannedSerial}</strong>
                      </span>
                    </span>
                    <span className="text-[10px] text-emerald-700 font-sans font-normal">
                      Ready for next or Save
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Serial Number(s){' '}
                        <span className="text-slate-400 font-normal">(comma or enter separated)</span>:
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
                        onClick={() => {
                          setScannerTarget('primary');
                          setIsScannerOpen(true);
                        }}
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
                    <strong>Confidential:</strong> Serial numbers are saved for in-app tracking and history
                    search, and will <strong>NOT</strong> appear on the WhatsApp Excel photo.
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Pinned Footer */}
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
              <span>
                {targetBranchId && (entryType === 'out' || entryType === 'both')
                  ? 'Save & Send to Branch'
                  : 'Update Excel & Serials'}
              </span>
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

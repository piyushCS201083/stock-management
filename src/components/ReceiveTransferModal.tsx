import React, { useState, useEffect } from 'react';
import {
  BatteryColumn,
  BranchInfo,
  BranchTransfer,
  BranchTransferItem,
} from '../types/stock';
import {
  Barcode,
  Calendar,
  Camera,
  CheckCircle2,
  PackageCheck,
  Sparkles,
  Truck,
  ArrowRight,
  X,
  Loader2,
} from 'lucide-react';
import {
  fromISODateString,
  getIndianTodayDate,
  getIndianTodayISODate,
  isAfterTodayIST,
  toISODateString,
} from '../utils/date';
import { BarcodeScannerModal } from './BarcodeScannerModal';

export interface EditableReceiveItem {
  transferId: string;
  itemId: string;
  fromBranchId: string;
  fromBranchName: string;
  sentDate: string;
  modelId: string;
  modelName: string;
  quantity: number;
  batchNo: string;
  serialInput: string;
  notes: string;
}

export interface ReceiveTransferConfirmPayload {
  receivingDate: string;
  partner: string;
  notes: string;
  selections: Array<{ transferId: string; itemIds: string[] }>;
  editedItems: Array<{
    transferId: string;
    itemId: string;
    fromBranchId: string;
    fromBranchName: string;
    modelId: string;
    modelName: string;
    quantity: number;
    batchNo: string;
    serialNos: string[];
    notes: string;
  }>;
}

interface ReceiveTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeBranch: BranchInfo;
  pendingItems: Array<{ transfer: BranchTransfer; item: BranchTransferItem }>;
  columns: BatteryColumn[];
  defaultReceivingDate: string;
  isSubmitting?: boolean;
  onConfirmSave: (payload: ReceiveTransferConfirmPayload) => Promise<void>;
}

const parseSerials = (raw: string): string[] =>
  Array.from(
    new Set(
      raw
        .split(/[\n,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    )
  );

export const ReceiveTransferModal: React.FC<ReceiveTransferModalProps> = ({
  isOpen,
  onClose,
  activeBranch,
  pendingItems,
  columns,
  defaultReceivingDate,
  isSubmitting = false,
  onConfirmSave,
}) => {
  const todayIST = getIndianTodayDate();
  const todayISO = getIndianTodayISODate();

  const [receivingDate, setReceivingDate] = useState<string>(defaultReceivingDate || todayIST);
  const [partner, setPartner] = useState<string>('');
  const [generalNotes, setGeneralNotes] = useState<string>('');
  const [items, setItems] = useState<EditableReceiveItem[]>([]);

  // Barcode scanner target item index
  const [scannerItemIndex, setScannerItemIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen || pendingItems.length === 0) return;

    const firstTransfer = pendingItems[0].transfer;
    const initialDate =
      defaultReceivingDate && !isAfterTodayIST(defaultReceivingDate)
        ? defaultReceivingDate
        : todayIST;

    setReceivingDate(initialDate);
    setPartner(firstTransfer.partner || '');
    setGeneralNotes(
      firstTransfer.notes && !firstTransfer.notes.startsWith('Sent to ')
        ? firstTransfer.notes
        : ''
    );

    setItems(
      pendingItems.map(({ transfer, item }) => ({
        transferId: transfer.id,
        itemId: item.id,
        fromBranchId: transfer.fromBranchId,
        fromBranchName: transfer.fromBranchName,
        sentDate: transfer.date,
        modelId: item.modelId,
        modelName: item.modelName,
        quantity: item.quantity || 1,
        batchNo: item.modelName,
        serialInput: (item.serialNos || []).join(', '),
        notes:
          item.notes && !item.notes.startsWith('Sent to ')
            ? item.notes
            : `Received from ${transfer.fromBranchName}`,
      }))
    );
  }, [isOpen, pendingItems, defaultReceivingDate, todayIST]);

  if (!isOpen || pendingItems.length === 0) return null;

  const totalUnits = items.reduce((sum, it) => sum + Math.max(0, it.quantity || 0), 0);
  const uniqueSenders = Array.from(new Set(items.map((it) => it.fromBranchName)));

  const handleModelChange = (index: number, newModelId: string) => {
    let resolvedName = newModelId;
    if (newModelId === 'repair') {
      resolvedName = 'OLD BATTERY FOR REPAIR';
    } else if (newModelId === 'service') {
      resolvedName = 'SERVICE BATTERY';
    } else {
      const found = columns.find((c) => c.id === newModelId);
      if (found) resolvedName = found.name;
    }

    setItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? {
              ...it,
              modelId: newModelId,
              modelName: resolvedName,
              batchNo:
                !it.batchNo || it.batchNo === it.modelName ? resolvedName : it.batchNo,
            }
          : it
      )
    );
  };

  const handleAutoFillSerials = (index: number) => {
    const target = items[index];
    if (!target) return;
    const existing = parseSerials(target.serialInput);
    const needed = Math.max(0, target.quantity - existing.length);
    if (needed <= 0) return;

    const cleanModel = (target.modelName || 'BAT')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 6);
    const stamp = Date.now().toString().slice(-4);
    const generated = Array.from(
      { length: needed },
      (_, idx) => `BAT-${cleanModel}-${stamp}${idx + 1}`
    );

    const combined = [...existing, ...generated];
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, serialInput: combined.join(', ') } : it))
    );
  };

  const handleScanComplete = (serialNo: string) => {
    if (scannerItemIndex === null) return;
    const clean = serialNo.trim().toUpperCase();
    if (!clean) return;
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== scannerItemIndex) return it;
        const current = parseSerials(it.serialInput);
        if (!current.includes(clean)) current.push(clean);
        return { ...it, serialInput: current.join(', ') };
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || items.length === 0) return;

    const grouped = new Map<string, string[]>();
    items.forEach((it) => {
      const list = grouped.get(it.transferId) || [];
      list.push(it.itemId);
      grouped.set(it.transferId, list);
    });

    const selections = Array.from(grouped.entries()).map(([transferId, itemIds]) => ({
      transferId,
      itemIds,
    }));

    await onConfirmSave({
      receivingDate,
      partner: partner.trim(),
      notes: generalNotes.trim(),
      selections,
      editedItems: items.map((it) => ({
        transferId: it.transferId,
        itemId: it.itemId,
        fromBranchId: it.fromBranchId,
        fromBranchName: it.fromBranchName,
        modelId: it.modelId,
        modelName: it.modelName,
        quantity: Math.max(1, Math.floor(it.quantity || 1)),
        batchNo: it.batchNo.trim() || it.modelName,
        serialNos: parseSerials(it.serialInput),
        notes: it.notes.trim(),
      })),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-xs overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-2xl border-2 border-slate-300 w-full max-w-2xl flex flex-col overflow-y-auto overscroll-contain my-auto ring-1 ring-slate-900/10"
        style={{ maxHeight: 'min(90vh, calc(100% - 2rem))' }}
      >
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-5 sm:px-6 py-4 bg-slate-900 text-white shrink-0 rounded-t-2xl shadow-sm gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300 shrink-0">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold">
                Receive & Review Battery Details
              </h2>
              <p className="text-[11px] text-slate-300 flex items-center gap-1.5 flex-wrap">
                <span>{uniqueSenders.join(', ')}</span>
                <ArrowRight className="w-3 h-3 text-emerald-400" />
                <strong className="text-emerald-300">{activeBranch.name}</strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 p-4 sm:p-6 space-y-4">
          {/* Instruction Banner */}
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block">
                Verify or Edit Details Before Adding to {activeBranch.shortName} Stock
              </span>
              <span className="text-[11px] text-emerald-800">
                You can update the battery model, quantity, serial number(s), carrier name, or date below. Once you click <strong>Save & Add to Stock</strong>, it automatically updates {activeBranch.shortName}'s inward stock and closing balance.
              </span>
            </div>
          </div>

          {/* Shared Receiving Details */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                <span>Receiving Date (IST):</span>
              </label>
              <input
                type="date"
                max={todayISO}
                value={toISODateString(receivingDate)}
                onChange={(e) => {
                  const iso = e.target.value;
                  if (!iso) return;
                  const formatted = fromISODateString(iso);
                  if (formatted && !isAfterTodayIST(formatted)) {
                    setReceivingDate(formatted);
                  }
                }}
                className="w-full px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white text-slate-900"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Driver / Carrier / Brought By:
              </label>
              <input
                type="text"
                placeholder="e.g. Luvkush / Sonu Bhaiya"
                value={partner}
                onChange={(e) => setPartner(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Receiving Remarks (Optional):
              </label>
              <input
                type="text"
                placeholder="e.g. Checked OK at gate"
                value={generalNotes}
                onChange={(e) => setGeneralNotes(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
              />
            </div>
          </div>

          {/* Editable Battery Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-extrabold text-slate-800 uppercase tracking-wide text-[11px]">
                Incoming Battery Item(s) — Editable ({items.length})
              </span>
              <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full text-[11px]">
                Total to Add: +{totalUnits} unit{totalUnits === 1 ? '' : 's'}
              </span>
            </div>

            {items.map((item, idx) => (
              <div
                key={`${item.transferId}::${item.itemId}`}
                className="p-3.5 bg-white border-2 border-amber-200 rounded-xl space-y-3 shadow-2xs"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-100 pb-2">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-900 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
                    <Truck className="w-3.5 h-3.5 text-blue-600" />
                    <span>From: {item.fromBranchName}</span>
                    <span className="text-blue-400">·</span>
                    <span className="font-mono">Sent {item.sentDate}</span>
                  </div>
                  <span className="text-xs font-black text-emerald-700">
                    +{item.quantity} Unit{item.quantity === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Battery Model / Category:
                    </label>
                    <select
                      value={item.modelId}
                      onChange={(e) => handleModelChange(idx, e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-semibold text-slate-900"
                    >
                      {columns.map((col) => (
                        <option key={col.id} value={col.id}>
                          {col.name}
                        </option>
                      ))}
                      <option value="repair">OLD BATTERY FOR REPAIR</option>
                      <option value="service">SERVICE BATTERY</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Quantity Received:
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={item.quantity}
                      onChange={(e) => {
                        const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                        setItems((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, quantity: val } : it))
                        );
                      }}
                      className="w-full px-2.5 py-1.5 text-xs font-bold border border-slate-300 rounded-lg bg-white text-slate-900 tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Batch Name (Optional):
                    </label>
                    <input
                      type="text"
                      value={item.batchNo}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, batchNo: e.target.value } : it))
                        )
                      }
                      placeholder={item.modelName}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Item Cause / Ledger Note:
                    </label>
                    <input
                      type="text"
                      value={item.notes}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, notes: e.target.value } : it))
                        )
                      }
                      placeholder={`Received from ${item.fromBranchName}`}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>

                {/* Serial Numbers Section */}
                <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <label className="text-[11px] font-bold text-blue-900 flex items-center gap-1.5">
                      <Barcode className="w-3.5 h-3.5 text-blue-700" />
                      <span>Battery Serial No.(s) (Comma separated)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setScannerItemIndex(idx)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 rounded cursor-pointer"
                      >
                        <Camera className="w-3 h-3" />
                        <span>Scan</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAutoFillSerials(idx)}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:text-blue-900 underline cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Auto-fill</span>
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={item.serialInput}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((it, i) =>
                          i === idx ? { ...it, serialInput: e.target.value } : it
                        )
                      )
                    }
                    placeholder="Enter or scan battery serial number(s)..."
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-blue-200 rounded-lg bg-white text-slate-900"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 bg-slate-100 border-t border-slate-200 px-5 sm:px-6 py-3.5 flex items-center justify-between gap-3 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg shadow-sm cursor-pointer ring-2 ring-emerald-500/30"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>
              {isSubmitting
                ? 'Saving to Stock...'
                : `Save & Add to ${activeBranch.shortName} Stock (+${totalUnits})`}
            </span>
          </button>
        </div>
      </form>

      <BarcodeScannerModal
        isOpen={scannerItemIndex !== null}
        onClose={() => setScannerItemIndex(null)}
        onScanComplete={handleScanComplete}
        initialModelName={
          scannerItemIndex !== null ? items[scannerItemIndex]?.modelName : undefined
        }
      />
    </div>
  );
};

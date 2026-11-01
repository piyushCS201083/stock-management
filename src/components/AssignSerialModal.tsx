import React, { useState, useEffect } from 'react';
import { BatteryColumn, BatterySerialItem, BatteryMovementEvent } from '../types/stock';
import {
  X,
  Barcode,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertCircle,
  Truck,
  Edit2,
  Clock,
  Sparkles,
  Camera,
} from 'lucide-react';
import { BarcodeScannerModal } from './BarcodeScannerModal';

interface AssignSerialModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelId: string;
  modelName: string;
  currentStock: number;
  existingSerials: BatterySerialItem[];
  activeDate: string;
  onSaveSerials: (items: BatterySerialItem[]) => void;
  onUpdateSerial: (item: BatterySerialItem) => void;
}

export const AssignSerialModal: React.FC<AssignSerialModalProps> = ({
  isOpen,
  onClose,
  modelId,
  modelName,
  currentStock,
  existingSerials,
  activeDate,
  onSaveSerials,
  onUpdateSerial,
}) => {
  // In-stock serials for this model
  const inStockSerials = existingSerials.filter((s) => s.status === 'in_stock');
  const missingCount = Math.max(0, currentStock - inStockSerials.length);

  // New serials form inputs
  const [newSerials, setNewSerials] = useState<
    Array<{
      serialNo: string;
      inwardPartner: string;
      inwardCause: string;
    }>
  >([]);

  // Editing existing serial
  const [editingSerial, setEditingSerial] = useState<BatterySerialItem | null>(null);
  const [editForm, setEditForm] = useState<{
    newSerialNo: string;
    status: BatterySerialItem['status'];
    inwardDate: string;
    inwardPartner: string;
    inwardCause: string;
    outwardDate: string;
    outwardPartner: string;
    outwardCause: string;
  }>({
    newSerialNo: '',
    status: 'in_stock',
    inwardDate: '',
    inwardPartner: '',
    inwardCause: '',
    outwardDate: '',
    outwardPartner: '',
    outwardCause: '',
  });

  const [activeTab, setActiveTab] = useState<'assign_missing' | 'manage_existing'>('assign_missing');
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const handleScanComplete = (scannedSerial: string) => {
    const trimmed = scannedSerial.trim();
    if (!trimmed) return;
    setNewSerials((prev) => {
      // If already in list, do not duplicate
      if (prev.some((r) => r.serialNo.toLowerCase() === trimmed.toLowerCase())) {
        return prev;
      }
      // If first row is empty, fill it
      if (prev.length === 1 && !prev[0].serialNo.trim()) {
        return [{ ...prev[0], serialNo: trimmed }];
      }
      return [
        ...prev,
        {
          serialNo: trimmed,
          inwardPartner: '',
          inwardCause: `Barcode scanned on ${activeDate}`,
        },
      ];
    });
  };

  // Initialize new serial input rows when modal opens or missingCount changes
  useEffect(() => {
    if (isOpen) {
      if (missingCount > 0) {
        setActiveTab('assign_missing');
        // Clean model code prefix for quick serial helper
        const cleanPrefix = modelName
          .replace(/[×x\s]/g, '')
          .replace(/[^A-Za-z0-9]/g, '')
          .toUpperCase()
          .slice(0, 6);
        
        const initialRows = Array.from({ length: Math.min(missingCount, 10) }, (_, i) => ({
          serialNo: `BAT-${cleanPrefix}-${String(existingSerials.length + i + 1).padStart(3, '0')}`,
          inwardPartner: '',
          inwardCause: 'Current stock inventory baseline',
        }));
        setNewSerials(initialRows);
      } else {
        setActiveTab('manage_existing');
        setNewSerials([]);
      }
      setEditingSerial(null);
    }
  }, [isOpen, missingCount, modelId, modelName]);

  const handleAddRow = () => {
    const cleanPrefix = modelName
      .replace(/[×x\s]/g, '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 6);
    setNewSerials((prev) => [
      ...prev,
      {
        serialNo: `BAT-${cleanPrefix}-${String(existingSerials.length + prev.length + 1).padStart(3, '0')}`,
        inwardPartner: '',
        inwardCause: '',
      },
    ]);
  };

  const handleRemoveRow = (index: number) => {
    setNewSerials((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRowChange = (index: number, field: string, value: string) => {
    setNewSerials((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleSaveNewSerials = (e: React.FormEvent) => {
    e.preventDefault();
    const validRows = newSerials.filter((r) => r.serialNo.trim().length > 0);
    if (validRows.length === 0) return;

    const nowIso = new Date().toISOString();
    const itemsToSave: BatterySerialItem[] = validRows.map((r, i) => {
      const event: BatteryMovementEvent = {
        id: `evt_assign_${Date.now()}_${i}`,
        timestamp: nowIso,
        date: activeDate,
        type: 'in',
        cause: r.inwardCause.trim() || `Assigned to stock on ${activeDate}`,
        partner: r.inwardPartner.trim() || undefined,
      };

      return {
        serialNo: r.serialNo.trim().toUpperCase(),
        batchNo: modelName,
        modelId,
        modelName,
        status: 'in_stock',
        inwardDate: activeDate,
        inwardPartner: r.inwardPartner.trim() || undefined,
        inwardCause: r.inwardCause.trim() || `Assigned to stock on ${activeDate}`,
        history: [event],
      };
    });

    onSaveSerials(itemsToSave);
    onClose();
  };

  const startEdit = (item: BatterySerialItem) => {
    setEditingSerial(item);
    setEditForm({
      newSerialNo: item.serialNo,
      status: item.status,
      inwardDate: item.inwardDate,
      inwardPartner: item.inwardPartner || '',
      inwardCause: item.inwardCause || '',
      outwardDate: item.outwardDate || (item.status === 'dispatched' ? activeDate : ''),
      outwardPartner: item.outwardPartner || '',
      outwardCause: item.outwardCause || '',
    });
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSerial) return;

    const nowIso = new Date().toISOString();
    const updatedHistory = [...(editingSerial.history || [])];

    // Log update event
    updatedHistory.push({
      id: `evt_upd_${Date.now()}`,
      timestamp: nowIso,
      date: activeDate,
      type: editForm.status === 'dispatched' ? 'out' : editForm.status === 'in_repair' ? 'repair_in' : 'in',
      cause: editForm.status === 'dispatched'
        ? editForm.outwardCause || 'Dispatched / updated in app'
        : 'Serial or movement details updated',
      partner: editForm.status === 'dispatched' ? editForm.outwardPartner : editForm.inwardPartner,
    });

    const updatedItem: BatterySerialItem = {
      ...editingSerial,
      serialNo: editForm.newSerialNo.trim().toUpperCase() || editingSerial.serialNo,
      status: editForm.status,
      inwardDate: editForm.inwardDate || editingSerial.inwardDate,
      inwardPartner: editForm.inwardPartner.trim() || undefined,
      inwardCause: editForm.inwardCause.trim() || undefined,
      outwardDate: editForm.status === 'dispatched' ? (editForm.outwardDate || activeDate) : undefined,
      outwardPartner: editForm.status === 'dispatched' ? (editForm.outwardPartner.trim() || undefined) : undefined,
      outwardCause: editForm.status === 'dispatched' ? (editForm.outwardCause.trim() || undefined) : undefined,
      history: updatedHistory,
    };

    onUpdateSerial(updatedItem);
    setEditingSerial(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div
        className="bg-white rounded-2xl shadow-2xl border-2 border-slate-300 w-full max-w-3xl flex flex-col overflow-hidden my-auto ring-1 ring-slate-900/10 animate-in fade-in zoom-in-95"
        style={{ maxHeight: 'min(90vh, calc(100% - 2rem))' }}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Barcode className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">Assign & Update Serial Numbers</h2>
                <span className="text-[11px] px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-bold uppercase tracking-wider">
                  {modelName}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Batch: <strong className="text-white">{modelName}</strong> · Today's Stock:{' '}
                <strong className="text-white">{currentStock} units</strong>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stock Status Bar */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 shrink-0 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-slate-500">Total Stock in Sheet:</span>{' '}
              <strong className="text-slate-900 font-bold text-sm tabular-nums">{currentStock}</strong>
            </div>
            <div>
              <span className="text-slate-500">Assigned Serials:</span>{' '}
              <strong className="text-emerald-700 font-bold text-sm tabular-nums">
                {inStockSerials.length}
              </strong>
            </div>
            <div>
              <span className="text-slate-500">Unassigned Units:</span>{' '}
              <strong
                className={`text-sm font-bold tabular-nums ${
                  missingCount > 0 ? 'text-amber-600' : 'text-slate-500'
                }`}
              >
                {missingCount}
              </strong>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setActiveTab('assign_missing');
                setEditingSerial(null);
              }}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                activeTab === 'assign_missing'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              + Assign Serial Numbers ({missingCount})
            </button>
            <button
              onClick={() => {
                setActiveTab('manage_existing');
                setEditingSerial(null);
              }}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                activeTab === 'manage_existing'
                  ? 'bg-slate-900 text-white font-bold'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              View & Edit Serials ({existingSerials.length})
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* TAB 1: Assign Missing Serials */}
          {activeTab === 'assign_missing' && !editingSerial && (
            <form onSubmit={handleSaveNewSerials} className="space-y-4">
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">
                    {missingCount > 0
                      ? `${missingCount} units of ${modelName} currently do not have serial numbers assigned.`
                      : `All current ${currentStock} stock units have serial numbers assigned!`}
                  </span>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Enter the unique serial number for each battery. You can also edit the suggested serials or add more rows below.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>Battery Serial Number Rows</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsScannerOpen(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-all cursor-pointer shadow-2xs"
                      title="Scan battery barcodes or QR codes with camera"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Scan Barcode</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddRow}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md font-semibold cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Row</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
                  {newSerials.map((row, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 hover:border-slate-300 transition-colors flex flex-col sm:flex-row gap-2 sm:items-center"
                    >
                      <div className="w-6 text-center text-xs font-mono font-bold text-slate-400">
                        #{idx + 1}
                      </div>

                      {/* Serial Number Input */}
                      <div className="flex-1">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase block mb-0.5">
                          Unique Serial No. *
                        </label>
                        <input
                          type="text"
                          required
                          value={row.serialNo}
                          onChange={(e) => handleRowChange(idx, 'serialNo', e.target.value)}
                          placeholder="e.g. BAT-6024-001"
                          className="w-full px-2.5 py-1.5 text-xs font-mono font-bold text-blue-800 bg-white border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                        />
                      </div>

                      {/* Inward / Dealer / Brought By */}
                      <div className="flex-1">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase block mb-0.5">
                          Received From / Dealer / Person
                        </label>
                        <input
                          type="text"
                          value={row.inwardPartner}
                          onChange={(e) => handleRowChange(idx, 'inwardPartner', e.target.value)}
                          placeholder="e.g. Luvkush / Service Center"
                          className="w-full px-2.5 py-1.5 text-xs text-slate-800 bg-white border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                        />
                      </div>

                      {/* Remarks / Cause */}
                      <div className="flex-1">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase block mb-0.5">
                          Cause / Source Remarks
                        </label>
                        <input
                          type="text"
                          value={row.inwardCause}
                          onChange={(e) => handleRowChange(idx, 'inwardCause', e.target.value)}
                          placeholder="e.g. Arrived from workshop"
                          className="w-full px-2.5 py-1.5 text-xs text-slate-800 bg-white border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                        />
                      </div>

                      {/* Delete row */}
                      <div className="sm:pt-4">
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(idx)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                          title="Remove row"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {newSerials.length === 0 && (
                    <div className="text-center py-6 text-slate-500 text-xs">
                      No serial rows yet. Click "Add Another Serial" to enter serial numbers.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={newSerials.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save & Register Serials ({newSerials.length})</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: Manage & Edit Existing Serials */}
          {activeTab === 'manage_existing' && !editingSerial && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">
                  Existing Batteries Tracked for {modelName} ({existingSerials.length})
                </span>
                <span className="text-slate-500">Click any battery to edit or update status</span>
              </div>

              {existingSerials.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs">
                  No serial numbers have been recorded for this model yet.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100 max-h-[50vh] overflow-y-auto">
                  {existingSerials.map((item) => (
                    <div
                      key={item.serialNo}
                      className="p-3 bg-white hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <Barcode className="w-4 h-4 text-blue-600 shrink-0" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-blue-700 text-sm">
                              {item.serialNo}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold capitalize ${
                                item.status === 'in_stock'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : item.status === 'dispatched'
                                  ? 'bg-slate-100 text-slate-700 border border-slate-200'
                                  : item.status === 'in_repair'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'bg-blue-50 text-blue-800 border border-blue-200'
                              }`}
                            >
                              {item.status.replace('_', ' ')}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-500 mt-0.5 space-x-2">
                            <span>In: {item.inwardDate}</span>
                            {item.inwardPartner && <span>· By: {item.inwardPartner}</span>}
                            {item.outwardPartner && (
                              <span className="text-rose-700 font-semibold">
                                · To: {item.outwardPartner} ({item.outwardDate})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => startEdit(item)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer shrink-0"
                      >
                        <Edit2 className="w-3 h-3 text-blue-600" />
                        <span>Edit / Update</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* EDIT SERIAL SUBFORM */}
          {editingSerial && (
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs">
                <div>
                  <span className="font-bold text-blue-900 block">
                    Editing Battery: {editingSerial.serialNo}
                  </span>
                  <span className="text-[11px] text-blue-700">Batch / Model: {modelName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingSerial(null)}
                  className="text-xs text-blue-700 hover:underline font-semibold cursor-pointer"
                >
                  ← Back to List
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Serial Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.newSerialNo}
                    onChange={(e) => setEditForm({ ...editForm, newSerialNo: e.target.value })}
                    className="w-full px-3 py-1.5 font-mono font-bold text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Current Status
                  </label>
                  <select
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm({ ...editForm, status: e.target.value as any })
                    }
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                  >
                    <option value="in_stock">In Stock (Available in Inventory)</option>
                    <option value="dispatched">Dispatched (Out to Customer / Vehicle / Dealer)</option>
                    <option value="in_repair">In Repair (Under service)</option>
                    <option value="service_standby">Service Standby (Temporary swap battery)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Inward Date
                  </label>
                  <input
                    type="text"
                    value={editForm.inwardDate}
                    onChange={(e) => setEditForm({ ...editForm, inwardDate: e.target.value })}
                    placeholder="DD-MM-YYYY"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Brought By / Dealer Source
                  </label>
                  <input
                    type="text"
                    value={editForm.inwardPartner}
                    onChange={(e) => setEditForm({ ...editForm, inwardPartner: e.target.value })}
                    placeholder="e.g. Luvkush (Service center)"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Inward Cause / Remarks
                  </label>
                  <input
                    type="text"
                    value={editForm.inwardCause}
                    onChange={(e) => setEditForm({ ...editForm, inwardCause: e.target.value })}
                    placeholder="e.g. Arrived from workshop for charging"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>

                {/* Outward section if dispatched */}
                {editForm.status === 'dispatched' && (
                  <>
                    <div className="sm:col-span-2 pt-2 border-t border-slate-200">
                      <span className="font-bold text-rose-800 text-[11px] uppercase tracking-wider block">
                        Outward Dispatched Details
                      </span>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                        Outward Date
                      </label>
                      <input
                        type="text"
                        value={editForm.outwardDate}
                        onChange={(e) => setEditForm({ ...editForm, outwardDate: e.target.value })}
                        placeholder="DD-MM-YYYY"
                        className="w-full px-3 py-1.5 border border-rose-300 rounded-lg font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                        Customer Vehicle / Dealer Name
                      </label>
                      <input
                        type="text"
                        value={editForm.outwardPartner}
                        onChange={(e) => setEditForm({ ...editForm, outwardPartner: e.target.value })}
                        placeholder="e.g. Sonu Bhaiya - Vehicle MP07-GA-1234"
                        className="w-full px-3 py-1.5 border border-rose-300 rounded-lg"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                        Outward Cause / Remarks
                      </label>
                      <input
                        type="text"
                        value={editForm.outwardCause}
                        onChange={(e) => setEditForm({ ...editForm, outwardCause: e.target.value })}
                        placeholder="e.g. Fitted into vehicle at Morar workshop"
                        className="w-full px-3 py-1.5 border border-rose-300 rounded-lg"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingSerial(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Update Battery Details</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        initialModelName={modelName}
        onScanComplete={handleScanComplete}
      />
    </div>
  );
};

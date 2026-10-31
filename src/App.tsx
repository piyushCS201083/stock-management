import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BatteryColumn,
  BatterySerialItem,
  DayRecord,
  TeamMember,
} from './types/stock';
import {
  loadRecords,
  saveRecords,
  loadColumns,
  saveColumns,
  loadTeamMembers,
  saveTeamMembers,
  calculateRecordTotals,
  createNextDayRecord,
} from './utils/storage';
import {
  apiFetchRecords,
  apiSaveRecord,
  apiFetchColumns,
  apiSaveColumns,
  apiFetchTeam,
  apiSaveTeam,
  apiFetchSerials,
  apiSaveSerial,
  apiBulkSaveSerials,
  loadLocalSerials,
  saveLocalSerials,
  checkBackendHealth,
  BackendStatus,
} from './services/api';
import { exportRecordToExcel } from './utils/excelExport';
import { Header } from './components/Header';
import { ExcelGrid } from './components/ExcelGrid';
import { QuickEntryModal, SerialEntryPayload } from './components/QuickEntryModal';
import { WhatsAppDispatchModal } from './components/WhatsAppDispatchModal';
import { TeamManagementModal } from './components/TeamManagementModal';
import { CloudDatabaseSettingsModal } from './components/CloudDatabaseSettingsModal';
import { SerialTrackerModal } from './components/SerialTrackerModal';
import { ReferenceImageViewer } from './components/ReferenceImageViewer';
import { BatchStockOverview } from './components/BatchStockOverview';
import { AssignSerialModal } from './components/AssignSerialModal';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Send,
  FileSpreadsheet,
  Download,
  Users,
  RotateCcw,
  CheckCircle,
  Database,
  Cloud,
  Barcode,
  X,
} from 'lucide-react';

import { getIndianTodayDate, getIndianFullDateString, addDaysToDateString } from './utils/date';

export default function App() {
  const [records, setRecords] = useState<Record<string, DayRecord>>(() => loadRecords());
  const [columns, setColumns] = useState<BatteryColumn[]>(() => loadColumns());
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => loadTeamMembers());
  const [serials, setSerials] = useState<Record<string, BatterySerialItem>>(() => loadLocalSerials());
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);

  // Current active date (defaults to 31-10-2026 baseline or current IST date)
  const [currentDate, setCurrentDate] = useState<string>(() => {
    const dates = Object.keys(records);
    if (dates.includes('31-10-2026')) return '31-10-2026';
    return dates.length > 0 ? dates[0] : '31-10-2026';
  });

  // Modal states
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);
  const [isSerialModalOpen, setIsSerialModalOpen] = useState(false);
  const [assignModal, setAssignModal] = useState<{
    isOpen: boolean;
    modelId: string;
    modelName: string;
    currentStock: number;
  }>({
    isOpen: false,
    modelId: '',
    modelName: '',
    currentStock: 0,
  });
  const [selectedSerialHistory, setSelectedSerialHistory] = useState<BatterySerialItem | null>(null);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);

  // Sync data from Cloud DBMS / backend on mount
  const syncWithCloudBackend = async () => {
    try {
      const [remoteRecords, remoteCols, remoteTeam, remoteSerials, health] = await Promise.all([
        apiFetchRecords(),
        apiFetchColumns(),
        apiFetchTeam(),
        apiFetchSerials(),
        checkBackendHealth(),
      ]);

      if (remoteRecords && Object.keys(remoteRecords).length > 0) {
        setRecords(remoteRecords);
      }
      if (remoteCols && remoteCols.length > 0) {
        setColumns(remoteCols);
      }
      if (remoteTeam && remoteTeam.length > 0) {
        setTeamMembers(remoteTeam);
      }
      if (remoteSerials && Object.keys(remoteSerials).length > 0) {
        setSerials(remoteSerials);
      }
      setBackendStatus(health);
    } catch (e) {
      console.warn('Initial cloud sync error:', e);
    }
  };

  useEffect(() => {
    syncWithCloudBackend();
  }, []);

  // Active day record
  const currentRecord: DayRecord = records[currentDate] || {
    date: currentDate,
    stock: {},
    inStock: {},
    inCause: {},
    outStock: {},
    outCause: {},
  };

  const totals = calculateRecordTotals(currentRecord, columns);

  // Total unassigned stock count across all models for current record closing stock
  const unassignedCount = useMemo(() => {
    let unassigned = 0;
    const serialList = Object.values(serials);

    // Check main columns
    columns.forEach((col) => {
      const stock = totals.closingStock[col.id] || 0;
      if (stock > 0) {
        const matchingInStock = serialList.filter(
          (s) =>
            (s.modelId === col.id || s.modelName === col.name || s.batchNo === col.name) &&
            s.status === 'in_stock'
        ).length;
        unassigned += Math.max(0, stock - matchingInStock);
      }
    });

    // Check repair
    if (totals.repair.closing > 0) {
      const repairInStock = serialList.filter(
        (s) =>
          (s.modelId === 'repair' || s.modelName.includes('REPAIR')) && s.status === 'in_stock'
      ).length;
      unassigned += Math.max(0, totals.repair.closing - repairInStock);
    }

    // Check service
    if (totals.service.closing > 0) {
      const serviceInStock = serialList.filter(
        (s) =>
          (s.modelId === 'service' || s.modelName.includes('SERVICE')) && s.status === 'in_stock'
      ).length;
      unassigned += Math.max(0, totals.service.closing - serviceInStock);
    }

    return unassigned;
  }, [columns, totals.closingStock, totals.repair.closing, totals.service.closing, serials]);

  // Bulk save serials from AssignSerialModal
  const handleBulkSaveSerials = async (newItems: BatterySerialItem[]) => {
    const updated = { ...serials };
    newItems.forEach((item) => {
      updated[item.serialNo] = item;
    });
    setSerials(updated);
    saveLocalSerials(updated);
    await apiBulkSaveSerials(newItems);
    showToast(`Assigned & registered ${newItems.length} serial number(s) successfully!`);
  };

  // Update single serial from edit form
  const handleUpdateSingleSerial = async (updatedItem: BatterySerialItem) => {
    const updated = { ...serials, [updatedItem.serialNo]: updatedItem };
    setSerials(updated);
    saveLocalSerials(updated);
    await apiSaveSerial(updatedItem);
    showToast(`Updated battery serial: ${updatedItem.serialNo}`);
  };

  // Update records in state, localStorage, and Cloud DBMS
  const handleUpdateRecord = async (
    updated: DayRecord,
    andTriggerWhatsApp = false,
    serialEntries?: SerialEntryPayload[]
  ) => {
    const newRecords = { ...records, [updated.date]: updated };
    setRecords(newRecords);
    saveRecords(newRecords);

    // Process serial numbers if entered (tracked in-app only, NOT on Excel photo)
    if (serialEntries && serialEntries.length > 0) {
      const updatedSerials = { ...serials };
      const savedList: BatterySerialItem[] = [];

      serialEntries.forEach((entry) => {
        const existing: BatterySerialItem = updatedSerials[entry.serialNo] || {
          serialNo: entry.serialNo,
          batchNo: entry.batchNo,
          modelId: entry.modelId,
          modelName: entry.modelName,
          status:
            entry.type === 'out'
              ? 'dispatched'
              : entry.type === 'repair_in' || entry.type === 'repair_out'
              ? 'in_repair'
              : entry.type === 'service'
              ? 'service_standby'
              : 'in_stock',
          inwardDate: updated.date,
          inwardCause: entry.cause,
          inwardPartner: entry.partner,
          history: [],
        };

        const movement = {
          id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          timestamp: new Date().toISOString(),
          date: updated.date,
          type: entry.type,
          cause: entry.cause,
          partner: entry.partner,
          vehicleOrLocation: entry.vehicle,
        };

        existing.history = [movement, ...(existing.history || [])];

        if (entry.type === 'in') {
          existing.status = 'in_stock';
          existing.inwardDate = updated.date;
          existing.inwardCause = entry.cause;
          existing.inwardPartner = entry.partner;
        } else if (entry.type === 'out') {
          existing.status = 'dispatched';
          existing.outwardDate = updated.date;
          existing.outwardCause = entry.cause;
          existing.outwardPartner = entry.partner;
        } else if (entry.type === 'repair_in' || entry.type === 'repair_out') {
          existing.status = 'in_repair';
        } else if (entry.type === 'service') {
          existing.status = 'service_standby';
        }

        if (entry.batchNo) existing.batchNo = entry.batchNo;

        updatedSerials[entry.serialNo] = existing;
        savedList.push(existing);
      });

      setSerials(updatedSerials);
      apiBulkSaveSerials(savedList);
      showToast(`Tracked ${savedList.length} battery serial numbers in app`);
    } else {
      showToast(`Saving ${updated.date} to Cloud DBMS...`);
    }

    // Async save to Cloud DBMS (Render / PostgreSQL)
    try {
      await apiSaveRecord(updated);
    } catch (e) {
      showToast(`Saved locally (will sync when online)`);
    }

    if (andTriggerWhatsApp) {
      setIsWhatsAppOpen(true);
    }
  };

  const showToast = (msg: string) => {
    setNotificationToast(msg);
    setTimeout(() => setNotificationToast(null), 3000);
  };

  // Add battery column
  const handleAddColumn = async (name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (columns.some((c) => c.id === id)) {
      showToast('Column already exists!');
      return;
    }
    const newCol: BatteryColumn = { id, name };
    const updated = [...columns, newCol];
    setColumns(updated);
    saveColumns(updated);
    await apiSaveColumns(updated);
    showToast(`Added battery model: ${name}`);
  };

  // Create next day entry carrying over today's closing stock
  const handleCreateNextDay = async () => {
    const nextDayRecord = createNextDayRecord(currentRecord, columns);
    const newRecords = { ...records, [nextDayRecord.date]: nextDayRecord };
    setRecords(newRecords);
    saveRecords(newRecords);
    setCurrentDate(nextDayRecord.date);
    await apiSaveRecord(nextDayRecord);
    showToast(`Created new ledger for ${nextDayRecord.date} with closing balance carried over!`);
  };

  // Navigate between recorded dates
  const recordedDates = Object.keys(records).sort();
  const currentIndex = recordedDates.indexOf(currentDate);

  const handlePrevDate = () => {
    if (currentIndex > 0) {
      setCurrentDate(recordedDates[currentIndex - 1]);
    }
  };

  const handleNextDate = () => {
    if (currentIndex < recordedDates.length - 1) {
      setCurrentDate(recordedDates[currentIndex + 1]);
    } else {
      handleCreateNextDay();
    }
  };

  // Reset to verified 31-10-2026 photo baseline
  const handleResetToPhoto = async () => {
    if (window.confirm('Reset this date back to verified official stock values from the 31-10-2026 photo?')) {
      const initial = loadRecords();
      setRecords(initial);
      saveRecords(initial);
      setCurrentDate('31-10-2026');
      if (initial['31-10-2026']) {
        await apiSaveRecord(initial['31-10-2026']);
      }
      showToast('Reset to official 31-10-2026 photo baseline.');
    }
  };

  // Jump to Indian Standard Time (IST) Today
  const handleJumpToTodayIST = () => {
    const todayIST = getIndianTodayDate();
    if (records[todayIST]) {
      setCurrentDate(todayIST);
      showToast(`Switched to today's date in India: ${todayIST}`);
    } else {
      // Prompt to create today carrying forward from the latest record
      const latestDate = recordedDates[recordedDates.length - 1];
      const baseRecord = records[latestDate] || currentRecord;
      const newDayRecord = createNextDayRecord(baseRecord, columns);
      newDayRecord.date = todayIST;
      newDayRecord.notes = `Created for IST Today (${todayIST}) carrying forward closing stock`;

      const newRecords = { ...records, [todayIST]: newDayRecord };
      setRecords(newRecords);
      saveRecords(newRecords);
      setCurrentDate(todayIST);
      apiSaveRecord(newDayRecord);
      showToast(`Created today's ledger (${todayIST} IST) with closing balance carried over!`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-900 font-sans">
      {/* Top Bar adhering to Top Bar Contract */}
      <Header
        onOpenQuickEntry={() => setIsQuickEntryOpen(true)}
        onOpenWhatsAppDispatch={() => setIsWhatsAppOpen(true)}
        onOpenTeamModal={() => setIsTeamModalOpen(true)}
        onOpenCloudSettings={() => setIsCloudModalOpen(true)}
        onOpenSerialTracker={() => setIsSerialModalOpen(true)}
        onExportExcel={() => exportRecordToExcel(currentRecord, columns)}
        currentDate={currentDate}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Workspace Toolbar & Date Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Left: Date Switcher & Day Navigation & Cloud Status */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center bg-slate-50 border border-slate-300 rounded-lg p-1">
                <button
                  onClick={handlePrevDate}
                  disabled={currentIndex <= 0}
                  className="p-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-30 rounded hover:bg-slate-200 cursor-pointer"
                  title="Previous Date"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-2 px-3 py-1 font-bold text-slate-900 text-sm">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  <select
                    value={currentDate}
                    onChange={(e) => setCurrentDate(e.target.value)}
                    className="bg-transparent font-bold text-slate-900 focus:outline-none cursor-pointer"
                  >
                    {recordedDates.map((d) => (
                      <option key={d} value={d}>
                        {d} {d === '31-10-2026' ? '(Official Photo Baseline)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleNextDate}
                  className="p-1.5 text-slate-600 hover:text-slate-900 rounded hover:bg-slate-200 cursor-pointer"
                  title="Next Date or Create Tomorrow"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={handleJumpToTodayIST}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-300 transition-colors cursor-pointer"
                title="Jump to today's date in India Standard Time"
              >
                <span>Today (IST)</span>
              </button>

              <button
                onClick={handleCreateNextDay}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                title="Create next day entry carrying forward today's closing stock"
              >
                <Plus className="w-3.5 h-3.5 text-blue-600" />
                <span>Next Day Carryover</span>
              </button>

              <button
                onClick={() => setIsCloudModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 cursor-pointer"
                title="View Cloud DBMS and deployment info"
              >
                <Database className="w-3 h-3 text-emerald-600" />
                <span className="hidden sm:inline">DBMS:</span>
                <span className="font-semibold text-slate-800">
                  {backendStatus?.online ? 'Connected' : 'Active'}
                </span>
              </button>

              <ReferenceImageViewer />
            </div>

            {/* Right: Quick Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setIsSerialModalOpen(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 border border-amber-500 rounded-lg shadow-xs transition-all cursor-pointer ring-1 ring-amber-400/50"
                title="Search battery serials, view batchwise stock, and trace complete history"
              >
                <Barcode className="w-4 h-4 text-slate-950" />
                <span className="font-extrabold text-slate-950">Serial & Batch Tracker</span>
                {unassignedCount > 0 ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-900 text-amber-300 font-bold">
                    {unassignedCount} to Assign
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-800 text-white font-bold">
                    All Serialized
                  </span>
                )}
              </button>

              <button
                onClick={() => setIsQuickEntryOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Log Transaction</span>
              </button>

              <button
                onClick={() => setIsWhatsAppOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Dispatch to WhatsApp</span>
              </button>

              <button
                onClick={() => exportRecordToExcel(currentRecord, columns)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                title="Export this sheet to Excel (.xlsx)"
              >
                <Download className="w-3.5 h-3.5 text-slate-600" />
                <span>Excel (.xlsx)</span>
              </button>
            </div>
          </div>

          {/* KPI Summary Strip (Quantitative rigor with tabular nums) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-3 border-t border-slate-100">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
                Opening Stock
              </span>
              <span className="text-xl font-extrabold text-slate-900 tabular-nums">
                {totals.openingStockTotal}
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">Standard models</span>
            </div>

            <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-200">
              <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide block">
                Inward (In Stock)
              </span>
              <span className="text-xl font-extrabold text-emerald-700 tabular-nums">
                +{totals.inStockTotal}
              </span>
              <span className="text-[11px] text-emerald-600/80 block mt-0.5">
                Received / Exchanged
              </span>
            </div>

            <div className="p-3 bg-rose-50/60 rounded-lg border border-rose-200">
              <span className="text-[11px] font-semibold text-rose-700 uppercase tracking-wide block">
                Outward (Out Stock)
              </span>
              <span className="text-xl font-extrabold text-rose-700 tabular-nums">
                {totals.outStockTotal}
              </span>
              <span className="text-[11px] text-rose-600/80 block mt-0.5">
                Vehicles / Dealers
              </span>
            </div>

            <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-200">
              <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide block">
                Today's Closing
              </span>
              <span className="text-xl font-extrabold text-blue-800 tabular-nums">
                {totals.closingStockTotal}
              </span>
              <span className="text-[11px] text-blue-600/80 block mt-0.5">Units in store</span>
            </div>

            <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-200">
              <span className="text-[11px] font-semibold text-amber-800 uppercase tracking-wide block">
                Old For Repair
              </span>
              <span className="text-xl font-extrabold text-amber-900 tabular-nums">
                {totals.repair.closing}
              </span>
              <span className="text-[11px] text-amber-700/80 block mt-0.5">
                In: +{totals.repair.in} | Out: {totals.repair.out}
              </span>
            </div>

            <div className="p-3 bg-indigo-50/60 rounded-lg border border-indigo-200">
              <span className="text-[11px] font-semibold text-indigo-800 uppercase tracking-wide block">
                Service Standby
              </span>
              <span className="text-xl font-extrabold text-indigo-900 tabular-nums">
                {totals.service.closing}
              </span>
              <span className="text-[11px] text-indigo-600/80 block mt-0.5">Total pool units</span>
            </div>
          </div>
        </div>

        {/* Top: Batchwise Stock (Battery Models) & Serial Number History Search */}
        <BatchStockOverview
          currentRecord={currentRecord}
          columns={columns}
          serials={serials}
          closingStock={totals.closingStock}
          onOpenAssignModal={(modelId, modelName, currentStock) => {
            setAssignModal({
              isOpen: true,
              modelId,
              modelName,
              currentStock,
            });
          }}
          onOpenSerialTrackerModal={() => setIsSerialModalOpen(true)}
          onUpdateSerial={handleUpdateSingleSerial}
          onSelectSerialHistory={(item) => setSelectedSerialHistory(item)}
        />

        {/* The Excel Spreadsheet (Exact replica of user's photo) */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                <span>Battery Daily Inventory Spreadsheet</span>
              </h2>
              <p className="text-xs text-slate-500">
                Identical to your daily Excel photo. Tap any cell directly to edit quantities or remarks.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleResetToPhoto}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                title="Reset to official 31-10-2026 photo baseline"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset 31-10 Baseline</span>
              </button>
            </div>
          </div>

          <ExcelGrid
            record={currentRecord}
            columns={columns}
            onUpdateRecord={handleUpdateRecord}
            onAddColumn={handleAddColumn}
            tableRef={tableRef}
          />

          {/* Workflow instruction tip */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100 gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Daily Workflow:</span>
              <span>1. Update Inward/Outward counts & causes</span>
              <span>→</span>
              <span>2. Click "Dispatch to WhatsApp"</span>
              <span>→</span>
              <span>3. Copy/Send Photo & Text to team</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">Database Storage:</span>
              <span className="text-emerald-700 font-medium">Render Cloud DBMS & PostgreSQL Enabled</span>
            </div>
          </div>
        </section>

        {/* Team Members & Notification Channel Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600" />
                <span>Active WhatsApp Team Recipients</span>
              </h3>
              <p className="text-xs text-slate-500">
                These team members are notified daily when stock records are updated.
              </p>
            </div>

            <button
              onClick={() => setIsTeamModalOpen(true)}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer"
            >
              Configure Contacts ({teamMembers.length})
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {teamMembers.map((member) => (
              <div
                key={member.id}
                className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex flex-col justify-between"
              >
                <div>
                  <div className="font-bold text-slate-900 truncate">{member.name}</div>
                  <div className="text-slate-500 text-[11px] truncate">{member.role}</div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between">
                  <span className="font-mono text-slate-600 text-[11px]">+{member.phone}</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      member.active ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                    title={member.active ? 'Active' : 'Paused'}
                  ></span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Floating Notification Toast */}
      {notificationToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-xs font-medium flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span>{notificationToast}</span>
        </div>
      )}

      {/* Modals */}
      <QuickEntryModal
        isOpen={isQuickEntryOpen}
        onClose={() => setIsQuickEntryOpen(false)}
        record={currentRecord}
        columns={columns}
        onSaveRecord={(updated, andWhatsApp, serialEntries) =>
          handleUpdateRecord(updated, andWhatsApp, serialEntries)
        }
      />

      <WhatsAppDispatchModal
        isOpen={isWhatsAppOpen}
        onClose={() => setIsWhatsAppOpen(false)}
        record={currentRecord}
        columns={columns}
        teamMembers={teamMembers}
        tableElementId="battery-stock-sheet-table"
      />

      <TeamManagementModal
        isOpen={isTeamModalOpen}
        onClose={() => setIsTeamModalOpen(false)}
        teamMembers={teamMembers}
        onSaveTeam={async (updated) => {
          setTeamMembers(updated);
          saveTeamMembers(updated);
          await apiSaveTeam(updated);
          showToast('Team members saved to Cloud DBMS');
        }}
      />

      <CloudDatabaseSettingsModal
        isOpen={isCloudModalOpen}
        onClose={() => setIsCloudModalOpen(false)}
        onDataReload={syncWithCloudBackend}
      />

      <SerialTrackerModal
        isOpen={isSerialModalOpen}
        onClose={() => setIsSerialModalOpen(false)}
        serials={serials}
        columns={columns}
        onSaveSerial={async (item) => {
          const updated = { ...serials, [item.serialNo]: item };
          setSerials(updated);
          await apiSaveSerial(item);
          showToast(`Saved serial: ${item.serialNo}`);
        }}
      />

      <AssignSerialModal
        isOpen={assignModal.isOpen}
        onClose={() => setAssignModal((prev) => ({ ...prev, isOpen: false }))}
        modelId={assignModal.modelId}
        modelName={assignModal.modelName}
        currentStock={assignModal.currentStock}
        existingSerials={Object.values(serials).filter(
          (s) =>
            s.modelId === assignModal.modelId ||
            s.modelName === assignModal.modelName ||
            s.batchNo === assignModal.modelName
        )}
        activeDate={currentRecord.date}
        onSaveSerials={handleBulkSaveSerials}
        onUpdateSerial={handleUpdateSingleSerial}
      />

      {/* Direct Lifecycle History Timeline Modal from Top Search Bar */}
      {selectedSerialHistory && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 my-auto">
            <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-400 text-slate-950 flex items-center justify-center font-bold">
                  <Barcode className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Battery Serial: {selectedSerialHistory.serialNo}</h3>
                  <span className="text-[11px] text-slate-300">
                    Batch / Model: {selectedSerialHistory.modelName}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedSerialHistory(null)}
                className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[72vh] overflow-y-auto text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-slate-500 block text-[11px]">Current Status:</span>
                  <span className="font-bold text-sm capitalize text-slate-900">
                    {selectedSerialHistory.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block text-[11px]">Batch:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {selectedSerialHistory.modelName}
                  </span>
                </div>
              </div>

              {/* Inward Details */}
              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-1">
                <div className="flex items-center justify-between font-bold text-emerald-900">
                  <span>📥 Inward Date (Arrived in Stock)</span>
                  <span className="font-mono text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-200">
                    {selectedSerialHistory.inwardDate}
                  </span>
                </div>
                {selectedSerialHistory.inwardPartner && (
                  <div className="text-slate-700">
                    <strong>Brought By / Dealer Source:</strong> {selectedSerialHistory.inwardPartner}
                  </div>
                )}
                {selectedSerialHistory.inwardCause && (
                  <div className="text-slate-600 italic bg-white/70 p-1.5 rounded">
                    "{selectedSerialHistory.inwardCause}"
                  </div>
                )}
              </div>

              {/* Outward Details if dispatched */}
              {selectedSerialHistory.outwardDate ? (
                <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-lg space-y-1">
                  <div className="flex items-center justify-between font-bold text-rose-900">
                    <span>📤 Outward Date (Dispatched)</span>
                    <span className="font-mono text-rose-800 bg-white px-2 py-0.5 rounded border border-rose-200">
                      {selectedSerialHistory.outwardDate}
                    </span>
                  </div>
                  {selectedSerialHistory.outwardPartner && (
                    <div className="text-slate-700">
                      <strong>Customer Vehicle / Destination Dealer:</strong>{' '}
                      {selectedSerialHistory.outwardPartner}
                    </div>
                  )}
                  {selectedSerialHistory.outwardCause && (
                    <div className="text-slate-600 italic bg-white/70 p-1.5 rounded">
                      "{selectedSerialHistory.outwardCause}"
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 italic">
                  Battery has not been dispatched yet. It is currently in store inventory.
                </div>
              )}

              {/* Lifecycle Events Timeline */}
              {selectedSerialHistory.history && selectedSerialHistory.history.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <span className="font-bold text-slate-900 uppercase tracking-wider text-[11px] block">
                    Full Lifecycle Movement Timeline
                  </span>
                  {selectedSerialHistory.history.map((evt, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-700 space-y-0.5"
                    >
                      <div className="flex items-center justify-between font-bold text-slate-900">
                        <span className="capitalize">{evt.type.replace('_', ' ')}</span>
                        <span className="font-mono text-slate-500">{evt.date}</span>
                      </div>
                      <div>{evt.cause}</div>
                      {evt.partner && <div className="text-slate-500">Contact / Vehicle: {evt.partner}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-3.5 bg-slate-50 border-t border-slate-200">
              <button
                onClick={() => {
                  const item = selectedSerialHistory;
                  setSelectedSerialHistory(null);
                  setAssignModal({
                    isOpen: true,
                    modelId: item.modelId,
                    modelName: item.modelName,
                    currentStock: totals.closingStock[item.modelId] || 0,
                  });
                }}
                className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 cursor-pointer"
              >
                Edit / Update Serial
              </button>
              <button
                onClick={() => setSelectedSerialHistory(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

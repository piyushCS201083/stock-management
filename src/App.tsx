import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BatteryColumn,
  BatterySerialItem,
  DayRecord,
  TeamMember,
  INITIAL_RECORD_31_10_2026,
  BRANCHES,
  BranchInfo,
  StockCategoryId,
} from './types/stock';
import { BranchCategoryPortal } from './components/BranchCategoryPortal';
import { ChargerStockView } from './components/ChargerStockView';
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
import { BarcodeScannerModal } from './components/BarcodeScannerModal';
import { formatPhoneNumber, getWhatsAppUrl } from './utils/whatsapp';
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
  ShieldCheck,
  X,
  Building2,
  BatteryCharging,
  Zap,
  Boxes,
  ArrowRight,
} from 'lucide-react';

import {
  getIndianTodayDate,
  getIndianFullDateString,
  addDaysToDateString,
  toISODateString,
  fromISODateString,
  getIndianTodayISODate,
  isAfterTodayIST,
} from './utils/date';

// Helper to guarantee today's ledger exists with carried forward closing stock
function ensureTodayLedger(
  recordsMap: Record<string, DayRecord>,
  cols: BatteryColumn[]
): Record<string, DayRecord> {
  const today = getIndianTodayDate();
  if (recordsMap[today]) {
    return recordsMap;
  }

  const sortedDates = Object.keys(recordsMap).sort((a, b) => {
    return toISODateString(a).localeCompare(toISODateString(b));
  });

  const latestDate = sortedDates[sortedDates.length - 1];
  const baseRecord = recordsMap[latestDate] || INITIAL_RECORD_31_10_2026;

  const todayRecord = createNextDayRecord(baseRecord, cols);
  todayRecord.date = today;
  todayRecord.notes = `Auto-created for Today (${today}) carrying forward closing stock from ${baseRecord.date}`;

  const updated = { ...recordsMap, [today]: todayRecord };
  saveRecords(updated);
  apiSaveRecord(todayRecord).catch(() => {});
  return updated;
}

export default function App() {
  const [columns, setColumns] = useState<BatteryColumn[]>(() => loadColumns());
  const [records, setRecords] = useState<Record<string, DayRecord>>(() => {
    const loaded = loadRecords();
    const cols = loadColumns();
    return ensureTodayLedger(loaded, cols);
  });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => loadTeamMembers());
  const [serials, setSerials] = useState<Record<string, BatterySerialItem>>(() => loadLocalSerials());
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);

  // Current active date automatically defaults to today's date in Indian Standard Time (IST)
  const [currentDate, setCurrentDate] = useState<string>(() => getIndianTodayDate());

  // Active branch (1-Chandravadni Naka, 2-Morar, 3-Yard City Center, 4-Service Center)
  const [activeBranchId, setActiveBranchId] = useState<string>(() => {
    return localStorage.getItem('active_branch_id') || 'chandravadni_naka';
  });

  // Active stock category (battery, charger)
  const [activeCategory, setActiveCategory] = useState<StockCategoryId>(() => {
    return (localStorage.getItem('active_stock_category') as StockCategoryId) || 'battery';
  });

  // When opening the app, show the 4 branches selection portal
  const [isBranchPortalOpen, setIsBranchPortalOpen] = useState<boolean>(() => {
    const hasVisited = sessionStorage.getItem('has_selected_branch_session');
    return !hasVisited;
  });

  const activeBranch = useMemo(() => {
    return BRANCHES.find((b) => b.id === activeBranchId) || BRANCHES[0];
  }, [activeBranchId]);

  const handleSelectBranchAndCategory = (branchId: string, categoryId: StockCategoryId) => {
    setActiveBranchId(branchId);
    setActiveCategory(categoryId);
    localStorage.setItem('active_branch_id', branchId);
    localStorage.setItem('active_stock_category', categoryId);
    sessionStorage.setItem('has_selected_branch_session', 'true');
    setIsBranchPortalOpen(false);
    const branchName = BRANCHES.find((b) => b.id === branchId)?.name || branchId;
    showToast(`Opened ${branchName} · ${categoryId === 'battery' ? 'Battery Stock' : 'Charger Stock'}`);
  };

  // Modal states
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);
  const [isSerialModalOpen, setIsSerialModalOpen] = useState(false);
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState(false);
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

  const handleBarcodeScanComplete = (scannedSerial: string, detectedBatch?: string) => {
    const trimmed = scannedSerial.trim();
    if (!trimmed) return;
    try {
      navigator.clipboard.writeText(trimmed);
    } catch {}

    const found =
      serials[trimmed] ||
      Object.values(serials).find(
        (s) => s.serialNo.toLowerCase() === trimmed.toLowerCase()
      );

    if (found) {
      setSelectedSerialHistory(found);
      showToast(`✓ Found Battery: ${found.serialNo} (${found.modelName}) — Copied to clipboard!`);
    } else {
      showToast(`✓ Scanned Serial: ${trimmed} (Copied to clipboard)`);
    }
  };

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

      const activeCols = remoteCols && remoteCols.length > 0 ? remoteCols : columns;

      if (remoteRecords && Object.keys(remoteRecords).length > 0) {
        const withToday = ensureTodayLedger(remoteRecords, activeCols);
        setRecords(withToday);
      }
      if (remoteCols && remoteCols.length > 0) {
        setColumns(remoteCols);
      }
      if (remoteTeam && remoteTeam.length > 0) {
        const removedIds = ['luvkush', 'sonu_bhaiya', 'nikhil', 'reena_ent', 'store_staff'];
        const sanitized = remoteTeam
          .filter((m) => !removedIds.includes(m.id))
          .map((m) =>
            m.name.toLowerCase().includes('piyush') || m.id.includes('piyush')
              ? {
                  ...m,
                  id: 'piyush_shivhare',
                  name: 'Piyush Shivhare',
                  role: 'Owner & Admin',
                  phone: '9009156696',
                }
              : m
          );
        setTeamMembers(sanitized.length > 0 ? sanitized : loadTeamMembers());
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

  // Create next day entry carrying over today's closing stock (up to today in IST)
  const handleCreateNextDay = async () => {
    const nextDate = addDaysToDateString(currentRecord.date, 1);
    if (isAfterTodayIST(nextDate)) {
      showToast(`Cannot create ledger beyond today in IST (${getIndianTodayDate()})`);
      return;
    }
    const nextDayRecord = createNextDayRecord(currentRecord, columns);
    nextDayRecord.date = nextDate;
    const newRecords = { ...records, [nextDayRecord.date]: nextDayRecord };
    setRecords(newRecords);
    saveRecords(newRecords);
    setCurrentDate(nextDayRecord.date);
    await apiSaveRecord(nextDayRecord);
    showToast(`Created new ledger for ${nextDayRecord.date} with closing balance carried over!`);
  };

  // Switch to or create date record (strictly up to today in IST)
  const handleSelectOrCreateDate = async (targetDate: string) => {
    if (isAfterTodayIST(targetDate)) {
      showToast(`Cannot select future date beyond today in IST (${getIndianTodayDate()})`);
      return;
    }

    if (records[targetDate]) {
      setCurrentDate(targetDate);
      showToast(`Switched to ${targetDate} ledger`);
      return;
    }

    // Date does not exist yet: find the closest previous date to carry forward
    const sortedDates = Object.keys(records).sort((a, b) => {
      return toISODateString(a).localeCompare(toISODateString(b));
    });

    const priorDates = sortedDates.filter((d) => toISODateString(d) <= toISODateString(targetDate));
    const baseDate = priorDates.length > 0 ? priorDates[priorDates.length - 1] : sortedDates[0];
    const baseRecord = records[baseDate] || currentRecord;

    const newDayRecord = createNextDayRecord(baseRecord, columns);
    newDayRecord.date = targetDate;
    newDayRecord.notes = `Created for ${targetDate} carrying forward closing balance from ${baseRecord.date}`;

    const newRecords = { ...records, [targetDate]: newDayRecord };
    setRecords(newRecords);
    saveRecords(newRecords);
    setCurrentDate(targetDate);
    await apiSaveRecord(newDayRecord);
    showToast(`Created ${targetDate} ledger carrying forward closing balance!`);
  };

  // Today in Indian Standard Time (IST)
  const todayIST = getIndianTodayDate();
  const isViewingToday = currentDate === todayIST;

  // Chronologically sorted recorded dates
  const recordedDates = useMemo(() => {
    return Object.keys(records).sort((a, b) => {
      return toISODateString(a).localeCompare(toISODateString(b));
    });
  }, [records]);

  const currentIndex = recordedDates.indexOf(currentDate);

  // Periodically check if day rolled over in IST and keep today updated
  useEffect(() => {
    const checkDayRollover = () => {
      const liveToday = getIndianTodayDate();
      setRecords((prev) => {
        if (!prev[liveToday]) {
          const withToday = ensureTodayLedger(prev, columns);
          setCurrentDate(liveToday);
          return withToday;
        }
        return prev;
      });
    };

    const interval = setInterval(checkDayRollover, 30000);
    return () => clearInterval(interval);
  }, [columns]);

  const handlePrevDate = () => {
    if (currentIndex > 0) {
      setCurrentDate(recordedDates[currentIndex - 1]);
    }
  };

  const handleNextDate = () => {
    if (currentIndex < recordedDates.length - 1) {
      setCurrentDate(recordedDates[currentIndex + 1]);
    } else {
      const nextDate = addDaysToDateString(currentDate, 1);
      if (isAfterTodayIST(nextDate)) {
        showToast(`Already at today's active ledger (${todayIST})`);
        return;
      }
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
    if (records[todayIST]) {
      setCurrentDate(todayIST);
      showToast(`Switched to today's date in India: ${todayIST}`);
    } else {
      // Create today carrying forward from the latest record
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
        activeBranch={activeBranch}
        activeCategory={activeCategory}
        onOpenBranchPortal={() => setIsBranchPortalOpen(true)}
        onSelectCategory={(cat) => setActiveCategory(cat)}
      />

      {/* Branch & Category Navigation Bar */}
      <div className="bg-slate-900 text-white px-4 sm:px-6 py-2.5 border-b border-slate-800 shadow-xs flex items-center justify-between text-xs flex-wrap gap-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsBranchPortalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900/60 hover:bg-blue-800 border border-blue-500/40 text-blue-200 font-bold transition-all cursor-pointer shadow-2xs text-xs"
            title="Click to view all 4 branches: 1-Chandravadni Naka, 2-Morar, 3-Yard City Center, 4-Service Center"
          >
            <Building2 className="w-3.5 h-3.5 text-blue-400" />
            <span>{activeBranch.name}</span>
            <span className="text-[10px] bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded font-normal">
              Switch Branch (1-4)
            </span>
          </button>

          <span className="text-slate-600">/</span>

          {/* Quick Category Switcher */}
          <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
            <button
              onClick={() => setActiveCategory('battery')}
              className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 text-xs ${
                activeCategory === 'battery'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BatteryCharging className="w-3.5 h-3.5" />
              <span>Battery Stock</span>
            </button>
            <button
              onClick={() => setActiveCategory('charger')}
              className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 text-xs ${
                activeCategory === 'charger'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Charger Stock</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-400 hidden lg:inline">
            📍 {activeBranch.address}
          </span>
          <button
            onClick={() => setIsBranchPortalOpen(true)}
            className="text-xs text-blue-400 hover:text-blue-300 font-bold cursor-pointer flex items-center gap-1"
          >
            <span>All 4 Branches & Categories</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Content Viewport */}
      {isBranchPortalOpen ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 pb-20 md:pb-6">
          <BranchCategoryPortal
            currentBranchId={activeBranchId}
            currentCategoryId={activeCategory}
            onSelectBranchAndCategory={handleSelectBranchAndCategory}
            onClose={() => setIsBranchPortalOpen(false)}
            isModal={false}
          />
        </main>
      ) : activeCategory === 'charger' ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 pb-20 md:pb-6 space-y-6">
          <ChargerStockView
            branch={activeBranch}
            onSwitchStockCategory={(cat) => setActiveCategory(cat)}
            onOpenBranchPortal={() => setIsBranchPortalOpen(true)}
            activeDate={currentDate}
          />
        </main>
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 pb-20 md:pb-6 space-y-6">
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

        {/* Workspace Toolbar & Date Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Left: Date Switcher & Day Navigation & Cloud Status */}
            <div className="flex items-center gap-3 flex-wrap">
              <div
                className={`flex items-center rounded-lg p-1 transition-all ${
                  isViewingToday
                    ? 'bg-blue-50/90 border-2 border-blue-500 shadow-xs ring-2 ring-blue-500/20'
                    : 'bg-slate-50 border border-slate-300'
                }`}
              >
                <button
                  onClick={handlePrevDate}
                  disabled={currentIndex <= 0}
                  className="p-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-30 rounded hover:bg-slate-200 cursor-pointer"
                  title="Previous Date"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-2 px-3 py-1 font-bold text-slate-900 text-sm">
                  <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
                  <select
                    value={currentDate}
                    onChange={(e) => handleSelectOrCreateDate(e.target.value)}
                    className="bg-transparent font-bold text-slate-900 focus:outline-none cursor-pointer"
                  >
                    {recordedDates.map((d) => (
                      <option key={d} value={d}>
                        {d} {d === todayIST ? '★ (Today)' : d === '31-10-2026' ? '(Official Photo Baseline)' : ''}
                      </option>
                    ))}
                  </select>

                  {/* Auto-updating Today indicator badge */}
                  {isViewingToday ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-extrabold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>Today</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleJumpToTodayIST}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 transition-colors cursor-pointer"
                      title="Return to today's active ledger"
                    >
                      <span>Jump to Today</span>
                    </button>
                  )}

                  <input
                    type="date"
                    max={getIndianTodayISODate()}
                    value={toISODateString(currentDate)}
                    onChange={(e) => {
                      const iso = e.target.value;
                      if (!iso) return;
                      const target = fromISODateString(iso);
                      if (target) handleSelectOrCreateDate(target);
                    }}
                    title="Change date till today (IST)"
                    className="text-xs text-slate-600 border border-slate-300 rounded px-1.5 py-0.5 bg-white cursor-pointer focus:outline-blue-500"
                  />
                </div>

                <button
                  onClick={handleNextDate}
                  disabled={isViewingToday}
                  className="p-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-30 rounded hover:bg-slate-200 cursor-pointer"
                  title={isViewingToday ? "Already at today's active ledger" : "Next Date / Tomorrow"}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={handleJumpToTodayIST}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                  isViewingToday
                    ? 'text-emerald-900 bg-emerald-50 border-emerald-400 font-bold shadow-2xs'
                    : 'text-amber-900 bg-amber-50 hover:bg-amber-100 border-amber-300'
                }`}
                title="Jump to today's date in India Standard Time"
              >
                {isViewingToday && <span className="w-2 h-2 rounded-full bg-emerald-500"></span>}
                <span>Today ({todayIST})</span>
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
                onClick={() => setIsBarcodeScannerOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 border border-blue-700 rounded-lg shadow-xs transition-all cursor-pointer ring-2 ring-blue-500/20"
                title="Scan any barcode or QR code with high-speed camera scanner"
              >
                <Barcode className="w-4 h-4 text-white" />
                <span>Scan Barcode</span>
              </button>

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

          {/* Bottom Action & Dispatch Bar directly under Spreadsheet */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-100 gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-700">Daily Workflow:</span>
              <span>1. Direct cell edits or Log Transaction</span>
              <span>→</span>
              <span>2. Click "Send WhatsApp"</span>
              <span>→</span>
              <span>3. Send verified photo & report</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setIsQuickEntryOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                title="Open quick update dialog to log inward/outward changes"
              >
                <Plus className="w-4 h-4" />
                <span>Update Ledger</span>
              </button>

              <button
                onClick={() => setIsWhatsAppOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs cursor-pointer"
                title="Send verified sheet photo and summary to WhatsApp"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send WhatsApp</span>
              </button>
            </div>
          </div>
        </section>

        {/* Authorized Owner & Admin WhatsApp Dispatch Section */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Authorized Owner & Admin (WhatsApp Dispatch)</span>
              </h3>
              <p className="text-xs text-slate-500">
                Official stock ledger, verified Excel snapshots, and inward/outward alerts are routed directly to Owner & Admin.
              </p>
            </div>

            <button
              onClick={() => setIsTeamModalOpen(true)}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer self-start sm:self-auto"
            >
              Contact Settings
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {teamMembers.map((member) => (
              <div
                key={member.id}
                className="p-4 bg-gradient-to-br from-emerald-50/60 via-slate-50 to-white rounded-xl border border-emerald-200 text-xs flex flex-col justify-between shadow-xs hover:border-emerald-300 transition-all"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-base text-slate-900 tracking-tight">
                      {member.name}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                      <span>{member.role || 'Owner & Admin'}</span>
                    </span>
                  </div>
                  <div className="text-emerald-700 text-xs font-medium mt-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Primary Stock Administrator & Owner</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-emerald-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                      Verified WhatsApp Number
                    </span>
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {formatPhoneNumber(member.phone)}
                    </span>
                  </div>

                  <a
                    href={getWhatsAppUrl(
                      member.phone,
                      `Hi ${member.name}, here is the current battery stock register summary for ${currentRecord.date}: ${totals.closingStockTotal} units closing stock.`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Direct WhatsApp Chat</span>
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      )}

      {/* Mobile/Compact Persistent Sticky Action Bar - Always easily accessible when scrolling */}
      <div className="md:hidden fixed bottom-3 left-3 right-3 z-40 bg-white/95 backdrop-blur-md border border-slate-300 rounded-xl p-2 shadow-xl flex items-center justify-between gap-2.5">
        <button
          onClick={() => setIsQuickEntryOpen(true)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold text-blue-800 bg-blue-50 active:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4 text-blue-600" />
          <span>Update Ledger</span>
        </button>

        <button
          onClick={() => setIsWhatsAppOpen(true)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-extrabold text-white bg-emerald-600 active:bg-emerald-700 rounded-lg shadow-sm transition-colors cursor-pointer"
        >
          <Send className="w-4 h-4" />
          <span>Send WhatsApp</span>
        </button>
      </div>

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
        recordedDates={recordedDates}
        onSelectDate={handleSelectOrCreateDate}
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

      <BarcodeScannerModal
        isOpen={isBarcodeScannerOpen}
        onClose={() => setIsBarcodeScannerOpen(false)}
        onScanComplete={handleBarcodeScanComplete}
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

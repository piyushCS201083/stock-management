import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ALL_STOCK_CATEGORIES,
  BatteryColumn,
  BatterySerialItem,
  BranchAuthSession,
  BranchTransfer,
  BranchTransferItem,
  DayRecord,
  DEFAULT_BRANCH_ID,
  DEFAULT_VEHICLE_COLUMNS,
  BRANCHES,
  StockCategoryId,
  StockTransactionEntry,
  TeamMember,
  getBatteryRecordKey,
  parseBatteryRecordKey,
} from './types/stock';
import { BranchCategoryPortal } from './components/BranchCategoryPortal';
import { BranchLoginScreen } from './components/BranchLoginScreen';
import { VehicleStockView } from './components/VehicleStockView';
import { ReceiveGoodsBanner } from './components/ReceiveGoodsBanner';
import {
  ReceiveTransferModal,
  ReceiveTransferConfirmPayload,
} from './components/ReceiveTransferModal';
import {
  loadRecords,
  saveRecords,
  loadColumns,
  saveColumns,
  loadChargerRecords,
  saveChargerRecords,
  loadChargerColumns,
  saveChargerColumns,
  loadTeamMembers,
  saveTeamMembers,
  calculateRecordTotals,
  createNextDayRecord,
  createEmptyDayRecord,
  mergeRecordsByTimestamp,
  mergeSerialsByHistory,
  cascadeBranchOpeningStock,
  syncTodayOpeningFromLastEntry,
  getLocalResetEpoch,
  getLocalResetDateIST,
  clearAllLocalStockStorage,
  prunePreResetRecords,
  prunePreResetSerials,
} from './utils/storage';
import {
  apiFetchRecordsWithMeta,
  apiSaveRecordWithMeta,
  flushPendingRecordsToServer,
  getPendingSyncKeys,
  apiTriggerCloudinaryBackup,
  apiFetchColumns,
  apiSaveColumns,
  apiFetchTeam,
  apiSaveTeam,
  apiFetchSerials,
  apiSaveSerial,
  apiBulkSaveSerials,
  apiDeleteSerial,
  flushPendingSerialsToServer,
  getPendingSerialSyncKeys,
  loadLocalSerials,
  saveLocalSerials,
  apiFetchChargers,
  apiFetchChargerLedgersWithMeta,
  apiSaveChargerLedgerWithMeta,
  flushPendingChargerLedgersToServer,
  getPendingChargerSyncKeys,
  apiFetchChargerColumns,
  apiSaveChargerColumns,
  apiFetchChargerSerials,
  apiSaveChargerSerial,
  apiBulkSaveChargerSerials,
  apiDeleteChargerSerial,
  flushPendingChargerSerialsToServer,
  getPendingChargerSerialSyncKeys,
  saveLocalChargerSerials,
  apiFetchVehicles,
  apiSaveVehicleRecord,
  loadLocalVehicles,
  saveLocalVehicles,
  apiFetchTransfers,
  apiCreateTransfer,
  apiReceiveTransfers,
  saveLocalTransfers,
  checkBackendHealth,
  BackendStatus,
  AdminSessionInfo,
  subscribeRealtimeSync,
  apiBranchLogout,
  apiGetBranchSession,
  setApiBranchToken,
  setOnBranchUnauthorized,
} from './services/api';
import {
  exportRecordToExcel,
  exportSecondaryStockToExcel,
  exportSerialHistoryToExcel,
} from './utils/excelExport';
import { Header } from './components/Header';
import { ExcelGrid } from './components/ExcelGrid';
import {
  QuickEntryModal,
  QuickEntryType,
  SerialEntryPayload,
  BranchTransferDispatchPayload,
} from './components/QuickEntryModal';
import { WhatsAppDispatchModal } from './components/WhatsAppDispatchModal';
import { TeamManagementModal } from './components/TeamManagementModal';
import { CloudDatabaseSettingsModal } from './components/CloudDatabaseSettingsModal';
import { AdminPortalModal, AdminTabId } from './components/AdminPortalModal';
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
  PlusCircle,
  MinusCircle,
  ArrowLeftRight,
  Send,
  FileSpreadsheet,
  Download,
  CheckCircle,
  Database,
  Barcode,
  ShieldCheck,
  X,
  Building2,
  BatteryCharging,
  Zap,
  ArrowRight,
  BellRing,
  Cloud,
  Save,
  PackageCheck,
  Truck,
  Car,
  Lock,
} from 'lucide-react';

import {
  getIndianTodayDate,
  addDaysToDateString,
  toISODateString,
  fromISODateString,
  getIndianTodayISODate,
  isAfterTodayIST,
} from './utils/date';

// Extract clean date-keyed records for a specific branch
function extractBranchRecords(
  allRecords: Record<string, DayRecord>,
  branchId: string
): Record<string, DayRecord> {
  const result: Record<string, DayRecord> = {};
  Object.entries(allRecords).forEach(([key, rec]) => {
    const parsed = parseBatteryRecordKey(key);
    const recBranch = rec.branchId || parsed.branchId || DEFAULT_BRANCH_ID;
    if (recBranch === branchId) {
      const cleanDate = rec.date || parsed.date;
      result[cleanDate] = { ...rec, date: cleanDate, branchId: recBranch };
    }
  });
  return result;
}

// Helper to guarantee today's ledger exists for a branch and stays synced from the last stock entry
function ensureTodayLedger(
  recordsMap: Record<string, DayRecord>,
  cols: BatteryColumn[],
  persistToCloud = false,
  branchId: string = DEFAULT_BRANCH_ID,
  saveLocalFn: (map: Record<string, DayRecord>) => void = saveRecords,
  apiSaveFn: (rec: DayRecord) => Promise<any> = apiSaveRecordWithMeta
): Record<string, DayRecord> {
  const today = getIndianTodayDate();
  const todayKey = getBatteryRecordKey(branchId, today);
  if (recordsMap[todayKey]) {
    const { updatedMap, syncedRecord } = syncTodayOpeningFromLastEntry(
      recordsMap,
      branchId,
      today,
      cols
    );
    if (syncedRecord && persistToCloud && !syncedRecord.isAutoGenerated) {
      saveLocalFn(updatedMap);
      apiSaveFn(syncedRecord).catch(() => {});
    }
    return updatedMap;
  }

  const branchOnly = extractBranchRecords(recordsMap, branchId);
  const sortedDates = Object.keys(branchOnly).sort((a, b) => {
    return toISODateString(a).localeCompare(toISODateString(b));
  });

  const isStub = !persistToCloud;
  let todayRecord: DayRecord;
  if (sortedDates.length > 0) {
    const latestDate = sortedDates[sortedDates.length - 1];
    const baseRecord = branchOnly[latestDate];
    todayRecord = createNextDayRecord(baseRecord, cols, { isAutoGenerated: isStub });
    todayRecord.date = today;
    todayRecord.branchId = branchId;
    todayRecord.notes = `Auto-created for Today (${today}) carrying forward closing stock from ${baseRecord.date}`;
  } else {
    todayRecord = createEmptyDayRecord(today, cols, branchId, { isAutoGenerated: isStub });
  }

  const updated = { ...recordsMap, [todayKey]: todayRecord };
  if (persistToCloud) {
    saveLocalFn(updated);
    apiSaveFn(todayRecord).catch(() => {});
  }
  return updated;
}

export default function App() {
  // Strictly in-memory Branch / Master session (never stored in localStorage)
  const [branchToken, setBranchToken] = useState<string | null>(null);
  const [branchSession, setBranchSession] = useState<BranchAuthSession | null>(null);
  const [branchAuthNotice, setBranchAuthNotice] = useState<string | null>(null);
  const branchSessionRef = useRef<BranchAuthSession | null>(branchSession);
  const branchTokenRef = useRef<string | null>(branchToken);

  useEffect(() => {
    branchSessionRef.current = branchSession;
  }, [branchSession]);

  useEffect(() => {
    branchTokenRef.current = branchToken;
    setApiBranchToken(branchToken);
  }, [branchToken]);

  const isMasterSession = branchSession?.role === 'master';
  const allowedBranchIds = branchSession?.allowedBranchIds || [];
  const allowedCategories = useMemo<StockCategoryId[]>(() => {
    if (!branchSession || isMasterSession) return ALL_STOCK_CATEGORIES;
    return branchSession.allowedCategories && branchSession.allowedCategories.length > 0
      ? branchSession.allowedCategories
      : ALL_STOCK_CATEGORIES;
  }, [branchSession, isMasterSession]);

  const [columns, setColumns] = useState<BatteryColumn[]>(() => loadColumns());
  const [chargerColumns, setChargerColumns] = useState<BatteryColumn[]>(() => loadChargerColumns());
  const [activeBranchId, setActiveBranchId] = useState<string>(DEFAULT_BRANCH_ID);
  const [records, setRecords] = useState<Record<string, DayRecord>>({});
  const [chargerLedgers, setChargerLedgers] = useState<Record<string, DayRecord>>({});
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => loadTeamMembers());
  const [serials, setSerials] = useState<Record<string, BatterySerialItem>>({});
  const [chargerSerials, setChargerSerials] = useState<Record<string, BatterySerialItem>>({});
  const [chargerRecords, setChargerRecords] = useState<Record<string, any>>({});
  const [vehicleRecords, setVehicleRecords] = useState<Record<string, any>>({});
  const [transfers, setTransfers] = useState<BranchTransfer[]>([]);
  const [isReceivingGoods, setIsReceivingGoods] = useState<boolean>(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const isCloudDbConnected = Boolean(backendStatus?.supabaseReady || backendStatus?.hasPostgresUrl);

  // Current active date automatically defaults to today's date in Indian Standard Time (IST)
  const [currentDate, setCurrentDate] = useState<string>(() => getIndianTodayDate());

  // Active stock category (battery, charger, vehicle)
  const [activeCategory, setActiveCategory] = useState<StockCategoryId>(() => {
    return (localStorage.getItem('active_stock_category') as StockCategoryId) || 'battery';
  });
  const activeCategoryRef = useRef<StockCategoryId>(activeCategory);
  useEffect(() => {
    activeCategoryRef.current = activeCategory;
  }, [activeCategory]);

  // Master login shows the 5-branch portal until selected; single-branch login opens directly into that branch
  const [isBranchPortalOpen, setIsBranchPortalOpen] = useState<boolean>(false);

  const activeBranch = useMemo(() => {
    return BRANCHES.find((b) => b.id === activeBranchId) || BRANCHES[0];
  }, [activeBranchId]);

  const activeBranchRef = useRef(activeBranchId);
  useEffect(() => {
    activeBranchRef.current = activeBranchId;
  }, [activeBranchId]);

  const handleBranchAuthenticated = (token: string, session: BranchAuthSession) => {
    // Isolate local browser caches so zero records from another branch remain on this device
    clearAllLocalStockStorage();
    inFlightRecordKeysRef.current.clear();
    inFlightSerialKeysRef.current.clear();
    inFlightChargerRecordKeysRef.current.clear();
    inFlightChargerSerialKeysRef.current.clear();
    hasCompletedInitialSyncRef.current = false;

    setApiBranchToken(token);
    branchTokenRef.current = token;
    branchSessionRef.current = session;
    setBranchAuthNotice(null);
    setBranchToken(token);
    setBranchSession(session);

    const targetBranch =
      session.role === 'branch' && session.branchId
        ? session.branchId
        : session.allowedBranchIds.includes(localStorage.getItem('active_branch_id') || '')
        ? (localStorage.getItem('active_branch_id') as string)
        : DEFAULT_BRANCH_ID;

    const sessionCats: StockCategoryId[] =
      session.role === 'master'
        ? ALL_STOCK_CATEGORIES
        : session.allowedCategories && session.allowedCategories.length > 0
        ? session.allowedCategories
        : ALL_STOCK_CATEGORIES;
    const savedCategory = localStorage.getItem('active_stock_category') as StockCategoryId | null;
    const targetCategory: StockCategoryId =
      savedCategory && sessionCats.includes(savedCategory)
        ? savedCategory
        : sessionCats[0] || 'battery';

    setActiveBranchId(targetBranch);
    setActiveCategory(targetCategory);
    localStorage.setItem('active_branch_id', targetBranch);
    localStorage.setItem('active_stock_category', targetCategory);
    const cols = loadColumns();
    const chCols = loadChargerColumns();
    setColumns(cols);
    setChargerColumns(chCols);
    setRecords(
      sessionCats.includes('battery')
        ? ensureTodayLedger({}, cols, false, targetBranch, saveRecords, apiSaveRecordWithMeta)
        : {}
    );
    setChargerLedgers(
      sessionCats.includes('charger')
        ? ensureTodayLedger(
            {},
            chCols,
            false,
            targetBranch,
            saveChargerRecords,
            apiSaveChargerLedgerWithMeta
          )
        : {}
    );
    setSerials({});
    setChargerSerials({});
    setChargerRecords({});
    setVehicleRecords({});
    setTransfers([]);
    setCurrentDate(getIndianTodayDate());

    if (session.role === 'master') {
      const hasVisited = sessionStorage.getItem('has_selected_branch_session');
      setIsBranchPortalOpen(!hasVisited);
    } else {
      setIsBranchPortalOpen(false);
    }
  };

  useEffect(() => {
    if (!branchSession) return;
    if (!allowedCategories.includes(activeCategory)) {
      const fallback = allowedCategories[0] || 'battery';
      setActiveCategory(fallback);
      localStorage.setItem('active_stock_category', fallback);
    }
  }, [branchSession, allowedCategories, activeCategory]);

  const handleBranchLogout = (notice?: string) => {
    const tokenToRevoke = branchTokenRef.current;
    if (tokenToRevoke) {
      apiBranchLogout(tokenToRevoke);
    }
    setApiBranchToken(null);
    branchTokenRef.current = null;
    branchSessionRef.current = null;
    clearAllLocalStockStorage();
    inFlightRecordKeysRef.current.clear();
    inFlightSerialKeysRef.current.clear();
    inFlightChargerRecordKeysRef.current.clear();
    inFlightChargerSerialKeysRef.current.clear();
    hasCompletedInitialSyncRef.current = false;

    setBranchToken(null);
    setBranchSession(null);
    setBranchAuthNotice(notice || null);
    setRecords({});
    setChargerLedgers({});
    setSerials({});
    setChargerSerials({});
    setChargerRecords({});
    setVehicleRecords({});
    setTransfers([]);
    setIsBranchPortalOpen(false);
  };

  useEffect(() => {
    setOnBranchUnauthorized(() => {
      handleBranchLogout(
        'Your branch session expired or the password was changed by Admin. Please sign in again.'
      );
    });
    return () => {
      setOnBranchUnauthorized(null);
    };
  }, []);

  const isChargerMode = activeCategory === 'charger';
  const activeLedgerCategory: 'battery' | 'charger' = isChargerMode ? 'charger' : 'battery';

  const pendingTransfersByBranch = useMemo(() => {
    const counts: Record<string, number> = {};
    transfers
      .filter(
        (t) =>
          t.status !== 'received' &&
          allowedCategories.includes((t.category || 'battery') as StockCategoryId)
      )
      .forEach((t) => {
        const unreceivedCount = (t.items || []).filter((it) => !it.received).length;
        if (unreceivedCount > 0) {
          counts[t.toBranchId] = (counts[t.toBranchId] || 0) + unreceivedCount;
        }
      });
    return counts;
  }, [transfers, allowedCategories]);

  const activeCategoryTransfers = useMemo(() => {
    return transfers.filter((t) => (t.category || 'battery') === activeLedgerCategory);
  }, [transfers, activeLedgerCategory]);

  const pendingIncomingForActiveBranch = useMemo(() => {
    const list: Array<{ transfer: BranchTransfer; item: BranchTransferItem }> = [];
    activeCategoryTransfers
      .filter((t) => t.toBranchId === activeBranchId && t.status !== 'received')
      .forEach((trf) => {
        (trf.items || []).forEach((item) => {
          if (!item.received) {
            list.push({ transfer: trf, item });
          }
        });
      });
    return list;
  }, [activeCategoryTransfers, activeBranchId]);

  const pendingIncomingSummary = useMemo(() => {
    if (pendingIncomingForActiveBranch.length === 0) {
      return { totalUnits: 0, headline: '' };
    }
    const bySender = new Map<string, { senderName: string; totalUnits: number; labels: string[] }>();
    let totalUnits = 0;
    pendingIncomingForActiveBranch.forEach(({ transfer, item }) => {
      const qty = item.quantity || 1;
      totalUnits += qty;
      const cur = bySender.get(transfer.fromBranchId) || {
        senderName: transfer.fromBranchName,
        totalUnits: 0,
        labels: [],
      };
      cur.totalUnits += qty;
      cur.labels.push(`${qty}× ${item.modelName}`);
      bySender.set(transfer.fromBranchId, cur);
    });
    const headline = Array.from(bySender.values())
      .map((s) => {
        const unitWord = isChargerMode
          ? s.totalUnits === 1
            ? 'charger'
            : 'chargers'
          : s.totalUnits === 1
          ? 'battery'
          : 'batteries';
        return `${s.senderName} sent you ${s.totalUnits} ${unitWord} (${s.labels.join(', ')})`;
      })
      .join(' · ');
    return { totalUnits, headline };
  }, [pendingIncomingForActiveBranch, isChargerMode]);

  const pendingPopupSignature = useMemo(() => {
    if (pendingIncomingForActiveBranch.length === 0) return '';
    return `${activeBranchId}::${activeLedgerCategory}::${pendingIncomingForActiveBranch
      .map((p) => `${p.transfer.id}:${p.item.id}`)
      .join('|')}`;
  }, [activeBranchId, activeLedgerCategory, pendingIncomingForActiveBranch]);

  const [dismissedPopupSignature, setDismissedPopupSignature] = useState<string | null>(null);
  const [receiveModalState, setReceiveModalState] = useState<{
    isOpen: boolean;
    items: Array<{ transfer: BranchTransfer; item: BranchTransferItem }>;
  }>({
    isOpen: false,
    items: [],
  });

  const handleSelectCategory = (categoryId: StockCategoryId) => {
    const session = branchSessionRef.current;
    const sessionCats: StockCategoryId[] =
      !session || session.role === 'master'
        ? ALL_STOCK_CATEGORIES
        : session.allowedCategories && session.allowedCategories.length > 0
        ? session.allowedCategories
        : ALL_STOCK_CATEGORIES;
    if (!sessionCats.includes(categoryId)) {
      showToast('Access restricted: your login ID does not have permission for that stock register.');
      return;
    }
    setActiveCategory(categoryId);
    localStorage.setItem('active_stock_category', categoryId);
  };

  const handleSelectBranchAndCategory = (branchId: string, categoryId: StockCategoryId) => {
    const session = branchSessionRef.current;
    if (session && session.role === 'branch' && !session.allowedBranchIds.includes(branchId)) {
      showToast('Access restricted: your login ID can only open your assigned branch.');
      return;
    }
    const sessionCats: StockCategoryId[] =
      !session || session.role === 'master'
        ? ALL_STOCK_CATEGORIES
        : session.allowedCategories && session.allowedCategories.length > 0
        ? session.allowedCategories
        : ALL_STOCK_CATEGORIES;
    if (!sessionCats.includes(categoryId)) {
      showToast('Access restricted: your login ID does not have permission for that stock register.');
      return;
    }
    setActiveBranchId(branchId);
    setActiveCategory(categoryId);
    localStorage.setItem('active_branch_id', branchId);
    localStorage.setItem('active_stock_category', categoryId);
    sessionStorage.setItem('has_selected_branch_session', 'true');
    setIsBranchPortalOpen(false);
    setDismissedPopupSignature(null);
    if (sessionCats.includes('battery')) {
      setRecords((prev) =>
        ensureTodayLedger(prev, columns, isCloudDbConnected, branchId, saveRecords, apiSaveRecordWithMeta)
      );
    }
    if (sessionCats.includes('charger')) {
      setChargerLedgers((prev) =>
        ensureTodayLedger(
          prev,
          chargerColumns,
          isCloudDbConnected,
          branchId,
          saveChargerRecords,
          apiSaveChargerLedgerWithMeta
        )
      );
    }
    const branchName = BRANCHES.find((b) => b.id === branchId)?.name || branchId;
    const pendingCount =
      sessionCats.includes('battery') || sessionCats.includes('charger')
        ? pendingTransfersByBranch[branchId] || 0
        : 0;
    if (pendingCount > 0) {
      showToast(`Opened ${branchName} — ${pendingCount} incoming stock item(s) ready to receive!`);
    } else {
      const catLabel =
        categoryId === 'battery'
          ? 'Battery Stock'
          : categoryId === 'charger'
          ? 'Charger Stock'
          : 'Vehicle Stock';
      showToast(`Opened ${branchName} · ${catLabel}`);
    }
  };

  // Modal states
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [quickEntryInitialType, setQuickEntryInitialType] = useState<QuickEntryType>('in');
  const openQuickEntryWithType = (type: QuickEntryType) => {
    setQuickEntryInitialType(type);
    setIsQuickEntryOpen(true);
  };
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);
  const [isSerialModalOpen, setIsSerialModalOpen] = useState(false);
  const [serialModalInitialFilter, setSerialModalInitialFilter] = useState<
    'all' | 'in_stock' | 'dispatched' | 'in_repair' | 'service_standby'
  >('all');
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState(false);
  const [assignModal, setAssignModal] = useState<{
    isOpen: boolean;
    modelId: string;
    modelName: string;
    currentStock: number;
    initialTab?: 'assign_missing' | 'manage_existing';
  }>({
    isOpen: false,
    modelId: '',
    modelName: '',
    currentStock: 0,
  });
  const [selectedSerialHistory, setSelectedSerialHistory] = useState<BatterySerialItem | null>(null);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);

  // Admin Session & Portal state (token kept strictly in React memory)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminSession, setAdminSession] = useState<AdminSessionInfo | null>(null);
  const [isAdminPortalOpen, setIsAdminPortalOpen] = useState(false);
  const [adminPromptReason, setAdminPromptReason] = useState<string | null>(null);
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTabId>('analytics');
  const pendingAdminCallbackRef = useRef<((token: string) => void) | null>(null);

  const openAdminPortal = (
    reason: string | null = null,
    tab: AdminTabId = 'analytics',
    onAuthorized?: (token: string) => void
  ) => {
    setAdminPromptReason(reason);
    setAdminInitialTab(tab);
    pendingAdminCallbackRef.current = onAuthorized || null;
    setIsAdminPortalOpen(true);
  };

  const requireAdminAction = (
    reason: string,
    tab: AdminTabId,
    onAuthorized: (token: string) => void
  ) => {
    if (adminToken) {
      onAuthorized(adminToken);
      return;
    }
    openAdminPortal(reason, tab, onAuthorized);
  };

  const handleBarcodeScanComplete = (scannedSerial: string, detectedBatch?: string) => {
    const trimmed = scannedSerial.trim();
    if (!trimmed) return;
    try {
      navigator.clipboard.writeText(trimmed);
    } catch {}

    const activeSerialSource =
      activeCategoryRef.current === 'charger' ? chargerSerialsRef.current : serialsRef.current;
    const found =
      activeSerialSource[trimmed] ||
      Object.values(activeSerialSource).find(
        (s) => s.serialNo.toLowerCase() === trimmed.toLowerCase()
      );

    const entityLabel = activeCategoryRef.current === 'charger' ? 'Charger' : 'Battery';
    if (found) {
      setSelectedSerialHistory(found);
      showToast(`✓ Found ${entityLabel}: ${found.serialNo} (${found.modelName}) — Copied to clipboard!`);
    } else {
      showToast(`✓ Scanned Serial: ${trimmed} (Copied to clipboard)`);
    }
  };

  const tableRef = useRef<HTMLDivElement>(null);

  const [isRealtimeActive, setIsRealtimeActive] = useState<boolean>(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'pending' | 'error'>('saved');
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(
    () => getPendingSyncKeys().length + getPendingChargerSyncKeys().length
  );
  const [isCloudSpaceBackingUp, setIsCloudSpaceBackingUp] = useState<boolean>(false);

  const isSyncingRef = useRef(false);
  const hasCompletedInitialSyncRef = useRef(false);
  const inFlightRecordKeysRef = useRef<Set<string>>(new Set());
  const inFlightSerialKeysRef = useRef<Set<string>>(new Set());
  const lastColumnMutationAtRef = useRef<number>(0);
  const recordsRef = useRef(records);
  const columnsRef = useRef(columns);
  const serialsRef = useRef(serials);

  const inFlightChargerRecordKeysRef = useRef<Set<string>>(new Set());
  const inFlightChargerSerialKeysRef = useRef<Set<string>>(new Set());
  const lastChargerColumnMutationAtRef = useRef<number>(0);
  const chargerLedgersRef = useRef(chargerLedgers);
  const chargerColumnsRef = useRef(chargerColumns);
  const chargerSerialsRef = useRef(chargerSerials);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  useEffect(() => {
    serialsRef.current = serials;
  }, [serials]);

  useEffect(() => {
    chargerLedgersRef.current = chargerLedgers;
  }, [chargerLedgers]);

  useEffect(() => {
    chargerColumnsRef.current = chargerColumns;
  }, [chargerColumns]);

  useEffect(() => {
    chargerSerialsRef.current = chargerSerials;
  }, [chargerSerials]);

  // Sync data from Cloud DBMS / backend safely without overwriting local/in-flight edits
  const syncWithCloudBackend = async (forceReplace = false) => {
    if (!branchTokenRef.current) return;
    if (isSyncingRef.current && !forceReplace) return;
    isSyncingRef.current = true;
    try {
      const initialEpochBeforeSync = getLocalResetEpoch();
      const health = await checkBackendHealth();
      setBackendStatus(health);

      // If the server was factory reset since this browser last synced (or browser has never completed an authoritative sync),
      // wipe stale local cache and treat cloud state as authoritative so pre-reset stock ("11") can never resurrect.
      const healthEpochChanged =
        forceReplace ||
        Boolean(health.online && health.resetEpoch && initialEpochBeforeSync !== health.resetEpoch) ||
        Boolean(health.online && !initialEpochBeforeSync && !hasCompletedInitialSyncRef.current);

      if (healthEpochChanged && health.resetEpoch) {
        clearAllLocalStockStorage(health.resetEpoch, health.resetDateIST);
        inFlightRecordKeysRef.current.clear();
        inFlightSerialKeysRef.current.clear();
        inFlightChargerRecordKeysRef.current.clear();
        inFlightChargerSerialKeysRef.current.clear();
      } else if (!healthEpochChanged && (initialEpochBeforeSync || hasCompletedInitialSyncRef.current)) {
        if (getPendingSyncKeys().length > 0) {
          // Push any queued offline/failed local record edits up to the server first
          await flushPendingRecordsToServer(
            prunePreResetRecords(recordsRef.current, health.resetEpoch || initialEpochBeforeSync, health.resetDateIST || getLocalResetDateIST())
          );
        }
        if (getPendingSerialSyncKeys().length > 0) {
          await flushPendingSerialsToServer(
            prunePreResetSerials(serialsRef.current, health.resetEpoch || initialEpochBeforeSync, health.resetDateIST || getLocalResetDateIST())
          );
        }
        if (getPendingChargerSyncKeys().length > 0) {
          await flushPendingChargerLedgersToServer(
            prunePreResetRecords(chargerLedgersRef.current, health.resetEpoch || initialEpochBeforeSync, health.resetDateIST || getLocalResetDateIST())
          );
        }
        if (getPendingChargerSerialSyncKeys().length > 0) {
          await flushPendingChargerSerialsToServer(
            prunePreResetSerials(chargerSerialsRef.current, health.resetEpoch || initialEpochBeforeSync, health.resetDateIST || getLocalResetDateIST())
          );
        }
      }

      const protectedKeys = healthEpochChanged
        ? new Set<string>()
        : new Set<string>([
            ...getPendingSyncKeys(),
            ...Array.from(inFlightRecordKeysRef.current),
          ]);

      const protectedSerialKeys = healthEpochChanged
        ? new Set<string>()
        : new Set<string>([
            ...getPendingSerialSyncKeys(),
            ...Array.from(inFlightSerialKeysRef.current),
          ]);

      const protectedChargerKeys = healthEpochChanged
        ? new Set<string>()
        : new Set<string>([
            ...getPendingChargerSyncKeys(),
            ...Array.from(inFlightChargerRecordKeysRef.current),
          ]);

      const protectedChargerSerialKeys = healthEpochChanged
        ? new Set<string>()
        : new Set<string>([
            ...getPendingChargerSerialSyncKeys(),
            ...Array.from(inFlightChargerSerialKeysRef.current),
          ]);

      const sessionCats: StockCategoryId[] =
        !branchSessionRef.current || branchSessionRef.current.role === 'master'
          ? ALL_STOCK_CATEGORIES
          : branchSessionRef.current.allowedCategories &&
            branchSessionRef.current.allowedCategories.length > 0
          ? branchSessionRef.current.allowedCategories
          : ALL_STOCK_CATEGORIES;
      const canBattery = sessionCats.includes('battery');
      const canCharger = sessionCats.includes('charger');
      const canVehicle = sessionCats.includes('vehicle');

      const [
        recordsMeta,
        remoteCols,
        remoteTeam,
        remoteSerials,
        remoteChargers,
        remoteVehicles,
        remoteTransfers,
        chargerLedgersMeta,
        remoteChargerCols,
        remoteChargerSerials,
      ] = await Promise.all([
        canBattery
          ? apiFetchRecordsWithMeta(protectedKeys)
          : Promise.resolve({
              records: {},
              resetEpoch: health.resetEpoch || initialEpochBeforeSync || undefined,
              resetDateIST: health.resetDateIST || getLocalResetDateIST() || undefined,
              epochResetTriggered: false,
              fromRemote: true,
            }),
        apiFetchColumns(),
        apiFetchTeam(),
        canBattery ? apiFetchSerials(protectedSerialKeys) : Promise.resolve({}),
        canCharger ? apiFetchChargers() : Promise.resolve({}),
        canVehicle ? apiFetchVehicles() : Promise.resolve({}),
        canBattery || canCharger ? apiFetchTransfers() : Promise.resolve([]),
        canCharger
          ? apiFetchChargerLedgersWithMeta(protectedChargerKeys)
          : Promise.resolve({
              records: {},
              resetEpoch: health.resetEpoch || initialEpochBeforeSync || undefined,
              resetDateIST: health.resetDateIST || getLocalResetDateIST() || undefined,
              epochResetTriggered: false,
              fromRemote: true,
            }),
        canCharger ? apiFetchChargerColumns() : Promise.resolve([]),
        canCharger ? apiFetchChargerSerials(protectedChargerSerialKeys) : Promise.resolve({}),
      ]);

      const remoteRecords = recordsMeta.records;
      const remoteChargerLedgers = chargerLedgersMeta.records;
      const effectiveEpoch =
        health.resetEpoch ||
        recordsMeta.resetEpoch ||
        chargerLedgersMeta.resetEpoch ||
        getLocalResetEpoch();
      const effectiveDateIST =
        health.resetDateIST ||
        recordsMeta.resetDateIST ||
        chargerLedgersMeta.resetDateIST ||
        getLocalResetDateIST();
      const epochChanged =
        healthEpochChanged ||
        recordsMeta.epochResetTriggered ||
        chargerLedgersMeta.epochResetTriggered ||
        Boolean(recordsMeta.resetEpoch && initialEpochBeforeSync !== recordsMeta.resetEpoch) ||
        Boolean(chargerLedgersMeta.resetEpoch && initialEpochBeforeSync !== chargerLedgersMeta.resetEpoch);

      if (health.online || recordsMeta.fromRemote || chargerLedgersMeta.fromRemote) {
        hasCompletedInitialSyncRef.current = true;
      }

      const activeCols = remoteCols && remoteCols.length > 0 ? remoteCols : columnsRef.current;
      const activeChargerCols =
        remoteChargerCols && remoteChargerCols.length > 0
          ? remoteChargerCols
          : chargerColumnsRef.current;

      if (epochChanged) {
        if (effectiveEpoch) {
          clearAllLocalStockStorage(effectiveEpoch, effectiveDateIST || undefined);
        }
        inFlightRecordKeysRef.current.clear();
        inFlightSerialKeysRef.current.clear();
        inFlightChargerRecordKeysRef.current.clear();
        inFlightChargerSerialKeysRef.current.clear();

        const cleanWithToday = canBattery
          ? ensureTodayLedger(
              remoteRecords || {},
              activeCols,
              health.online,
              activeBranchRef.current,
              saveRecords,
              apiSaveRecordWithMeta
            )
          : {};
        saveRecords(cleanWithToday);
        setRecords(cleanWithToday);
        setColumns(activeCols);

        const cleanChargerWithToday = canCharger
          ? ensureTodayLedger(
              remoteChargerLedgers || {},
              activeChargerCols,
              health.online,
              activeBranchRef.current,
              saveChargerRecords,
              apiSaveChargerLedgerWithMeta
            )
          : {};
        saveChargerRecords(cleanChargerWithToday);
        setChargerLedgers(cleanChargerWithToday);
        setChargerColumns(activeChargerCols);

        setTeamMembers(remoteTeam && remoteTeam.length > 0 ? remoteTeam : loadTeamMembers());
        setSerials(remoteSerials || {});
        saveLocalSerials(remoteSerials || {});
        setChargerSerials(remoteChargerSerials || {});
        saveLocalChargerSerials(remoteChargerSerials || {});
        setChargerRecords(remoteChargers || {});
        setVehicleRecords(remoteVehicles || {});
        saveLocalVehicles(remoteVehicles || {});
        setTransfers(Array.isArray(remoteTransfers) ? remoteTransfers : []);
        saveLocalTransfers(Array.isArray(remoteTransfers) ? remoteTransfers : []);
        setSelectedSerialHistory(null);
        setAssignModal((prev) => ({ ...prev, isOpen: false }));
        setReceiveModalState({ isOpen: false, items: [] });
        setCurrentDate(getIndianTodayDate());
        setPendingSyncCount(0);
        setSaveState('saved');
        if (health.online) setIsRealtimeActive(true);
        return;
      }

      if (canBattery && remoteRecords && (Object.keys(remoteRecords).length > 0 || Object.keys(recordsRef.current).length > 0)) {
        const latestProtected = new Set<string>([
          ...getPendingSyncKeys(),
          ...Array.from(inFlightRecordKeysRef.current),
        ]);
        const prunedCurrent = prunePreResetRecords(
          recordsRef.current,
          effectiveEpoch,
          effectiveDateIST
        );
        const { merged, localNewerKeys } = mergeRecordsByTimestamp(
          prunedCurrent,
          remoteRecords,
          latestProtected
        );
        const withToday = ensureTodayLedger(
          merged,
          activeCols,
          health.online,
          activeBranchRef.current,
          saveRecords,
          apiSaveRecordWithMeta
        );
        saveRecords(withToday);
        setRecords(withToday);

        if (localNewerKeys.length > 0 && health.online) {
          flushPendingRecordsToServer(withToday, localNewerKeys)
            .then(() =>
              setPendingSyncCount(getPendingSyncKeys().length + getPendingChargerSyncKeys().length)
            )
            .catch(() => {});
        }
      }
      if (canCharger && remoteChargerLedgers && (Object.keys(remoteChargerLedgers).length > 0 || Object.keys(chargerLedgersRef.current).length > 0)) {
        const latestProtectedCharger = new Set<string>([
          ...getPendingChargerSyncKeys(),
          ...Array.from(inFlightChargerRecordKeysRef.current),
        ]);
        const prunedCurrentCharger = prunePreResetRecords(
          chargerLedgersRef.current,
          effectiveEpoch,
          effectiveDateIST
        );
        const { merged: mergedChargers, localNewerKeys: localNewerChargerKeys } =
          mergeRecordsByTimestamp(prunedCurrentCharger, remoteChargerLedgers, latestProtectedCharger);
        const withTodayCharger = ensureTodayLedger(
          mergedChargers,
          activeChargerCols,
          health.online,
          activeBranchRef.current,
          saveChargerRecords,
          apiSaveChargerLedgerWithMeta
        );
        saveChargerRecords(withTodayCharger);
        setChargerLedgers(withTodayCharger);

        if (localNewerChargerKeys.length > 0 && health.online) {
          flushPendingChargerLedgersToServer(withTodayCharger, localNewerChargerKeys)
            .then(() =>
              setPendingSyncCount(getPendingSyncKeys().length + getPendingChargerSyncKeys().length)
            )
            .catch(() => {});
        }
      }
      if (remoteCols && remoteCols.length > 0 && Date.now() - lastColumnMutationAtRef.current > 8000) {
        setColumns(remoteCols);
      }
      if (
        canCharger &&
        remoteChargerCols &&
        remoteChargerCols.length > 0 &&
        Date.now() - lastChargerColumnMutationAtRef.current > 8000
      ) {
        setChargerColumns(remoteChargerCols);
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
      if (canBattery && remoteSerials && (Object.keys(remoteSerials).length > 0 || Object.keys(serialsRef.current).length > 0)) {
        const latestProtectedSerials = new Set<string>([
          ...getPendingSerialSyncKeys(),
          ...Array.from(inFlightSerialKeysRef.current),
        ]);
        const prunedSerials = prunePreResetSerials(
          serialsRef.current,
          effectiveEpoch,
          effectiveDateIST
        );
        const { merged: mergedSerials, localNewerSerials } = mergeSerialsByHistory(
          prunedSerials,
          remoteSerials,
          latestProtectedSerials
        );
        saveLocalSerials(mergedSerials);
        setSerials(mergedSerials);
        if (localNewerSerials.length > 0 && health.online) {
          flushPendingSerialsToServer(
            mergedSerials,
            localNewerSerials.map((s) => s.serialNo)
          ).catch(() => {});
        }
      }
      if (canCharger && remoteChargerSerials && (Object.keys(remoteChargerSerials).length > 0 || Object.keys(chargerSerialsRef.current).length > 0)) {
        const latestProtectedChargerSerials = new Set<string>([
          ...getPendingChargerSerialSyncKeys(),
          ...Array.from(inFlightChargerSerialKeysRef.current),
        ]);
        const prunedChargerSerials = prunePreResetSerials(
          chargerSerialsRef.current,
          effectiveEpoch,
          effectiveDateIST
        );
        const { merged: mergedChargerSerials, localNewerSerials: localNewerChargerSerials } =
          mergeSerialsByHistory(prunedChargerSerials, remoteChargerSerials, latestProtectedChargerSerials);
        saveLocalChargerSerials(mergedChargerSerials);
        setChargerSerials(mergedChargerSerials);
        if (localNewerChargerSerials.length > 0 && health.online) {
          flushPendingChargerSerialsToServer(
            mergedChargerSerials,
            localNewerChargerSerials.map((s) => s.serialNo)
          ).catch(() => {});
        }
      }
      if (health.online && remoteChargers) {
        setChargerRecords(remoteChargers);
      } else if (remoteChargers && Object.keys(remoteChargers).length > 0) {
        setChargerRecords(remoteChargers);
      }
      if (health.online && remoteVehicles) {
        setVehicleRecords(remoteVehicles);
      } else if (remoteVehicles && Object.keys(remoteVehicles).length > 0) {
        setVehicleRecords(remoteVehicles);
      }
      if (Array.isArray(remoteTransfers)) {
        setTransfers(remoteTransfers);
      }
      const remainingPending = getPendingSyncKeys().length + getPendingChargerSyncKeys().length;
      setPendingSyncCount(remainingPending);
      if (remainingPending > 0) {
        setSaveState('pending');
      }
      if (health.online) {
        setIsRealtimeActive(true);
      }
    } catch (e) {
      console.warn('Cloud sync error:', e);
    } finally {
      isSyncingRef.current = false;
    }
  };

  useEffect(() => {
    if (!branchToken) return;
    syncWithCloudBackend(true);

    // Subscribe to live multi-device Real-Time Cloud Synchronization
    const unsubscribe = subscribeRealtimeSync({
      branchToken,
      onBranchCredentialsUpdated: async (payload) => {
        const activeLoginId = branchSessionRef.current?.loginId;
        const activeToken = branchTokenRef.current;
        if (activeLoginId && activeToken && payload?.loginId === activeLoginId) {
          const check = await apiGetBranchSession(activeToken);
          if (!check.authenticated) {
            handleBranchLogout(
              `Permissions or password for "${activeLoginId}" updated by Admin. Please sign in again.`
            );
          }
        }
      },
      onRecordUpdated: (updatedRecord) => {
        const recordKey = getBatteryRecordKey(updatedRecord.branchId, updatedRecord.date);
        if (inFlightRecordKeysRef.current.has(recordKey) || getPendingSyncKeys().includes(recordKey)) {
          return;
        }
        setRecords((prev) => {
          const existing = prev[recordKey];
          const prevTs = existing?.lastModified ? Date.parse(existing.lastModified) : 0;
          const nextTs = updatedRecord.lastModified ? Date.parse(updatedRecord.lastModified) : 0;
          if (existing && prevTs > nextTs) {
            return prev;
          }
          const next = { ...prev, [recordKey]: updatedRecord };
          saveRecords(next);
          return next;
        });
        showToast(`⚡ Real-Time Cloud: Updated ledger for ${updatedRecord.date}`);
      },
      onRecordDeleted: (deletedKey) => {
        setRecords((prev) => {
          const copy = { ...prev };
          delete copy[deletedKey];
          return copy;
        });
      },
      onSerialUpdated: (updatedSerial) => {
        const cleanKey = updatedSerial.serialNo.trim().toUpperCase();
        if (inFlightSerialKeysRef.current.has(cleanKey) || getPendingSerialSyncKeys().includes(cleanKey)) {
          return;
        }
        setSerials((prev) => {
          const { merged } = mergeSerialsByHistory(prev, { [cleanKey]: updatedSerial });
          saveLocalSerials(merged);
          return merged;
        });
        showToast(`⚡ Real-Time Cloud: Updated serial ${updatedSerial.serialNo}`);
      },
      onSerialsBulkUpdated: (updatedList) => {
        const protectedSet = new Set([
          ...getPendingSerialSyncKeys(),
          ...Array.from(inFlightSerialKeysRef.current),
        ]);
        const remoteMap: Record<string, BatterySerialItem> = {};
        updatedList.forEach((s) => {
          const cleanKey = s.serialNo.trim().toUpperCase();
          if (!protectedSet.has(cleanKey)) {
            remoteMap[cleanKey] = s;
          }
        });
        setSerials((prev) => {
          const { merged } = mergeSerialsByHistory(prev, remoteMap, protectedSet);
          saveLocalSerials(merged);
          return merged;
        });
        showToast(`⚡ Real-Time Cloud: ${updatedList.length} battery serials synchronized`);
      },
      onSerialDeleted: (deletedSerialNo) => {
        const cleanKey = deletedSerialNo.trim().toUpperCase();
        if (inFlightSerialKeysRef.current.has(cleanKey) || getPendingSerialSyncKeys().includes(cleanKey)) {
          return;
        }
        setSerials((prev) => {
          const copy = { ...prev };
          delete copy[deletedSerialNo];
          delete copy[cleanKey];
          saveLocalSerials(copy);
          return copy;
        });
      },
      onColumnsUpdated: (updatedCols) => {
        setColumns(updatedCols);
      },
      onChargerLedgerUpdated: (updatedRecord) => {
        const recordKey = getBatteryRecordKey(updatedRecord.branchId, updatedRecord.date);
        if (
          inFlightChargerRecordKeysRef.current.has(recordKey) ||
          getPendingChargerSyncKeys().includes(recordKey)
        ) {
          return;
        }
        setChargerLedgers((prev) => {
          const existing = prev[recordKey];
          const prevTs = existing?.lastModified ? Date.parse(existing.lastModified) : 0;
          const nextTs = updatedRecord.lastModified ? Date.parse(updatedRecord.lastModified) : 0;
          if (existing && prevTs > nextTs) {
            return prev;
          }
          const next = { ...prev, [recordKey]: updatedRecord };
          saveChargerRecords(next);
          return next;
        });
        showToast(`⚡ Real-Time Cloud: Updated charger ledger for ${updatedRecord.date}`);
      },
      onChargerLedgerDeleted: (deletedKey) => {
        setChargerLedgers((prev) => {
          const copy = { ...prev };
          delete copy[deletedKey];
          return copy;
        });
      },
      onChargerColumnsUpdated: (updatedCols) => {
        setChargerColumns(updatedCols);
      },
      onChargerSerialUpdated: (updatedSerial) => {
        const cleanKey = updatedSerial.serialNo.trim().toUpperCase();
        if (
          inFlightChargerSerialKeysRef.current.has(cleanKey) ||
          getPendingChargerSerialSyncKeys().includes(cleanKey)
        ) {
          return;
        }
        setChargerSerials((prev) => {
          const { merged } = mergeSerialsByHistory(prev, { [cleanKey]: updatedSerial });
          saveLocalChargerSerials(merged);
          return merged;
        });
        showToast(`⚡ Real-Time Cloud: Updated charger serial ${updatedSerial.serialNo}`);
      },
      onChargerSerialsBulkUpdated: (updatedList) => {
        const protectedSet = new Set([
          ...getPendingChargerSerialSyncKeys(),
          ...Array.from(inFlightChargerSerialKeysRef.current),
        ]);
        const remoteMap: Record<string, BatterySerialItem> = {};
        updatedList.forEach((s) => {
          const cleanKey = s.serialNo.trim().toUpperCase();
          if (!protectedSet.has(cleanKey)) {
            remoteMap[cleanKey] = s;
          }
        });
        setChargerSerials((prev) => {
          const { merged } = mergeSerialsByHistory(prev, remoteMap, protectedSet);
          saveLocalChargerSerials(merged);
          return merged;
        });
        showToast(`⚡ Real-Time Cloud: ${updatedList.length} charger serials synchronized`);
      },
      onChargerSerialDeleted: (deletedSerialNo) => {
        const cleanKey = deletedSerialNo.trim().toUpperCase();
        if (
          inFlightChargerSerialKeysRef.current.has(cleanKey) ||
          getPendingChargerSerialSyncKeys().includes(cleanKey)
        ) {
          return;
        }
        setChargerSerials((prev) => {
          const copy = { ...prev };
          delete copy[deletedSerialNo];
          delete copy[cleanKey];
          saveLocalChargerSerials(copy);
          return copy;
        });
      },
      onTeamUpdated: (updatedTeam) => {
        setTeamMembers(updatedTeam);
      },
      onChargerUpdated: (payload) => {
        setChargerRecords((prev) => ({
          ...prev,
          [payload.key]: {
            branchId: payload.branchId,
            date: payload.date,
            items: payload.record,
            updatedBy: payload.updatedBy,
            transactions: payload.transactions,
            updatedAt: payload.updatedAt,
          },
        }));
        showToast(`⚡ Real-Time Cloud: Updated charger stock`);
      },
      onVehicleUpdated: (payload) => {
        setVehicleRecords((prev) => ({
          ...prev,
          [payload.key]: {
            branchId: payload.branchId,
            date: payload.date,
            items: payload.record,
            updatedBy: payload.updatedBy,
            transactions: payload.transactions,
            updatedAt: payload.updatedAt,
          },
        }));
        showToast(`⚡ Real-Time Cloud: Updated vehicle stock`);
      },
      onTransfersUpdated: (updatedTransfers) => {
        setTransfers(updatedTransfers);
        const pendingForHere = updatedTransfers.filter(
          (t) => t.toBranchId === activeBranchRef.current && t.status !== 'received'
        );
        if (pendingForHere.length > 0) {
          setDismissedPopupSignature(null);
          showToast(`📦 Receive Goods Notification: ${pendingForHere.length} incoming transfer(s) ready!`);
        }
      },
      onFactoryReset: () => {
        inFlightRecordKeysRef.current.clear();
        inFlightSerialKeysRef.current.clear();
        inFlightChargerRecordKeysRef.current.clear();
        inFlightChargerSerialKeysRef.current.clear();
        setSelectedSerialHistory(null);
        setAssignModal((prev) => ({ ...prev, isOpen: false }));
        setReceiveModalState({ isOpen: false, items: [] });
        setPendingSyncCount(0);
        setSaveState('saved');
        syncWithCloudBackend(true);
        showToast('✓ All stock data & history factory reset — starting fresh from today!');
      },
      onConnectionChange: (connected) => {
        setIsRealtimeActive(connected);
      },
      onReconnected: () => {
        syncWithCloudBackend();
      },
    });

    // Re-sync immediately when mobile screen wakes up, tab regains focus, or network reconnects
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        syncWithCloudBackend();
      }
    };
    const handleOnline = () => {
      syncWithCloudBackend();
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('online', handleOnline);

    // Lightweight 5s background sync fallback when tab is active (ensures mobile updates even if SSE is throttled)
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncWithCloudBackend();
      }
    }, 5000);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('online', handleOnline);
      clearInterval(pollInterval);
    };
  }, [branchToken]);

  const activeColumns = isChargerMode ? chargerColumns : columns;
  const activeRecordsMap = isChargerMode ? chargerLedgers : records;
  const activeSerialsMap = isChargerMode ? chargerSerials : serials;

  // Branch-scoped records for the active branch & active category (Battery or Charger)
  const branchRecords = useMemo(() => {
    return extractBranchRecords(activeRecordsMap, activeBranchId);
  }, [activeRecordsMap, activeBranchId]);

  // Active day record
  const currentRecord: DayRecord = branchRecords[currentDate] || {
    date: currentDate,
    branchId: activeBranchId,
    stock: {},
    inStock: {},
    inCause: {},
    outStock: {},
    outCause: {},
  };

  const totals = calculateRecordTotals(currentRecord, activeColumns);

  // Total unassigned stock count across all models for current branch closing stock
  const unassignedCount = useMemo(() => {
    let unassigned = 0;
    const serialList = Object.values(activeSerialsMap).filter(
      (s) => (s.branchId || DEFAULT_BRANCH_ID) === activeBranchId
    );

    // Check main columns
    activeColumns.forEach((col) => {
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
  }, [activeColumns, totals.closingStock, totals.repair.closing, totals.service.closing, activeSerialsMap, activeBranchId]);

  // Bulk save serials from AssignSerialModal
  const handleBulkSaveSerials = async (
    newItems: BatterySerialItem[],
    targetCategory: 'battery' | 'charger' = activeLedgerCategory
  ) => {
    const isChg = targetCategory === 'charger';
    const actorLoginId = branchSessionRef.current?.loginId || '';
    const stamped = newItems.map((it) => ({
      ...it,
      serialNo: it.serialNo.trim().toUpperCase(),
      branchId: it.branchId || activeBranchId,
      inwardBy: it.inwardBy || actorLoginId || undefined,
      lastUpdatedBy: actorLoginId || it.lastUpdatedBy || undefined,
      history: (it.history || []).map((evt) => ({
        ...evt,
        performedBy: evt.performedBy || actorLoginId || undefined,
      })),
    }));
    const currentMap = isChg ? chargerSerialsRef.current : serialsRef.current;
    const updated = { ...currentMap };
    const inFlightSet = isChg ? inFlightChargerSerialKeysRef.current : inFlightSerialKeysRef.current;
    stamped.forEach((item) => {
      inFlightSet.add(item.serialNo);
      updated[item.serialNo] = item;
    });
    if (isChg) {
      setChargerSerials(updated);
      saveLocalChargerSerials(updated);
      try {
        await apiBulkSaveChargerSerials(stamped);
      } finally {
        stamped.forEach((item) => inFlightSet.delete(item.serialNo));
      }
    } else {
      setSerials(updated);
      saveLocalSerials(updated);
      try {
        await apiBulkSaveSerials(stamped);
      } finally {
        stamped.forEach((item) => inFlightSet.delete(item.serialNo));
      }
    }
    showToast(
      isCloudDbConnected
        ? `✓ Assigned & saved ${stamped.length} ${isChg ? 'charger ' : ''}serials to Supabase`
        : `✓ Assigned & permanently registered ${stamped.length} ${isChg ? 'charger ' : ''}serials in Cloud DBMS!`
    );
  };

  // Update single serial from edit form (supports rename cleanly without leaving orphan keys)
  const handleUpdateSingleSerial = async (
    updatedItem: BatterySerialItem,
    previousSerialNo?: string,
    targetCategory: 'battery' | 'charger' = activeLedgerCategory
  ) => {
    const isChg = targetCategory === 'charger';
    const actorLoginId = branchSessionRef.current?.loginId || '';
    const currentMap = isChg ? chargerSerialsRef.current : serialsRef.current;
    const prevExisting =
      currentMap[updatedItem.serialNo.trim().toUpperCase()] ||
      (previousSerialNo ? currentMap[previousSerialNo.trim().toUpperCase()] : undefined);
    const prevEventIds = new Set((prevExisting?.history || []).map((e) => e.id));
    const stamped: BatterySerialItem = {
      ...updatedItem,
      serialNo: updatedItem.serialNo.trim().toUpperCase(),
      branchId: updatedItem.branchId || activeBranchId,
      inwardBy: updatedItem.inwardBy || actorLoginId || undefined,
      outwardBy:
        updatedItem.status === 'dispatched' && prevExisting?.status !== 'dispatched'
          ? actorLoginId || updatedItem.outwardBy
          : updatedItem.outwardBy,
      lastUpdatedBy: actorLoginId || updatedItem.lastUpdatedBy || undefined,
      history: (updatedItem.history || []).map((evt) =>
        prevEventIds.has(evt.id)
          ? evt
          : { ...evt, performedBy: evt.performedBy || actorLoginId || undefined }
      ),
    };
    const updated = { ...currentMap };
    if (previousSerialNo && previousSerialNo.trim().toUpperCase() !== stamped.serialNo) {
      delete updated[previousSerialNo];
      delete updated[previousSerialNo.trim().toUpperCase()];
    }
    const inFlightSet = isChg ? inFlightChargerSerialKeysRef.current : inFlightSerialKeysRef.current;
    inFlightSet.add(stamped.serialNo);
    updated[stamped.serialNo] = stamped;
    if (isChg) {
      setChargerSerials(updated);
      saveLocalChargerSerials(updated);
      try {
        if (previousSerialNo && previousSerialNo.trim().toUpperCase() !== stamped.serialNo) {
          await apiDeleteChargerSerial(previousSerialNo);
        }
        await apiSaveChargerSerial(stamped);
      } finally {
        inFlightSet.delete(stamped.serialNo);
      }
    } else {
      setSerials(updated);
      saveLocalSerials(updated);
      try {
        if (previousSerialNo && previousSerialNo.trim().toUpperCase() !== stamped.serialNo) {
          await apiDeleteSerial(previousSerialNo);
        }
        await apiSaveSerial(stamped);
      } finally {
        inFlightSet.delete(stamped.serialNo);
      }
    }
    showToast(
      isCloudDbConnected
        ? `✓ Updated ${isChg ? 'charger ' : ''}serial ${stamped.serialNo} in Supabase`
        : `✓ Permanently updated ${isChg ? 'charger ' : ''}serial: ${stamped.serialNo} in Cloud DBMS`
    );
  };

  // Update records in state, localStorage, cascade closing stock forward, and persist to Cloud DBMS
  const handleUpdateRecord = async (
    updatedInput: DayRecord,
    andTriggerWhatsApp = false,
    serialEntries?: SerialEntryPayload[],
    targetCategory: 'battery' | 'charger' = activeLedgerCategory
  ) => {
    const isChg = targetCategory === 'charger';
    const targetCols = isChg ? chargerColumnsRef.current : columnsRef.current;
    const currentRecsMap = isChg ? chargerLedgersRef.current : recordsRef.current;
    const currentSerialsMap = isChg ? chargerSerialsRef.current : serialsRef.current;
    const inFlightRecSet = isChg ? inFlightChargerRecordKeysRef.current : inFlightRecordKeysRef.current;
    const inFlightSerSet = isChg ? inFlightChargerSerialKeysRef.current : inFlightSerialKeysRef.current;
    const setRecsState = isChg ? setChargerLedgers : setRecords;
    const saveRecsLocal = isChg ? saveChargerRecords : saveRecords;
    const apiSaveRecFn = isChg ? apiSaveChargerLedgerWithMeta : apiSaveRecordWithMeta;
    const setSerialsState = isChg ? setChargerSerials : setSerials;
    const saveSerialsLocal = isChg ? saveLocalChargerSerials : saveLocalSerials;
    const apiBulkSaveSerialsFn = isChg ? apiBulkSaveChargerSerials : apiBulkSaveSerials;
    const serialTagPrefix = isChg ? 'CHG' : 'BAT';

    const targetBranch = updatedInput.branchId || activeBranchId;
    const timestamp = new Date().toISOString();
    const actorLoginId = branchSessionRef.current?.loginId || '';
    const recordKey = getBatteryRecordKey(targetBranch, updatedInput.date);
    const prevRecordSnapshot = currentRecsMap[recordKey];

    // Build granular StockTransactionEntry entries for every IN / OUT delta on this save
    const newTxEntries: StockTransactionEntry[] = [];
    if (actorLoginId) {
      const trackedModelsForTx: Array<{ id: string; name: string }> = [
        ...targetCols.map((c) => ({ id: c.id, name: c.name })),
        {
          id: 'repair',
          name: isChg ? 'OLD CHARGER FOR REPAIR' : 'OLD BATTERY FOR REPAIR',
        },
        {
          id: 'service',
          name: isChg ? 'SERVICE CHARGER' : 'SERVICE BATTERY',
        },
      ];
      trackedModelsForTx.forEach((col) => {
        const prevIn = Number(prevRecordSnapshot?.inStock?.[col.id] || 0);
        const nextIn = Number(updatedInput.inStock?.[col.id] || 0);
        const deltaIn = nextIn - prevIn;
        if (deltaIn !== 0) {
          const matchingSerials = (serialEntries || []).filter(
            (s) => s.modelId === col.id && s.type !== 'out' && s.type !== 'repair_out'
          );
          const inCause =
            (col.id === 'repair' ? updatedInput.repairInCause : updatedInput.inCause?.[col.id]) ||
            updatedInput.totalInCause ||
            '';
          newTxEntries.push({
            id: `tx_${Date.now()}_${col.id}_in_${Math.random().toString(36).slice(2, 6)}`,
            timestamp,
            date: updatedInput.date,
            branchId: targetBranch,
            category: targetCategory,
            action: col.id === 'repair' ? 'repair_in' : col.id === 'service' ? 'service' : 'in',
            modelId: col.id,
            modelName: col.name,
            quantity: deltaIn,
            cause: inCause || undefined,
            partner: matchingSerials.map((s) => s.partner).filter(Boolean).join(', ') || undefined,
            serialNos: matchingSerials.map((s) => s.serialNo.trim().toUpperCase()),
            performedBy: actorLoginId,
          });
        }

        const prevOut = Number(prevRecordSnapshot?.outStock?.[col.id] || 0);
        const nextOut = Number(updatedInput.outStock?.[col.id] || 0);
        const deltaOut = nextOut - prevOut;
        if (deltaOut !== 0) {
          const matchingSerials = (serialEntries || []).filter(
            (s) => s.modelId === col.id && (s.type === 'out' || s.type === 'repair_out')
          );
          const outCause =
            (col.id === 'repair' ? updatedInput.repairOutCause : updatedInput.outCause?.[col.id]) ||
            updatedInput.totalOutCause ||
            '';
          newTxEntries.push({
            id: `tx_${Date.now()}_${col.id}_out_${Math.random().toString(36).slice(2, 6)}`,
            timestamp,
            date: updatedInput.date,
            branchId: targetBranch,
            category: targetCategory,
            action: col.id === 'repair' ? 'repair_out' : col.id === 'service' ? 'service' : 'out',
            modelId: col.id,
            modelName: col.name,
            quantity: deltaOut,
            cause: outCause || undefined,
            partner: matchingSerials.map((s) => s.partner || s.vehicle).filter(Boolean).join(', ') || undefined,
            serialNos: matchingSerials.map((s) => s.serialNo.trim().toUpperCase()),
            performedBy: actorLoginId,
          });
        }
      });
    }

    const existingTx = Array.isArray(updatedInput.transactions)
      ? updatedInput.transactions
      : Array.isArray(prevRecordSnapshot?.transactions)
      ? prevRecordSnapshot.transactions
      : [];

    const updated: DayRecord = {
      ...updatedInput,
      branchId: targetBranch,
      isAutoGenerated: false,
      lastModified: timestamp,
      lastModifiedBy: actorLoginId || updatedInput.lastModifiedBy || prevRecordSnapshot?.lastModifiedBy,
      transactions: [...existingTx, ...newTxEntries].slice(-500),
    };

    inFlightRecSet.add(recordKey);
    setSaveState('saving');

    let cascadedChanged: DayRecord[] = [];
    setRecsState((prev) => {
      const withEdit = { ...prev, [recordKey]: updated };
      const { updatedRecordsMap, changedRecords } = cascadeBranchOpeningStock(
        withEdit,
        targetBranch,
        updated.date,
        targetCols
      );
      cascadedChanged = changedRecords;
      saveRecsLocal(updatedRecordsMap);
      return updatedRecordsMap;
    });

    let updatedSerials = { ...currentSerialsMap };
    const savedList: BatterySerialItem[] = [];
    let effectiveSerialEntries: SerialEntryPayload[] = serialEntries ? [...serialEntries] : [];

    // When user edits cells directly in the ExcelGrid without serialEntries, derive tracked serial movements from quantity deltas
    if (effectiveSerialEntries.length === 0) {
      const trackedModels: Array<{ id: string; name: string }> = [
        ...targetCols.map((c) => ({ id: c.id, name: c.name })),
        {
          id: 'repair',
          name: isChg ? 'OLD CHARGER FOR REPAIR' : 'OLD BATTERY FOR REPAIR',
        },
        {
          id: 'service',
          name: isChg ? 'SERVICE CHARGER' : 'SERVICE BATTERY',
        },
      ];
      const allocatedNow = new Set<string>();
      const makeUniqueSerial = (prefixName: string, tag: string) => {
        const cleanPrefix =
          prefixName
            .replace(/[×x\s]/g, '')
            .replace(/[^A-Za-z0-9]/g, '')
            .toUpperCase()
            .slice(0, 6) || serialTagPrefix;
        let n = Math.floor(1000 + Math.random() * 9000);
        while (
          allocatedNow.has(`${serialTagPrefix}-${cleanPrefix}-${tag}${n}`) ||
          updatedSerials[`${serialTagPrefix}-${cleanPrefix}-${tag}${n}`]
        ) {
          n += 1;
        }
        const sn = `${serialTagPrefix}-${cleanPrefix}-${tag}${n}`;
        allocatedNow.add(sn);
        return sn;
      };

      trackedModels.forEach((col) => {
        const prevIn = Number(prevRecordSnapshot?.inStock?.[col.id] || 0);
        const nextIn = Number(updated.inStock?.[col.id] || 0);
        const inDelta = nextIn - prevIn;
        if (inDelta > 0) {
          const inCause =
            (col.id === 'repair' ? updated.repairInCause : updated.inCause?.[col.id]) ||
            updated.totalInCause ||
            `Direct spreadsheet IN (+${inDelta})`;
          const moveType: SerialEntryPayload['type'] =
            col.id === 'repair' ? 'repair_in' : col.id === 'service' ? 'service' : 'in';
          const tag = col.id === 'repair' ? 'REP-' : col.id === 'service' ? 'SVC-' : '';
          for (let i = 0; i < inDelta; i++) {
            effectiveSerialEntries.push({
              serialNo: makeUniqueSerial(col.name, tag),
              batchNo: col.name,
              modelId: col.id,
              modelName: col.name,
              type: moveType,
              cause: inCause,
            });
          }
        }

        const prevOutMag = Math.abs(Number(prevRecordSnapshot?.outStock?.[col.id] || 0));
        const nextOutMag = Math.abs(Number(updated.outStock?.[col.id] || 0));
        const outDelta = nextOutMag - prevOutMag;
        if (outDelta > 0) {
          const outCause =
            (col.id === 'repair' ? updated.repairOutCause : updated.outCause?.[col.id]) ||
            updated.totalOutCause ||
            `Direct spreadsheet OUT (-${outDelta})`;
          const moveType: SerialEntryPayload['type'] = col.id === 'repair' ? 'repair_out' : 'out';

          const fifoCandidates = Object.values(updatedSerials)
            .filter((s) => {
              if (allocatedNow.has(s.serialNo)) return false;
              if ((s.branchId || DEFAULT_BRANCH_ID) !== targetBranch) return false;
              const modelMatch =
                s.modelId === col.id || s.modelName === col.name || s.batchNo === col.name;
              if (!modelMatch) return false;
              if (col.id === 'repair') return s.status === 'in_repair' || s.status === 'in_stock';
              if (col.id === 'service') return s.status === 'service_standby' || s.status === 'in_stock';
              return s.status === 'in_stock';
            })
            .sort((a, b) =>
              toISODateString(a.inwardDate || '').localeCompare(toISODateString(b.inwardDate || ''))
            );

          let assigned = 0;
          for (const candidate of fifoCandidates) {
            if (assigned >= outDelta) break;
            allocatedNow.add(candidate.serialNo);
            effectiveSerialEntries.push({
              serialNo: candidate.serialNo,
              batchNo: col.name,
              modelId: col.id,
              modelName: col.name,
              type: moveType,
              cause: outCause,
            });
            assigned += 1;
          }
          while (assigned < outDelta) {
            effectiveSerialEntries.push({
              serialNo: makeUniqueSerial(col.name, 'OUT-'),
              batchNo: col.name,
              modelId: col.id,
              modelName: col.name,
              type: moveType,
              cause: outCause,
            });
            assigned += 1;
          }
        }
      });
    }

    if (effectiveSerialEntries.length > 0) {
      effectiveSerialEntries.forEach((entry, idx) => {
        const cleanSerial = entry.serialNo.trim().toUpperCase();
        if (!cleanSerial) return;
        const existing: BatterySerialItem = updatedSerials[cleanSerial] || {
          serialNo: cleanSerial,
          batchNo: entry.batchNo,
          modelId: entry.modelId,
          modelName: entry.modelName,
          branchId: targetBranch,
          status:
            entry.type === 'out' || entry.type === 'repair_out'
              ? 'dispatched'
              : entry.type === 'repair_in'
              ? 'in_repair'
              : entry.type === 'service'
              ? 'service_standby'
              : 'in_stock',
          inwardDate: updated.date,
          inwardCause: entry.cause,
          inwardPartner: entry.partner,
          inwardBy: actorLoginId || undefined,
          history: [],
        };

        const movement = {
          id: `evt_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 4)}`,
          timestamp: new Date().toISOString(),
          date: updated.date,
          type: entry.type,
          cause: entry.cause,
          partner: entry.partner,
          vehicleOrLocation: entry.vehicle,
          branchId: targetBranch,
          performedBy: actorLoginId || undefined,
        };

        existing.history = [movement, ...(existing.history || [])];
        existing.branchId = targetBranch;
        existing.lastUpdatedBy = actorLoginId || existing.lastUpdatedBy;

        if (entry.type === 'in') {
          existing.status = 'in_stock';
          existing.inwardDate = updated.date;
          existing.inwardCause = entry.cause;
          existing.inwardPartner = entry.partner;
          existing.inwardBy = existing.inwardBy || actorLoginId || undefined;
        } else if (entry.type === 'out' || entry.type === 'repair_out') {
          existing.status = 'dispatched';
          existing.outwardDate = updated.date;
          existing.outwardCause = entry.cause;
          existing.outwardPartner = entry.partner || entry.vehicle;
          existing.outwardBy = actorLoginId || existing.outwardBy;
        } else if (entry.type === 'repair_in') {
          existing.status = 'in_repair';
          existing.inwardDate = existing.inwardDate || updated.date;
          existing.inwardCause = existing.inwardCause || entry.cause;
          existing.inwardPartner = existing.inwardPartner || entry.partner;
          existing.inwardBy = existing.inwardBy || actorLoginId || undefined;
        } else if (entry.type === 'service') {
          existing.status = 'service_standby';
          existing.inwardDate = existing.inwardDate || updated.date;
          existing.inwardCause = existing.inwardCause || entry.cause;
          existing.inwardPartner = existing.inwardPartner || entry.partner;
          existing.inwardBy = existing.inwardBy || actorLoginId || undefined;
        }

        if (entry.batchNo) existing.batchNo = entry.batchNo;

        inFlightSerSet.add(cleanSerial);
        updatedSerials[cleanSerial] = existing;
        savedList.push(existing);
      });

      setSerialsState(updatedSerials);
      saveSerialsLocal(updatedSerials);
      try {
        await apiBulkSaveSerialsFn(savedList);
      } finally {
        savedList.forEach((s) => inFlightSerSet.delete(s.serialNo));
      }
    }

    try {
      const saveResult = await apiSaveRecFn(updated);
      // Persist any cascaded later days so their opening stock proceeds from this edit permanently
      for (const downstreamRec of cascadedChanged) {
        await apiSaveRecFn(downstreamRec);
      }

      const saved = saveResult.record;
      const savedKey = getBatteryRecordKey(saved.branchId || targetBranch, saved.date);
      inFlightRecSet.delete(recordKey);

      setRecsState((prev) => {
        const currentRec = prev[savedKey];
        const currentTs = currentRec?.lastModified ? Date.parse(currentRec.lastModified) : 0;
        const savedTs = saved.lastModified ? Date.parse(saved.lastModified) : 0;
        // Never overwrite a newer rapid local edit with an older in-flight response
        if (currentRec && currentTs > savedTs) {
          return prev;
        }
        const next = { ...prev, [savedKey]: saved };
        saveRecsLocal(next);
        return next;
      });

      const remaining = getPendingSyncKeys().length + getPendingChargerSyncKeys().length;
      setPendingSyncCount(remaining);

      if (saveResult.persistedToServer && (saveResult.persistedToRemote || saveResult.storage === 'local_file')) {
        setSaveState('saved');
        const cascadeMsg =
          cascadedChanged.length > 0 ? ` + carried forward ${cascadedChanged.length} day(s)` : '';
        showToast(
          savedList.length > 0
            ? `✓ Saved ${savedList.length} ${isChg ? 'charger ' : ''}serials & stock to ${isCloudDbConnected ? 'Supabase' : 'Cloud DBMS'}${cascadeMsg}!`
            : `✓ ${isChg ? 'Charger stock' : 'Stock'} saved to ${isCloudDbConnected ? 'Supabase & Cloud Space' : 'Cloud DBMS'}${cascadeMsg}!`
        );
      } else {
        setSaveState('pending');
        showToast(
          `⚠ Saved locally (${saveResult.error || 'cloud retry queued'}) — will sync automatically`
        );
      }
    } catch {
      inFlightRecSet.delete(recordKey);
      setPendingSyncCount(getPendingSyncKeys().length + getPendingChargerSyncKeys().length);
      setSaveState('pending');
      showToast(`⚠ Saved locally (will sync when online)`);
    }

    if (andTriggerWhatsApp) {
      setIsWhatsAppOpen(true);
    }
  };

  // Manual Save & Cloudinary Cloud Space Backup action from Top Toolbar
  const handleManualSaveAndBackup = async (requireCloudSpaceAdmin = false) => {
    setIsCloudSpaceBackingUp(true);
    setSaveState('saving');
    try {
      await flushPendingRecordsToServer(recordsRef.current);
      await flushPendingSerialsToServer(serialsRef.current);
      await flushPendingChargerLedgersToServer(chargerLedgersRef.current);
      await flushPendingChargerSerialsToServer(chargerSerialsRef.current);
      const remaining = getPendingSyncKeys().length + getPendingChargerSyncKeys().length;
      setPendingSyncCount(remaining);
      setSaveState(remaining > 0 ? 'pending' : 'saved');
      const refreshedHealth = await checkBackendHealth();
      setBackendStatus(refreshedHealth);

      if (!adminToken) {
        if (requireCloudSpaceAdmin) {
          openAdminPortal(
            'Sign in as Admin to sync Excel (.xlsx) snapshots to Cloud Space.',
            'backups',
            (token) => {
              void handleAdminCloudSpaceSync(token);
            }
          );
          return;
        }
        showToast(
          isCloudDbConnected
            ? '✓ Saved to Supabase & Cloud DBMS (Sign in as Admin to sync Cloud Space Excels)'
            : '✓ Saved to Cloud DBMS (Sign in as Admin to sync Cloud Space Excels)'
        );
        return;
      }

      await handleAdminCloudSpaceSync(adminToken);
    } finally {
      setIsCloudSpaceBackingUp(false);
    }
  };

  const handleAdminCloudSpaceSync = async (token: string) => {
    const res = await apiTriggerCloudinaryBackup(
      recordsRef.current,
      serialsRef.current,
      'toolbar_manual_save',
      token
    );
    if (res.unauthorized) {
      setAdminToken(null);
      setAdminSession(null);
      openAdminPortal(
        'Admin session expired. Please sign in again to upload Cloud Space Excels.',
        'backups'
      );
      return;
    }
    if (res.uploadedToCloudinary) {
      showToast(
        `✓ Excel (.xlsx) & DB backed up to Supabase + Cloudinary (${res.cloudName}) [${res.recordCount || 0} ledgers]`
      );
    } else if (res.success && !res.cloudinaryConfigured) {
      showToast(
        `✓ Saved to Supabase & Server Disk (${res.recordCount || 0} ledgers). Add Cloudinary Secrets for Cloud Space upload.`
      );
    } else {
      showToast(`⚠ Saved locally/DB; Cloud Space note: ${res.error || 'retry shortly'}`);
    }
  };

  const handleDownloadQuantityExcelGated = () => {
    requireAdminAction(
      `Sign in as Admin to download ${isChargerMode ? 'Charger' : 'Battery'} Quantity Stock Excel (.xlsx).`,
      'exports',
      () => {
        exportRecordToExcel(currentRecord, activeColumns, activeLedgerCategory);
        showToast(
          `Downloaded ${isChargerMode ? 'Charger' : 'Battery'} Quantity Stock Excel (${currentRecord.date})`
        );
      }
    );
  };

  const handleDownloadSerialHistoryExcelGated = () => {
    requireAdminAction(
      `Sign in as Admin to download ${isChargerMode ? 'Charger' : 'Battery'} Serials & Movement History Excel (.xlsx).`,
      'exports',
      () => {
        exportSerialHistoryToExcel(
          activeSerialsMap,
          activeColumns,
          activeBranchId,
          activeRecordsMap,
          activeCategoryTransfers,
          chargerRecords,
          vehicleRecords,
          activeLedgerCategory
        );
        showToast(
          `Downloaded Complete ${isChargerMode ? 'Charger' : 'Battery'} Serial Numbers & Movement History Excel (.xlsx)`
        );
      }
    );
  };

  const handleDownloadVehicleExcelGated = (itemsMap: Record<string, any>) => {
    requireAdminAction(
      'Sign in as Admin to download EV Vehicle Stock Excel (.xlsx).',
      'exports',
      () => {
        exportSecondaryStockToExcel(
          'vehicle',
          activeBranchId,
          currentDate,
          itemsMap,
          DEFAULT_VEHICLE_COLUMNS,
          vehicleRecords
        );
        showToast(`Downloaded EV Vehicle Stock Excel (${currentDate})`);
      }
    );
  };

  // Create Inter-Branch Stock Transfer from QuickEntryModal
  const handleCreateBranchTransfer = async (payload: BranchTransferDispatchPayload) => {
    const res = await apiCreateTransfer({
      fromBranchId: activeBranchId,
      toBranchId: payload.toBranchId,
      date: payload.date,
      category: activeLedgerCategory,
      items: payload.items,
      partner: payload.partner,
      notes: payload.notes,
    });
    if (res.transfers) {
      setTransfers(res.transfers);
    }
    const targetName = BRANCHES.find((b) => b.id === payload.toBranchId)?.name || payload.toBranchId;
    const totalUnits = payload.items.reduce((s, it) => s + (it.quantity || 0), 0);
    showToast(
      `📦 Sent ${totalUnits} ${isChargerMode ? 'charger' : 'unit'}(s) to ${targetName} — Receive Goods notification created!`
    );
  };

  // Open Review & Edit modal when receiving battery transfer(s)
  const openReceiveModalForSelections = (
    selections: Array<{ transferId: string; itemIds: string[] }>
  ) => {
    const picked: Array<{ transfer: BranchTransfer; item: BranchTransferItem }> = [];
    selections.forEach((sel) => {
      const trf = transfers.find((t) => t.id === sel.transferId);
      if (!trf) return;
      const idSet = new Set(sel.itemIds);
      trf.items.forEach((it) => {
        if (!it.received && idSet.has(it.id)) {
          picked.push({ transfer: trf, item: it });
        }
      });
    });
    if (picked.length === 0) return;
    setReceiveModalState({ isOpen: true, items: picked });
  };

  // Confirm & Save edited incoming transfer details into active receiver branch's stock
  const handleConfirmReceiveTransfer = async (payload: ReceiveTransferConfirmPayload) => {
    if (payload.selections.length === 0 || payload.editedItems.length === 0) return;
    setIsReceivingGoods(true);
    try {
      const trfCategory: 'battery' | 'charger' =
        receiveModalState.items[0]?.transfer.category === 'charger' ? 'charger' : 'battery';
      const isChgTrf = trfCategory === 'charger';
      const targetCols = isChgTrf ? chargerColumnsRef.current : columnsRef.current;
      const targetBranchRecords = extractBranchRecords(
        isChgTrf ? chargerLedgersRef.current : recordsRef.current,
        activeBranchId
      );
      const prefixTag = isChgTrf ? 'CHG' : 'BAT';

      const updatedTransfers = await apiReceiveTransfers(payload.selections, activeBranch.name);
      setTransfers(updatedTransfers);

      const targetDate = payload.receivingDate || currentDate;
      let baseRecord = targetBranchRecords[targetDate];
      if (!baseRecord) {
        const sortedDates = Object.keys(targetBranchRecords).sort((a, b) =>
          toISODateString(a).localeCompare(toISODateString(b))
        );
        const priorDates = sortedDates.filter(
          (d) => toISODateString(d) <= toISODateString(targetDate)
        );
        const prevDate = priorDates.length > 0 ? priorDates[priorDates.length - 1] : sortedDates[0];
        if (prevDate && targetBranchRecords[prevDate]) {
          baseRecord = createNextDayRecord(
            { ...targetBranchRecords[prevDate], branchId: activeBranchId },
            targetCols
          );
          baseRecord.date = targetDate;
        } else {
          baseRecord = createEmptyDayRecord(targetDate, targetCols, activeBranchId);
        }
      }

      const updatedRecord: DayRecord = {
        ...baseRecord,
        date: targetDate,
        branchId: activeBranchId,
        stock: { ...baseRecord.stock },
        inStock: { ...baseRecord.inStock },
        inCause: { ...baseRecord.inCause },
        outStock: { ...baseRecord.outStock },
        outCause: { ...baseRecord.outCause },
        lastModified: new Date().toISOString(),
      };

      const serialEntriesToSave: SerialEntryPayload[] = [];
      let totalReceivedUnits = 0;

      payload.editedItems.forEach((item) => {
        totalReceivedUnits += item.quantity;
        const causeStr = [
          item.notes || `Received from ${item.fromBranchName}`,
          payload.partner ? `via ${payload.partner}` : '',
          payload.notes || '',
        ]
          .filter(Boolean)
          .join(' , ');

        if (item.modelId === 'repair') {
          updatedRecord.inStock['repair'] = (updatedRecord.inStock['repair'] || 0) + item.quantity;
          updatedRecord.repairInCause = updatedRecord.repairInCause
            ? `${updatedRecord.repairInCause}\n${causeStr}`
            : causeStr;
        } else if (item.modelId === 'service') {
          updatedRecord.inStock['service'] = (updatedRecord.inStock['service'] || 0) + item.quantity;
        } else {
          updatedRecord.inStock[item.modelId] =
            (updatedRecord.inStock[item.modelId] || 0) + item.quantity;
          updatedRecord.inCause[item.modelId] = updatedRecord.inCause[item.modelId]
            ? `${updatedRecord.inCause[item.modelId]}\n${causeStr}`
            : causeStr;
          const summaryLine = `${item.modelName}: ${causeStr} (+${item.quantity})`;
          updatedRecord.totalInCause = updatedRecord.totalInCause
            ? `${updatedRecord.totalInCause}\n${summaryLine}`
            : summaryLine;
        }

        if (item.serialNos && item.serialNos.length > 0) {
          item.serialNos.forEach((sn) => {
            serialEntriesToSave.push({
              serialNo: sn,
              batchNo: item.batchNo || item.modelName,
              modelId: item.modelId,
              modelName: item.modelName,
              type: item.modelId === 'repair' ? 'repair_in' : item.modelId === 'service' ? 'service' : 'in',
              cause: causeStr,
              partner: payload.partner || item.fromBranchName,
              vehicle: activeBranch.name,
            });
          });
        } else {
          const cleanPrefix =
            item.modelName
              .replace(/[×x\s]/g, '')
              .replace(/[^A-Za-z0-9]/g, '')
              .toUpperCase()
              .slice(0, 6) || prefixTag;
          const randBase = Math.floor(1000 + Math.random() * 9000);
          for (let i = 0; i < item.quantity; i++) {
            serialEntriesToSave.push({
              serialNo: `${prefixTag}-${cleanPrefix}-RCV-${randBase + i}`,
              batchNo: item.batchNo || item.modelName,
              modelId: item.modelId,
              modelName: item.modelName,
              type: item.modelId === 'repair' ? 'repair_in' : item.modelId === 'service' ? 'service' : 'in',
              cause: causeStr,
              partner: payload.partner || item.fromBranchName,
              vehicle: activeBranch.name,
            });
          }
        }
      });

      await handleUpdateRecord(
        updatedRecord,
        false,
        serialEntriesToSave.length > 0 ? serialEntriesToSave : undefined,
        trfCategory
      );
      if (targetDate !== currentDate) {
        setCurrentDate(targetDate);
      }
      setReceiveModalState({ isOpen: false, items: [] });
      const unitLabel = isChgTrf
        ? totalReceivedUnits === 1
          ? 'charger'
          : 'chargers'
        : totalReceivedUnits === 1
        ? 'battery'
        : 'batteries';
      showToast(
        `✓ Saved & Added ${totalReceivedUnits} ${unitLabel} into ${activeBranch.shortName} stock!`
      );
    } finally {
      setIsReceivingGoods(false);
    }
  };

  const showToast = (msg: string) => {
    setNotificationToast(msg);
    setTimeout(() => setNotificationToast(null), 3500);
  };

  // Add battery or charger model column
  const handleAddColumn = async (name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!id) return;
    if (isChargerMode) {
      if (chargerColumns.some((c) => c.id === id)) {
        showToast('Column already exists!');
        return;
      }
      lastChargerColumnMutationAtRef.current = Date.now();
      const newCol: BatteryColumn = { id, name };
      const updated = [...chargerColumns, newCol];
      chargerColumnsRef.current = updated;
      setChargerColumns(updated);
      saveChargerColumns(updated);
      await apiSaveChargerColumns(updated);
      showToast(`Added charger model: ${name}`);
      return;
    }
    if (columns.some((c) => c.id === id)) {
      showToast('Column already exists!');
      return;
    }
    lastColumnMutationAtRef.current = Date.now();
    const newCol: BatteryColumn = { id, name };
    const updated = [...columns, newCol];
    columnsRef.current = updated;
    setColumns(updated);
    saveColumns(updated);
    await apiSaveColumns(updated);
    showToast(`Added battery model: ${name}`);
  };

  // Create or carry forward next day entry WITHOUT destroying existing transactions if nextDate already exists
  const handleCreateNextDay = async () => {
    const nextDate = addDaysToDateString(currentRecord.date, 1);
    if (isAfterTodayIST(nextDate)) {
      showToast(`Cannot create ledger beyond today in IST (${getIndianTodayDate()})`);
      return;
    }
    const setRecsState = isChargerMode ? setChargerLedgers : setRecords;
    const saveRecsLocal = isChargerMode ? saveChargerRecords : saveRecords;
    const apiSaveRecFn = isChargerMode ? apiSaveChargerLedgerWithMeta : apiSaveRecordWithMeta;

    const existingNext = branchRecords[nextDate];
    if (existingNext) {
      const prevTotals = calculateRecordTotals(currentRecord, activeColumns);
      const updatedStock: Record<string, number> = { ...existingNext.stock };
      [...activeColumns.map((c) => c.id), 'repair', 'service'].forEach((id) => {
        updatedStock[id] = prevTotals.closingStock[id] || 0;
      });
      const updatedNext: DayRecord = {
        ...existingNext,
        branchId: activeBranchId,
        stock: updatedStock,
        lastModified: new Date().toISOString(),
      };
      const key = getBatteryRecordKey(activeBranchId, nextDate);
      let cascaded: DayRecord[] = [];
      setRecsState((prev) => {
        const nextMap = { ...prev, [key]: updatedNext };
        const res = cascadeBranchOpeningStock(nextMap, activeBranchId, nextDate, activeColumns);
        cascaded = res.changedRecords;
        saveRecsLocal(res.updatedRecordsMap);
        return res.updatedRecordsMap;
      });
      setCurrentDate(nextDate);
      await apiSaveRecFn(updatedNext);
      for (const rec of cascaded) {
        await apiSaveRecFn(rec);
      }
      showToast(`Synced opening balance into ${nextDate} while preserving existing transactions!`);
      return;
    }

    const nextDayRecord = createNextDayRecord(
      { ...currentRecord, branchId: activeBranchId },
      activeColumns
    );
    nextDayRecord.date = nextDate;
    nextDayRecord.branchId = activeBranchId;
    const key = getBatteryRecordKey(activeBranchId, nextDayRecord.date);
    setRecsState((prev) => {
      const nextMap = { ...prev, [key]: nextDayRecord };
      saveRecsLocal(nextMap);
      return nextMap;
    });
    setCurrentDate(nextDayRecord.date);
    await apiSaveRecFn(nextDayRecord);
    showToast(`Created new ledger for ${nextDayRecord.date} with closing balance carried over!`);
  };

  // Switch to or create date record (strictly up to today in IST)
  const handleSelectOrCreateDate = async (targetDate: string) => {
    if (isAfterTodayIST(targetDate)) {
      showToast(`Cannot select future date beyond today in IST (${getIndianTodayDate()})`);
      return;
    }

    if (branchRecords[targetDate]) {
      setCurrentDate(targetDate);
      showToast(`Switched to ${targetDate} ledger`);
      return;
    }

    const setRecsState = isChargerMode ? setChargerLedgers : setRecords;
    const saveRecsLocal = isChargerMode ? saveChargerRecords : saveRecords;
    const apiSaveRecFn = isChargerMode ? apiSaveChargerLedgerWithMeta : apiSaveRecordWithMeta;

    const sortedDates = Object.keys(branchRecords).sort((a, b) => {
      return toISODateString(a).localeCompare(toISODateString(b));
    });

    const priorDates = sortedDates.filter((d) => toISODateString(d) <= toISODateString(targetDate));
    const baseDate = priorDates.length > 0 ? priorDates[priorDates.length - 1] : sortedDates[0];
    const baseRecord = baseDate ? branchRecords[baseDate] : currentRecord;

    const newDayRecord = createNextDayRecord(
      { ...baseRecord, branchId: activeBranchId },
      activeColumns
    );
    newDayRecord.date = targetDate;
    newDayRecord.branchId = activeBranchId;
    newDayRecord.notes = `Created for ${targetDate} carrying forward closing balance from ${baseRecord.date}`;

    const key = getBatteryRecordKey(activeBranchId, targetDate);
    let cascaded: DayRecord[] = [];
    setRecsState((prev) => {
      const nextMap = { ...prev, [key]: newDayRecord };
      const res = cascadeBranchOpeningStock(nextMap, activeBranchId, targetDate, activeColumns);
      cascaded = res.changedRecords;
      saveRecsLocal(res.updatedRecordsMap);
      return res.updatedRecordsMap;
    });
    setCurrentDate(targetDate);
    await apiSaveRecFn(newDayRecord);
    for (const rec of cascaded) {
      await apiSaveRecFn(rec);
    }
    showToast(`Created ${targetDate} ledger carrying forward closing balance!`);
  };

  // Today in Indian Standard Time (IST)
  const todayIST = getIndianTodayDate();
  const isViewingToday = currentDate === todayIST;

  // Chronologically sorted recorded dates for active branch
  const recordedDates = useMemo(() => {
    return Object.keys(branchRecords).sort((a, b) => {
      return toISODateString(a).localeCompare(toISODateString(b));
    });
  }, [branchRecords]);

  const currentIndex = recordedDates.indexOf(currentDate);

  // Periodically check if day rolled over in IST and keep today updated
  useEffect(() => {
    const checkDayRollover = () => {
      const liveToday = getIndianTodayDate();
      const bId = activeBranchRef.current;
      const key = getBatteryRecordKey(bId, liveToday);
      setRecords((prev) => {
        if (!prev[key]) {
          const withToday = ensureTodayLedger(
            prev,
            columns,
            true,
            bId,
            saveRecords,
            apiSaveRecordWithMeta
          );
          if (activeCategoryRef.current === 'battery') {
            setCurrentDate(liveToday);
          }
          return withToday;
        }
        return prev;
      });
      setChargerLedgers((prev) => {
        if (!prev[key]) {
          const withToday = ensureTodayLedger(
            prev,
            chargerColumns,
            true,
            bId,
            saveChargerRecords,
            apiSaveChargerLedgerWithMeta
          );
          if (activeCategoryRef.current === 'charger') {
            setCurrentDate(liveToday);
          }
          return withToday;
        }
        return prev;
      });
    };

    const interval = setInterval(checkDayRollover, 30000);
    return () => clearInterval(interval);
  }, [columns, chargerColumns]);

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

  // Jump to Indian Standard Time (IST) Today
  const handleJumpToTodayIST = async () => {
    if (branchRecords[todayIST]) {
      setCurrentDate(todayIST);
      showToast(`Switched to today's date in India: ${todayIST}`);
    } else {
      const setRecsState = isChargerMode ? setChargerLedgers : setRecords;
      const saveRecsLocal = isChargerMode ? saveChargerRecords : saveRecords;
      const apiSaveRecFn = isChargerMode ? apiSaveChargerLedgerWithMeta : apiSaveRecordWithMeta;

      const latestDate = recordedDates[recordedDates.length - 1];
      const baseRecord = latestDate ? branchRecords[latestDate] : currentRecord;
      const newDayRecord = createNextDayRecord(
        { ...baseRecord, branchId: activeBranchId },
        activeColumns
      );
      newDayRecord.date = todayIST;
      newDayRecord.branchId = activeBranchId;
      newDayRecord.notes = `Created for IST Today (${todayIST}) carrying forward closing stock`;
      newDayRecord.lastModified = new Date().toISOString();

      const key = getBatteryRecordKey(activeBranchId, todayIST);
      const newRecords = { ...activeRecordsMap, [key]: newDayRecord };
      setRecsState(newRecords);
      saveRecsLocal(newRecords);
      setCurrentDate(todayIST);
      await apiSaveRecFn(newDayRecord);
      showToast(`Created today's ledger (${todayIST} IST) with closing balance carried over!`);
    }
  };

  const adminPortalModal = (
    <AdminPortalModal
      isOpen={isAdminPortalOpen}
      onClose={() => {
        setIsAdminPortalOpen(false);
        setAdminPromptReason(null);
        pendingAdminCallbackRef.current = null;
      }}
      adminToken={adminToken}
      adminSession={adminSession}
      onAuthenticated={(token, session) => {
        setAdminToken(token);
        setAdminSession(session);
        setAdminPromptReason(null);
        if (pendingAdminCallbackRef.current) {
          const cb = pendingAdminCallbackRef.current;
          pendingAdminCallbackRef.current = null;
          setIsAdminPortalOpen(false);
          cb(token);
        }
      }}
      onSignedOut={() => {
        setAdminToken(null);
        setAdminSession(null);
        setAdminPromptReason(null);
        pendingAdminCallbackRef.current = null;
        showToast('Signed out from Admin Console');
      }}
      promptReason={adminPromptReason}
      initialTab={adminInitialTab}
      onDataReload={syncWithCloudBackend}
      currentRecord={currentRecord}
      columns={activeColumns}
      serials={activeSerialsMap}
      records={activeRecordsMap}
      transfers={transfers}
      chargerRecords={chargerRecords}
      vehicleRecords={vehicleRecords}
      activeBranchId={activeBranchId}
      activeCategory={activeLedgerCategory}
      onShowToast={showToast}
    />
  );

  if (!branchSession || !branchToken) {
    return (
      <>
        <BranchLoginScreen
          onAuthenticated={handleBranchAuthenticated}
          onOpenAdminPortal={() => openAdminPortal(null, 'passwords')}
          isAdminAuthenticated={Boolean(adminToken)}
          notice={branchAuthNotice}
        />
        {adminPortalModal}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-900 font-sans overflow-x-clip">
      {/* Top Bar adhering to Top Bar Contract */}
      <Header
        onOpenQuickEntry={() => openQuickEntryWithType('both')}
        onOpenWhatsAppDispatch={() => setIsWhatsAppOpen(true)}
        onOpenTeamModal={() => setIsTeamModalOpen(true)}
        onOpenCloudSettings={() => setIsCloudModalOpen(true)}
        onOpenSerialTracker={() => setIsSerialModalOpen(true)}
        onExportExcel={handleDownloadQuantityExcelGated}
        currentDate={currentDate}
        activeBranch={activeBranch}
        activeCategory={activeCategory}
        onOpenBranchPortal={() => setIsBranchPortalOpen(true)}
        onSelectCategory={handleSelectCategory}
        isRealtimeActive={isRealtimeActive}
        isCloudDbConnected={isCloudDbConnected}
        pendingReceiveCount={
          allowedCategories.includes('battery') || allowedCategories.includes('charger')
            ? pendingTransfersByBranch[activeBranchId] || 0
            : 0
        }
        isAdminAuthenticated={Boolean(adminToken)}
        onOpenAdminPortal={() => openAdminPortal(null, 'analytics')}
        branchLoginId={branchSession.loginId}
        branchRole={branchSession.role}
        canSwitchBranch={isMasterSession}
        onBranchLogout={() => handleBranchLogout()}
      />

      {/* Branch & Category Navigation Bar */}
      <div className="bg-slate-900 text-white px-3 sm:px-6 py-2 sm:py-2.5 border-b border-slate-800 shadow-xs flex items-center justify-between text-xs flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto min-w-0">
          {isMasterSession ? (
            <button
              onClick={() => setIsBranchPortalOpen(true)}
              className="inline-flex items-center flex-wrap gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-blue-900/60 hover:bg-blue-800 border border-blue-500/40 text-blue-200 font-bold transition-all cursor-pointer shadow-2xs text-xs max-w-full min-w-0"
              title="Click to view all 5 branches: 1-Chandravadni Naka, 2-Morar Battery Factory, 3-Yard City Center, 4-Service Center, 5-Vehicle Manufacturing Factory"
            >
              <Building2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="truncate">{activeBranch.name}</span>
              <span className="text-[10px] bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded font-normal shrink-0">
                Switch Branch (1-5)
              </span>
              {(allowedCategories.includes('battery') || allowedCategories.includes('charger')) &&
                (pendingTransfersByBranch[activeBranchId] || 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full font-extrabold animate-pulse shrink-0">
                    <BellRing className="w-3 h-3" />
                    <span>{pendingTransfersByBranch[activeBranchId]} Receive Goods</span>
                  </span>
                )}
            </button>
          ) : (
            <div className="inline-flex items-center flex-wrap gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-blue-900/40 border border-blue-500/30 text-blue-100 font-bold text-xs max-w-full min-w-0">
              <Lock className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="truncate">{activeBranch.name}</span>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono shrink-0">
                ID: {branchSession.loginId}
              </span>
              {(allowedCategories.includes('battery') || allowedCategories.includes('charger')) &&
                (pendingTransfersByBranch[activeBranchId] || 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full font-extrabold animate-pulse shrink-0">
                    <BellRing className="w-3 h-3" />
                    <span>{pendingTransfersByBranch[activeBranchId]} Receive Goods</span>
                  </span>
                )}
            </div>
          )}

          <span className="text-slate-600 hidden sm:inline">/</span>

          {/* Quick Category Switcher (Permitted Stock Registers Only) */}
          <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700 flex-wrap w-full sm:w-auto">
            {allowedCategories.includes('battery') && (
              <button
                onClick={() => handleSelectCategory('battery')}
                className={`flex-1 sm:flex-initial justify-center px-2.5 sm:px-3 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 text-[11px] sm:text-xs ${
                  activeCategory === 'battery'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <BatteryCharging className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">Battery Stock</span>
              </button>
            )}
            {allowedCategories.includes('charger') && (
              <button
                onClick={() => handleSelectCategory('charger')}
                className={`flex-1 sm:flex-initial justify-center px-2.5 sm:px-3 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 text-[11px] sm:text-xs ${
                  activeCategory === 'charger'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">Charger Stock</span>
              </button>
            )}
            {allowedCategories.includes('vehicle') && (
              <button
                onClick={() => handleSelectCategory('vehicle')}
                className={`flex-1 sm:flex-initial justify-center px-2.5 sm:px-3 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 text-[11px] sm:text-xs ${
                  activeCategory === 'vehicle'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Car className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">Vehicle Stock</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-400 hidden lg:inline">
            📍 {activeBranch.address}
          </span>
          {isMasterSession ? (
            <button
              onClick={() => setIsBranchPortalOpen(true)}
              className="text-xs text-blue-400 hover:text-blue-300 font-bold cursor-pointer flex items-center gap-1"
            >
              <span>All 5 Branches & Categories</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => setIsBranchPortalOpen(true)}
              className="text-xs text-blue-400 hover:text-blue-300 font-bold cursor-pointer flex items-center gap-1"
            >
              <span>Branch Categories ({allowedCategories.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Top Pop-up Notification at Receiver Branch when another branch sent batteries or chargers */}
      {((activeCategory === 'battery' && allowedCategories.includes('battery')) ||
        (activeCategory === 'charger' && allowedCategories.includes('charger'))) &&
        !isBranchPortalOpen &&
        pendingIncomingForActiveBranch.length > 0 &&
        dismissedPopupSignature !== pendingPopupSignature && (
          <div className="sticky top-[57px] z-25 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-slate-950 border-b-2 border-amber-600 shadow-lg px-4 sm:px-6 py-2.5 animate-in fade-in slide-in-from-top-2">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-950 text-amber-400 flex items-center justify-center shrink-0 shadow-xs">
                  <BellRing className="w-4 h-4 animate-bounce" />
                </div>
                <div className="text-xs">
                  <div className="font-black text-slate-950 leading-snug">
                    {pendingIncomingSummary.headline}
                  </div>
                  <div className="text-[11px] font-semibold text-slate-900/90">
                    Tap <strong>Receive {isChargerMode ? 'Charger' : 'Battery'}</strong> to inspect or edit details and add automatically into {activeBranch.shortName} stock.
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() =>
                    setReceiveModalState({
                      isOpen: true,
                      items: pendingIncomingForActiveBranch,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-extrabold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-colors cursor-pointer"
                >
                  <PackageCheck className="w-4 h-4" />
                  <span>
                    Receive {isChargerMode ? 'Charger' : 'Battery'} ({pendingIncomingSummary.totalUnits})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedPopupSignature(pendingPopupSignature)}
                  className="p-1 rounded-lg text-slate-900 hover:bg-amber-600/30 transition-colors cursor-pointer"
                  title="Dismiss top pop-up (pending list remains below)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Main Content Viewport */}
      {isBranchPortalOpen ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 pb-20 md:pb-6">
          <BranchCategoryPortal
            currentBranchId={activeBranchId}
            currentCategoryId={activeCategory}
            allowedBranchIds={allowedBranchIds}
            allowedCategories={allowedCategories}
            pendingTransfersByBranch={
              allowedCategories.includes('battery') || allowedCategories.includes('charger')
                ? pendingTransfersByBranch
                : {}
            }
            onSelectBranchAndCategory={handleSelectBranchAndCategory}
            onClose={() => setIsBranchPortalOpen(false)}
            isModal={false}
          />
        </main>
      ) : activeCategory === 'vehicle' && allowedCategories.includes('vehicle') ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 pb-20 md:pb-6 space-y-6">
          <VehicleStockView
            branch={activeBranch}
            allowedCategories={allowedCategories}
            canSwitchBranch={isMasterSession}
            onSwitchStockCategory={handleSelectCategory}
            onOpenBranchPortal={() => setIsBranchPortalOpen(true)}
            activeDate={currentDate}
            remoteVehicleRecords={vehicleRecords}
            isCloudDbConnected={isCloudDbConnected}
            currentLoginId={branchSession.loginId}
            isAdminAuthenticated={Boolean(adminToken)}
            onDownloadExcel={handleDownloadVehicleExcelGated}
            onSaveVehicleRecord={async (branchId, date, record) => {
              const saved = await apiSaveVehicleRecord(branchId, date, record);
              setVehicleRecords((prev) => {
                const next = {
                  ...prev,
                  [saved.key]: {
                    branchId,
                    date,
                    items: record,
                    updatedBy: saved.updatedBy || branchSession.loginId,
                    transactions: saved.transactions || prev[saved.key]?.transactions,
                    updatedAt: saved.updatedAt,
                  },
                };
                saveLocalVehicles(next);
                return next;
              });
            }}
          />
        </main>
      ) : (activeCategory === 'battery' && allowedCategories.includes('battery')) ||
        (activeCategory === 'charger' && allowedCategories.includes('charger')) ? (
        <main className="flex-1 max-w-7xl w-full min-w-0 mx-auto p-2.5 sm:p-6 pb-24 md:pb-6 space-y-4 sm:space-y-6">
          {/* TOP: Incoming Goods Notification Banner for Active Branch */}
          <ReceiveGoodsBanner
            activeBranch={activeBranch}
            transfers={activeCategoryTransfers}
            isReceiving={isReceivingGoods}
            onReceiveSelected={openReceiveModalForSelections}
            category={activeLedgerCategory}
          />

          {/* TOP: Workspace Toolbar & Date Bar (Moved to top per user request) */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-5 shadow-2xs space-y-3.5 sm:space-y-4 min-w-0 w-full">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 min-w-0">
              {/* Left: Date Switcher & Day Navigation & Cloud Status */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 sm:flex-wrap w-full md:w-auto min-w-0">
                <div
                  className={`flex items-center justify-between sm:justify-start rounded-lg p-1 transition-all w-full sm:w-auto min-w-0 ${
                    isViewingToday
                      ? 'bg-blue-50/90 border-2 border-blue-500 shadow-xs ring-2 ring-blue-500/20'
                      : 'bg-slate-50 border border-slate-300'
                  }`}
                >
                  <button
                    onClick={handlePrevDate}
                    disabled={currentIndex <= 0}
                    className="p-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-30 rounded hover:bg-slate-200 cursor-pointer shrink-0"
                    title="Previous Date"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 px-1 sm:px-3 py-0.5 sm:py-1 font-bold text-slate-900 text-xs sm:text-sm min-w-0 flex-1 sm:flex-initial">
                    <div className="inline-flex items-center gap-1 min-w-0">
                      <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 shrink-0" />
                      <select
                        value={currentDate}
                        onChange={(e) => handleSelectOrCreateDate(e.target.value)}
                        className="bg-transparent font-bold text-slate-900 focus:outline-none cursor-pointer text-xs sm:text-sm max-w-[138px] sm:max-w-none truncate"
                      >
                        {recordedDates.map((d) => (
                          <option key={d} value={d}>
                            {d} {d === todayIST ? '★ (Today)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {isViewingToday ? (
                      <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-[11px] font-extrabold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs shrink-0 whitespace-nowrap">
                        <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span>Today</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleJumpToTodayIST}
                        className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-[11px] font-bold rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
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
                      className="text-[11px] sm:text-xs text-slate-600 border border-slate-300 rounded px-1 sm:px-1.5 py-0.5 bg-white cursor-pointer focus:outline-blue-500 max-w-[116px] sm:max-w-none shrink-0"
                    />
                  </div>

                  <button
                    onClick={handleNextDate}
                    disabled={isViewingToday}
                    className="p-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-30 rounded hover:bg-slate-200 cursor-pointer shrink-0"
                    title={isViewingToday ? "Already at today's active ledger" : "Next Date / Tomorrow"}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:contents gap-2 w-full sm:w-auto">
                  <button
                    onClick={handleJumpToTodayIST}
                    className={`inline-flex items-center justify-center sm:justify-start gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-semibold rounded-lg border transition-all cursor-pointer truncate ${
                      isViewingToday
                        ? 'text-emerald-900 bg-emerald-50 border-emerald-400 font-bold shadow-2xs'
                        : 'text-amber-900 bg-amber-50 hover:bg-amber-100 border-amber-300'
                    }`}
                    title="Jump to today's date in India Standard Time"
                  >
                    {isViewingToday && <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>}
                    <span className="truncate">Today ({todayIST})</span>
                  </button>

                  <button
                    onClick={handleCreateNextDay}
                    className="inline-flex items-center justify-center sm:justify-start gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                    title="Create next day entry carrying forward today's closing stock"
                  >
                    <Plus className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span className="truncate">Next Day Carryover</span>
                  </button>

                  <button
                    onClick={() => setIsCloudModalOpen(true)}
                    className="inline-flex items-center justify-center sm:justify-start gap-1.5 px-2.5 py-2 sm:py-1.5 text-[11px] sm:text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 cursor-pointer"
                    title="View Cloud DBMS, Supabase & Cloudinary Cloud Space settings"
                  >
                    <Database className="w-3 h-3 text-emerald-600 shrink-0" />
                    <span className="hidden sm:inline">DBMS:</span>
                    <span className="font-semibold text-slate-800 truncate">
                      {saveState === 'saving'
                        ? 'Saving...'
                        : pendingSyncCount > 0
                        ? `Pending (${pendingSyncCount})`
                        : backendStatus?.supabaseReady
                        ? 'Supabase Saved'
                        : backendStatus?.online
                        ? 'Saved'
                        : 'Local Safe'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleManualSaveAndBackup(false)}
                    disabled={isCloudSpaceBackingUp}
                    className={`inline-flex items-center justify-center sm:justify-start gap-1.5 px-2.5 py-2 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg border transition-colors cursor-pointer ${
                      backendStatus?.cloudinary?.configured
                        ? 'text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border-indigo-300'
                        : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-300'
                    }`}
                    title={
                      backendStatus?.cloudinary?.configured
                        ? `Save & upload snapshot to Cloudinary Cloud Space (${backendStatus.cloudinary.cloudName})`
                        : 'Flush pending saves & create server backup snapshot (configure Cloudinary keys in Cloud DBMS settings for Cloud Space upload)'
                    }
                  >
                    {isCloudSpaceBackingUp ? (
                      <Cloud className="w-3.5 h-3.5 text-indigo-600 animate-pulse shrink-0" />
                    ) : (
                      <Save className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    )}
                    <span className="truncate">
                      {isCloudSpaceBackingUp
                        ? 'Backing up...'
                        : backendStatus?.cloudinary?.configured
                        ? 'Save & Cloud Space'
                        : 'Save & Backup'}
                    </span>
                  </button>

                  {!isChargerMode && (
                    <div className="col-span-2 sm:col-span-1 flex justify-center sm:block">
                      <ReferenceImageViewer />
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Quick Action Buttons with IN, OUT, and Both IN & OUT */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:flex-wrap w-full md:w-auto min-w-0">
                <div className="grid grid-cols-1 sm:flex sm:items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => setIsBarcodeScannerOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 border border-blue-700 rounded-lg shadow-xs transition-all cursor-pointer ring-2 ring-blue-500/20 w-full sm:w-auto"
                    title="Scan any barcode or QR code with high-speed camera scanner"
                  >
                    <Barcode className="w-4 h-4 text-white shrink-0" />
                    <span>Scan Barcode</span>
                  </button>

                  <button
                    onClick={() => {
                      setSerialModalInitialFilter('all');
                      setIsSerialModalOpen(true);
                    }}
                    className="inline-flex items-center justify-between sm:justify-start gap-2 px-3.5 py-2 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 border border-amber-500 rounded-lg shadow-xs transition-all cursor-pointer ring-1 ring-amber-400/50 w-full sm:w-auto"
                    title={
                      isChargerMode
                        ? 'Search charger serials, view batchwise stock, and trace complete history'
                        : 'Search battery serials, view batchwise stock, and trace complete history'
                    }
                  >
                    <span className="inline-flex items-center gap-2">
                      <Barcode className="w-4 h-4 text-slate-950 shrink-0" />
                      <span className="font-extrabold text-slate-950">Serial & Batch Tracker</span>
                    </span>
                    {unassignedCount > 0 ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-900 text-amber-300 font-bold shrink-0">
                        {unassignedCount} to Assign
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-800 text-white font-bold shrink-0">
                        All Serialized
                      </span>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:inline-flex sm:items-center rounded-lg border border-slate-300 bg-slate-100 p-1 sm:p-0.5 gap-1 sm:gap-0.5 shadow-2xs w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => openQuickEntryWithType('in')}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-2 sm:py-1.5 text-xs font-extrabold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-md transition-colors cursor-pointer"
                    title="Log Stock IN (+)"
                  >
                    <PlusCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>IN (+)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openQuickEntryWithType('out')}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-2 sm:py-1.5 text-xs font-extrabold text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-md transition-colors cursor-pointer"
                    title="Log Stock OUT (-) or Send to Another Branch"
                  >
                    <MinusCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>OUT (-)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openQuickEntryWithType('both')}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-2 sm:py-1.5 text-xs font-extrabold text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-300 rounded-md transition-colors cursor-pointer"
                    title="Log Both IN and OUT transactions together"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span>Both IN & OUT</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openQuickEntryWithType('transfer')}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-2 sm:py-1.5 text-xs font-extrabold text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-400 rounded-md transition-colors cursor-pointer"
                    title={
                      isChargerMode
                        ? 'Send charger from this branch to another branch with top receive notification'
                        : 'Send battery from this branch to another branch with top receive notification'
                    }
                  >
                    <Truck className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                    <span>Send to Branch</span>
                  </button>
                </div>

                <button
                  onClick={() => setIsWhatsAppOpen(true)}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs cursor-pointer w-full sm:w-auto"
                >
                  <Send className="w-3.5 h-3.5 shrink-0" />
                  <span>Dispatch to WhatsApp</span>
                </button>

                <div className="grid grid-cols-2 sm:inline-flex sm:items-center rounded-lg border border-slate-300 bg-white p-1 sm:p-0.5 gap-1 sm:gap-0.5 shadow-2xs w-full sm:w-auto">
                  <button
                    onClick={handleDownloadQuantityExcelGated}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 sm:py-1.5 text-[11px] sm:text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors cursor-pointer"
                    title={
                      adminToken
                        ? `Excel 1: Download ${isChargerMode ? 'Charger' : 'Battery'} Quantity Stock Excel (.xlsx)`
                        : 'Admin login required to download Quantity Excel (.xlsx)'
                    }
                  >
                    {!adminToken && <Lock className="w-3 h-3 text-emerald-700 shrink-0" />}
                    <Download className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span className="truncate">Quantity Excel</span>
                  </button>
                  <button
                    onClick={handleDownloadSerialHistoryExcelGated}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 sm:py-1.5 text-[11px] sm:text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors cursor-pointer"
                    title={
                      adminToken
                        ? `Excel 2: Download All ${isChargerMode ? 'Charger' : 'Battery'} Serial Numbers + Past/Dispatched History (.xlsx)`
                        : 'Admin login required to download Serials & History Excel (.xlsx)'
                    }
                  >
                    {!adminToken && <Lock className="w-3 h-3 text-blue-700 shrink-0" />}
                    <FileSpreadsheet className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                    <span className="truncate">Serials & History Excel</span>
                  </button>
                </div>
              </div>
            </div>

            {/* KPI Summary Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 pt-3 border-t border-slate-100">
              <div className="p-2.5 sm:p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] sm:text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
                  Opening Stock
                </span>
                <span className="text-lg sm:text-xl font-extrabold text-slate-900 tabular-nums">
                  {totals.openingStockTotal}
                </span>
                <span className="text-[10px] sm:text-[11px] text-slate-400 block mt-0.5">Standard models</span>
              </div>

              <div className="p-2.5 sm:p-3 bg-emerald-50/60 rounded-lg border border-emerald-200">
                <span className="text-[10px] sm:text-[11px] font-semibold text-emerald-700 uppercase tracking-wide block">
                  Inward (In Stock)
                </span>
                <span className="text-lg sm:text-xl font-extrabold text-emerald-700 tabular-nums">
                  +{totals.inStockTotal}
                </span>
                <span className="text-[10px] sm:text-[11px] text-emerald-600/80 block mt-0.5">
                  Received / Exchanged
                </span>
              </div>

              <div className="p-2.5 sm:p-3 bg-rose-50/60 rounded-lg border border-rose-200">
                <span className="text-[10px] sm:text-[11px] font-semibold text-rose-700 uppercase tracking-wide block">
                  Outward (Out Stock)
                </span>
                <span className="text-lg sm:text-xl font-extrabold text-rose-700 tabular-nums">
                  {totals.outStockTotal}
                </span>
                <span className="text-[10px] sm:text-[11px] text-rose-600/80 block mt-0.5">
                  Vehicles / Dealers
                </span>
              </div>

              <div className="p-2.5 sm:p-3 bg-blue-50/60 rounded-lg border border-blue-200">
                <span className="text-[10px] sm:text-[11px] font-semibold text-blue-700 uppercase tracking-wide block">
                  Today's Closing
                </span>
                <span className="text-lg sm:text-xl font-extrabold text-blue-800 tabular-nums">
                  {totals.closingStockTotal}
                </span>
                <span className="text-[10px] sm:text-[11px] text-blue-600/80 block mt-0.5">Units in store</span>
              </div>

              <div className="p-2.5 sm:p-3 bg-amber-50/60 rounded-lg border border-amber-200">
                <span className="text-[10px] sm:text-[11px] font-semibold text-amber-800 uppercase tracking-wide block">
                  Old For Repair
                </span>
                <span className="text-lg sm:text-xl font-extrabold text-amber-900 tabular-nums">
                  {totals.repair.closing}
                </span>
                <span className="text-[10px] sm:text-[11px] text-amber-700/80 block mt-0.5">
                  In: +{totals.repair.in} | Out: {totals.repair.out}
                </span>
              </div>

              <div className="p-2.5 sm:p-3 bg-indigo-50/60 rounded-lg border border-indigo-200">
                <span className="text-[10px] sm:text-[11px] font-semibold text-indigo-800 uppercase tracking-wide block">
                  Service Standby
                </span>
                <span className="text-lg sm:text-xl font-extrabold text-indigo-900 tabular-nums">
                  {totals.service.closing}
                </span>
                <span className="text-[10px] sm:text-[11px] text-indigo-600/80 block mt-0.5">Total pool units</span>
              </div>
            </div>
          </div>

          {/* Below: Batchwise Stock (Battery / Charger Models) & Serial Number History Search */}
          <BatchStockOverview
            currentRecord={currentRecord}
            columns={activeColumns}
            serials={activeSerialsMap}
            closingStock={totals.closingStock}
            activeBranchId={activeBranchId}
            category={activeLedgerCategory}
            onOpenAssignModal={(modelId, modelName, currentStock, initialTab) => {
              setAssignModal({
                isOpen: true,
                modelId,
                modelName,
                currentStock,
                initialTab,
              });
            }}
            onOpenSerialTrackerModal={(initialFilter) => {
              setSerialModalInitialFilter(initialFilter || 'all');
              setIsSerialModalOpen(true);
            }}
            onDownloadSerialExcel={handleDownloadSerialHistoryExcelGated}
            isAdminAuthenticated={Boolean(adminToken)}
            onUpdateSerial={(item) => handleUpdateSingleSerial(item, undefined, activeLedgerCategory)}
            onSelectSerialHistory={(item) => setSelectedSerialHistory(item)}
          />

        {/* The Excel Spreadsheet (Exact replica of user's photo) */}
        <section className="bg-white border border-slate-200 rounded-xl p-3 sm:p-5 shadow-2xs space-y-3 min-w-0 w-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0" />
                <span>
                  {isChargerMode
                    ? 'Charger Daily Inventory Spreadsheet'
                    : 'Battery Daily Inventory Spreadsheet'}
                </span>
                {backendStatus?.cloudinary?.configured && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
                    <Cloud className="w-3 h-3 text-indigo-600" />
                    <span>Cloudinary Dual-Excel Backed</span>
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Synced from last stock entry. Click any quantity/cause cell to edit, or click any Today&apos;s Stock {isChargerMode ? 'charger' : 'battery'} count to see its serial numbers in stock.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-2.5 flex-wrap w-full sm:w-auto">
              <button
                type="button"
                onClick={handleDownloadQuantityExcelGated}
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 sm:py-1 text-[11px] sm:text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md cursor-pointer"
                title={
                  adminToken
                    ? 'Download Excel 1: Quantity Stock Sheet (.xlsx)'
                    : 'Admin login required to download Quantity Stock Sheet (.xlsx)'
                }
              >
                {!adminToken && <Lock className="w-3 h-3 shrink-0" />}
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Quantity .xlsx</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadSerialHistoryExcelGated}
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 sm:py-1 text-[11px] sm:text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer"
                title={
                  adminToken
                    ? `Download Excel 2: All ${isChargerMode ? 'Charger' : 'Battery'} Serials & Past Outward History (.xlsx)`
                    : 'Admin login required to download Serials & History Excel (.xlsx)'
                }
              >
                {!adminToken && <Lock className="w-3 h-3 shrink-0" />}
                <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                <span>Serials & History .xlsx</span>
              </button>
              <button
                type="button"
                onClick={() => handleManualSaveAndBackup(true)}
                disabled={isCloudSpaceBackingUp}
                className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1 py-1.5 sm:py-0 text-xs font-semibold text-indigo-700 hover:text-indigo-900 cursor-pointer"
                title={
                  adminToken
                    ? 'Sync & back up both Quantity and Serial History Excels (.xlsx) to Cloudinary now'
                    : 'Admin login required to sync Excels to Cloud Space'
                }
              >
                {!adminToken && <Lock className="w-3 h-3 shrink-0" />}
                <Cloud className="w-3.5 h-3.5 shrink-0" />
                <span>{isCloudSpaceBackingUp ? 'Syncing...' : 'Sync Excels to Cloud'}</span>
              </button>
            </div>
          </div>

          <ExcelGrid
            record={currentRecord}
            columns={activeColumns}
            onUpdateRecord={(updated) => handleUpdateRecord(updated, false, undefined, activeLedgerCategory)}
            onAddColumn={handleAddColumn}
            tableRef={tableRef}
            serials={activeSerialsMap}
            activeBranchId={activeBranchId}
            category={activeLedgerCategory}
            onInspectModelSerials={(modelId, modelName, currentStock) => {
              setAssignModal({
                isOpen: true,
                modelId,
                modelName,
                currentStock,
                initialTab: 'manage_existing',
              });
            }}
          />

          {/* Bottom Action & Dispatch Bar directly under Spreadsheet */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-100 gap-3">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <span className="font-semibold text-slate-700">Daily Workflow:</span>
              <span>1. Direct cell edits or Log Transaction</span>
              <span>→</span>
              <span>2. Click &quot;Send WhatsApp&quot;</span>
              <span>→</span>
              <span>3. Send verified photo & report</span>
            </div>

            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                onClick={() => setIsQuickEntryOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                title="Open quick update dialog to log inward/outward changes"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>Update Ledger</span>
              </button>

              <button
                onClick={() => setIsWhatsAppOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs cursor-pointer"
                title="Send verified sheet photo and summary to WhatsApp"
              >
                <Send className="w-3.5 h-3.5 shrink-0" />
                <span>Send WhatsApp</span>
              </button>
            </div>
          </div>
        </section>

        {/* Authorized Owner & Admin WhatsApp Dispatch Section */}
        <section className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-5 shadow-2xs min-w-0 w-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Authorized Owner & Admin (WhatsApp Dispatch)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Official stock ledger, verified Excel snapshots, and inward/outward alerts are routed directly to Owner & Admin.
              </p>
            </div>

            <button
              onClick={() => setIsTeamModalOpen(true)}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer self-start sm:self-auto shrink-0"
            >
              Contact Settings
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {teamMembers.map((member) => (
              <div
                key={member.id}
                className="p-3.5 sm:p-4 bg-gradient-to-br from-emerald-50/60 via-slate-50 to-white rounded-xl border border-emerald-200 text-xs flex flex-col justify-between shadow-xs hover:border-emerald-300 transition-all min-w-0"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-extrabold text-sm sm:text-base text-slate-900 tracking-tight">
                      {member.name}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shrink-0">
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                      <span>{member.role || 'Owner & Admin'}</span>
                    </span>
                  </div>
                  <div className="text-emerald-700 text-xs font-medium mt-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                    <span>Primary Stock Administrator & Owner</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-emerald-100 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3">
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
                      `Hi ${member.name}, here is the current ${isChargerMode ? 'charger' : 'battery'} stock register summary for ${currentRecord.date}: ${totals.closingStockTotal} units closing stock.`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors cursor-pointer w-full sm:w-auto"
                  >
                    <Send className="w-3.5 h-3.5 shrink-0" />
                    <span>Direct WhatsApp Chat</span>
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 pb-20 md:pb-6">
          <BranchCategoryPortal
            currentBranchId={activeBranchId}
            currentCategoryId={activeCategory}
            allowedBranchIds={allowedBranchIds}
            allowedCategories={allowedCategories}
            pendingTransfersByBranch={
              allowedCategories.includes('battery') || allowedCategories.includes('charger')
                ? pendingTransfersByBranch
                : {}
            }
            onSelectBranchAndCategory={handleSelectBranchAndCategory}
            onClose={() => setIsBranchPortalOpen(false)}
            isModal={false}
          />
        </main>
      )}

      {/* Mobile/Compact Persistent Sticky Action Bar for Battery & Charger Ledgers */}
      {!isBranchPortalOpen &&
        ((activeCategory === 'battery' && allowedCategories.includes('battery')) ||
          (activeCategory === 'charger' && allowedCategories.includes('charger'))) && (
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
        )}

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
        columns={activeColumns}
        activeBranch={activeBranch}
        initialEntryType={quickEntryInitialType}
        onSaveRecord={(updated, andWhatsApp, serialEntries) =>
          handleUpdateRecord(updated, andWhatsApp, serialEntries, activeLedgerCategory)
        }
        onCreateBranchTransfer={handleCreateBranchTransfer}
        recordedDates={recordedDates}
        onSelectDate={handleSelectOrCreateDate}
        serials={activeSerialsMap}
        closingStock={totals.closingStock}
        category={activeLedgerCategory}
      />

      <ReceiveTransferModal
        isOpen={receiveModalState.isOpen}
        onClose={() => setReceiveModalState({ isOpen: false, items: [] })}
        activeBranch={activeBranch}
        pendingItems={receiveModalState.items}
        columns={
          receiveModalState.items[0]?.transfer.category === 'charger'
            ? chargerColumns
            : columns
        }
        defaultReceivingDate={currentDate}
        isSubmitting={isReceivingGoods}
        onConfirmSave={handleConfirmReceiveTransfer}
        category={
          receiveModalState.items[0]?.transfer.category === 'charger' ? 'charger' : 'battery'
        }
      />

      <WhatsAppDispatchModal
        isOpen={isWhatsAppOpen}
        onClose={() => setIsWhatsAppOpen(false)}
        record={currentRecord}
        columns={activeColumns}
        teamMembers={teamMembers}
        tableElementId={isChargerMode ? 'charger-stock-sheet-table' : 'battery-stock-sheet-table'}
        category={activeLedgerCategory}
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
        adminToken={adminToken}
        onOpenAdminLogin={(reason, tab) => {
          setIsCloudModalOpen(false);
          openAdminPortal(reason, tab || 'backups');
        }}
      />

      {adminPortalModal}

      <SerialTrackerModal
        isOpen={isSerialModalOpen}
        onClose={() => setIsSerialModalOpen(false)}
        serials={activeSerialsMap}
        columns={activeColumns}
        activeBranchId={activeBranchId}
        initialStatusFilter={serialModalInitialFilter}
        onDownloadSerialExcel={handleDownloadSerialHistoryExcelGated}
        isAdminAuthenticated={Boolean(adminToken)}
        category={activeLedgerCategory}
        onSaveSerial={(item) => handleUpdateSingleSerial(item, undefined, activeLedgerCategory)}
      />

      <AssignSerialModal
        isOpen={assignModal.isOpen}
        onClose={() => setAssignModal((prev) => ({ ...prev, isOpen: false }))}
        modelId={assignModal.modelId}
        modelName={assignModal.modelName}
        currentStock={assignModal.currentStock}
        initialTab={assignModal.initialTab}
        existingSerials={Object.values(activeSerialsMap).filter(
          (s) =>
            (s.branchId || DEFAULT_BRANCH_ID) === activeBranchId &&
            (s.modelId === assignModal.modelId ||
              s.modelName === assignModal.modelName ||
              s.batchNo === assignModal.modelName)
        )}
        activeDate={currentRecord.date}
        onSaveSerials={(items) => handleBulkSaveSerials(items, activeLedgerCategory)}
        onUpdateSerial={(item, prevSn) =>
          handleUpdateSingleSerial(item, prevSn, activeLedgerCategory)
        }
        category={activeLedgerCategory}
      />

      <BarcodeScannerModal
        isOpen={isBarcodeScannerOpen}
        onClose={() => setIsBarcodeScannerOpen(false)}
        onScanComplete={handleBarcodeScanComplete}
        category={activeLedgerCategory}
      />

      {/* Direct Lifecycle History Timeline Modal from Top Search Bar */}
      {selectedSerialHistory && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg flex flex-col overflow-y-auto overscroll-contain animate-in fade-in zoom-in-95 my-auto"
            style={{ maxHeight: 'min(90vh, calc(100% - 2rem))' }}
          >
            <div className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 bg-slate-900 text-white shrink-0 rounded-t-xl">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-400 text-slate-950 flex items-center justify-center font-bold">
                  <Barcode className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">
                    {isChargerMode ? 'Charger' : 'Battery'} Serial: {selectedSerialHistory.serialNo}
                  </h3>
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

            <div className="p-6 space-y-4 text-xs">
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
                  <div className="flex items-center gap-1.5">
                    {selectedSerialHistory.inwardBy && (
                      <span className="font-mono text-[10px] font-bold bg-emerald-100 text-emerald-900 px-1.5 py-0.5 rounded border border-emerald-300">
                        By: {selectedSerialHistory.inwardBy}
                      </span>
                    )}
                    <span className="font-mono text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-200">
                      {selectedSerialHistory.inwardDate}
                    </span>
                  </div>
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
                    <div className="flex items-center gap-1.5">
                      {selectedSerialHistory.outwardBy && (
                        <span className="font-mono text-[10px] font-bold bg-rose-100 text-rose-900 px-1.5 py-0.5 rounded border border-rose-300">
                          By: {selectedSerialHistory.outwardBy}
                        </span>
                      )}
                      <span className="font-mono text-rose-800 bg-white px-2 py-0.5 rounded border border-rose-200">
                        {selectedSerialHistory.outwardDate}
                      </span>
                    </div>
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
                  {isChargerMode ? 'Charger' : 'Battery'} has not been dispatched yet. It is currently in store inventory.
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
                        <div className="flex items-center gap-1.5">
                          {evt.performedBy && (
                            <span className="font-mono text-[10px] font-bold bg-indigo-50 text-indigo-800 px-1.5 py-0.5 rounded border border-indigo-200">
                              ID: {evt.performedBy}
                            </span>
                          )}
                          <span className="font-mono text-slate-500">{evt.date}</span>
                        </div>
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

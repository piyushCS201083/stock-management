export interface BatteryColumn {
  id: string;
  name: string;
  isSpecial?: boolean; // For Total, OLD BATTERY FOR REPAIR, SERVICE BATTERY TOTAL
}

export interface BranchInfo {
  id: string;
  number: number;
  name: string;
  shortName: string;
  subtitle: string;
  code: string;
  address?: string;
  contactPerson?: string;
  phone?: string;
  badge?: string;
}

export type StockCategoryId = 'battery' | 'charger' | 'vehicle';

export interface StockCategoryInfo {
  id: StockCategoryId;
  name: string;
  tagline: string;
  badge?: string;
}

export const BRANCHES: BranchInfo[] = [
  {
    id: 'chandravadni_naka',
    number: 1,
    name: '1 - Chandravadni Naka',
    shortName: 'Chandravadni Naka',
    subtitle: 'Main Central Depot & Stock Register',
    code: 'CN-01',
    address: 'Chandravadni Naka, Lashkar / Main Depot',
    contactPerson: 'Piyush Shivhare (Owner & Admin)',
    phone: '9009156696',
    badge: 'Main Central Branch',
  },
  {
    id: 'morar',
    number: 2,
    name: '2 - Morar Battery Factory',
    shortName: 'Morar Battery Factory',
    subtitle: 'Morar Battery Manufacturing & Distribution Factory',
    code: 'MR-02',
    address: 'Morar Battery Factory / Market Area',
    contactPerson: 'Factory Incharge',
    badge: 'Battery Factory',
  },
  {
    id: 'yard_city_center',
    number: 3,
    name: '3 - Yard City Center',
    shortName: 'Yard City Center',
    subtitle: 'City Center Logistics Yard & Transit Hub',
    code: 'CC-03',
    address: 'City Center Yard Depot',
    contactPerson: 'Yard Supervisor',
    badge: 'Logistics Yard',
  },
  {
    id: 'service_center',
    number: 4,
    name: '4 - Service Center',
    shortName: 'Service Center',
    subtitle: 'Repairs, Testing & Standby Battery Unit',
    code: 'SC-04',
    address: 'Workshop & Technical Service Depot',
    contactPerson: 'Service Lead',
    badge: 'Technical & Repairs',
  },
  {
    id: 'vehicle_factory',
    number: 5,
    name: '5 - Vehicle Manufacturing Factory',
    shortName: 'Vehicle Manufacturing Factory',
    subtitle: 'EV Vehicle Assembly, Chassis & Manufacturing Plant',
    code: 'VF-05',
    address: 'Vehicle Manufacturing Factory Unit',
    contactPerson: 'Vehicle Factory Head',
    badge: 'Manufacturing Factory',
  },
];

export const DEFAULT_CHARGER_COLUMNS: BatteryColumn[] = [
  { id: '48v_15a_smart', name: '48V 15A Smart' },
  { id: '60v_20a_fast', name: '60V 20A Fast' },
  { id: '72v_25a_heavy', name: '72V 25A Heavy Duty' },
  { id: '48_60v_universal', name: '48V/60V Universal' },
  { id: '72v_30a_lithium', name: '72V 30A Lithium' },
  { id: 'old_charger_repair', name: 'Charger for Repair' },
];

export const DEFAULT_VEHICLE_COLUMNS: BatteryColumn[] = [
  { id: 'e_rickshaw_passenger', name: 'E-Rickshaw Passenger' },
  { id: 'e_rickshaw_loader', name: 'E-Rickshaw Loader / Cargo' },
  { id: 'e_scooter_low_speed', name: 'E-Scooter (Low Speed)' },
  { id: 'e_scooter_high_speed', name: 'E-Scooter (High Speed)' },
  { id: 'e_auto_l5', name: 'E-Auto / L5 Electric' },
  { id: 'chassis_under_assembly', name: 'Chassis / Under Assembly' },
];

export const DEFAULT_BRANCH_ID = 'chandravadni_naka';

export const ALL_STOCK_CATEGORIES: StockCategoryId[] = ['battery', 'charger', 'vehicle'];

export type BranchAccessRole = 'branch' | 'master';

export interface BranchLoginAccountMeta {
  loginId: string;
  role: BranchAccessRole;
  branchId: string | null;
  allowedBranchIds: string[];
  allowedCategories: StockCategoryId[];
  label: string;
  shortLabel: string;
  isBuiltIn?: boolean;
}

export interface BranchAuthSession {
  loginId: string;
  role: BranchAccessRole;
  branchId: string | null;
  allowedBranchIds: string[];
  allowedCategories: StockCategoryId[];
  label: string;
  expiresAt: string;
}

export interface BranchCredentialSummary {
  loginId: string;
  role: BranchAccessRole;
  branchId: string | null;
  allowedBranchIds: string[];
  allowedCategories: StockCategoryId[];
  label: string;
  isBuiltIn: boolean;
  isCustomPassword: boolean;
  version: number;
  updatedAt: string;
}

export const BRANCH_LOGIN_ACCOUNTS: BranchLoginAccountMeta[] = [
  {
    loginId: 'administrator',
    role: 'master',
    branchId: null,
    allowedBranchIds: BRANCHES.map((b) => b.id),
    allowedCategories: ['battery', 'charger', 'vehicle'],
    label: 'Administrator (Master — All 5 Branches)',
    shortLabel: 'Master (All Branches)',
    isBuiltIn: true,
  },
  {
    loginId: 'c',
    role: 'branch',
    branchId: 'chandravadni_naka',
    allowedBranchIds: ['chandravadni_naka'],
    allowedCategories: ['battery', 'charger', 'vehicle'],
    label: '1 - Chandravadni Naka',
    shortLabel: 'Chandravadni Naka',
    isBuiltIn: true,
  },
  {
    loginId: 'm',
    role: 'branch',
    branchId: 'morar',
    allowedBranchIds: ['morar'],
    allowedCategories: ['battery', 'charger', 'vehicle'],
    label: '2 - Morar Battery Factory',
    shortLabel: 'Morar Battery Factory',
    isBuiltIn: true,
  },
  {
    loginId: 'y',
    role: 'branch',
    branchId: 'yard_city_center',
    allowedBranchIds: ['yard_city_center'],
    allowedCategories: ['battery', 'charger', 'vehicle'],
    label: '3 - Yard City Center',
    shortLabel: 'Yard City Center',
    isBuiltIn: true,
  },
  {
    loginId: 's',
    role: 'branch',
    branchId: 'service_center',
    allowedBranchIds: ['service_center'],
    allowedCategories: ['battery', 'charger', 'vehicle'],
    label: '4 - Service Center',
    shortLabel: 'Service Center',
    isBuiltIn: true,
  },
  {
    loginId: 'v',
    role: 'branch',
    branchId: 'vehicle_factory',
    allowedBranchIds: ['vehicle_factory'],
    allowedCategories: ['battery', 'charger', 'vehicle'],
    label: '5 - Vehicle Manufacturing Factory',
    shortLabel: 'Vehicle Factory',
    isBuiltIn: true,
  },
];

export function getBatteryRecordKey(branchId: string | undefined, date: string): string {
  const normalizedBranch = branchId && branchId.trim() ? branchId.trim() : DEFAULT_BRANCH_ID;
  if (normalizedBranch === DEFAULT_BRANCH_ID) {
    return date;
  }
  return `${normalizedBranch}::${date}`;
}

export function parseBatteryRecordKey(key: string): { branchId: string; date: string } {
  const idx = key.indexOf('::');
  if (idx === -1) {
    return { branchId: DEFAULT_BRANCH_ID, date: key };
  }
  return {
    branchId: key.slice(0, idx) || DEFAULT_BRANCH_ID,
    date: key.slice(idx + 2),
  };
}

export interface StockTransactionEntry {
  id: string;
  timestamp: string; // ISO string
  date: string; // DD-MM-YYYY
  branchId: string;
  category: StockCategoryId;
  action:
    | 'in'
    | 'out'
    | 'repair_in'
    | 'repair_out'
    | 'service'
    | 'transfer_out'
    | 'transfer_in'
    | 'adjustment';
  modelId: string;
  modelName: string;
  quantity: number; // positive for IN, negative for OUT
  cause?: string;
  partner?: string;
  serialNos?: string[];
  performedBy: string; // authoritative loginId that recorded the transaction
}

export interface DayRecord {
  date: string; // "DD-MM-YYYY" e.g. "31-10-2026"
  branchId?: string; // Defaults to 'chandravadni_naka'
  // Opening stock values by column ID
  stock: Record<string, number>;
  // Inward additions by column ID
  inStock: Record<string, number>;
  // Inward causes/remarks
  inCause: Record<string, string>;
  // Outward deductions by column ID (negative numbers like -1 or 0)
  outStock: Record<string, number>;
  // Outward causes/remarks
  outCause: Record<string, string>;
  // Total causes (overrides or auto-summaries)
  totalInCause?: string;
  totalOutCause?: string;
  // Repair battery causes
  repairInCause?: string;
  repairOutCause?: string;
  // Metadata
  lastModified?: string;
  lastModifiedBy?: string;
  transactions?: StockTransactionEntry[];
  notes?: string;
  isAutoGenerated?: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  phone: string; // e.g. "919876543210" with country code
  active: boolean;
}

export interface BatteryMovementEvent {
  id: string;
  timestamp: string; // ISO string
  date: string; // DD-MM-YYYY
  type: 'in' | 'out' | 'repair_in' | 'repair_out' | 'service';
  cause: string;
  partner?: string; // e.g. "Luvkush", "Aman Wadhwani"
  vehicleOrLocation?: string; // e.g. "Service center", "Morar"
  branchId?: string;
  notes?: string;
  performedBy?: string; // loginId that performed this movement
}

export interface BatterySerialItem {
  serialNo: string;
  batchNo?: string;
  modelId: string;
  modelName: string;
  branchId?: string;
  status: 'in_stock' | 'dispatched' | 'in_repair' | 'service_standby';
  inwardDate: string;
  inwardCause?: string;
  inwardPartner?: string;
  inwardBy?: string;
  outwardDate?: string;
  outwardCause?: string;
  outwardPartner?: string;
  outwardBy?: string;
  lastUpdatedBy?: string;
  currentHolderOrLocation?: string;
  history: BatteryMovementEvent[];
}

export interface BranchTransferItem {
  id: string;
  modelId: string;
  modelName: string;
  quantity: number;
  serialNos?: string[];
  notes?: string;
  received?: boolean;
  receivedAt?: string;
}

export interface BranchTransfer {
  id: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  date: string; // DD-MM-YYYY
  category: 'battery' | 'charger';
  items: BranchTransferItem[];
  partner?: string;
  notes?: string;
  status: 'pending' | 'partial' | 'received';
  createdAt: string;
  createdBy?: string;
  receivedAt?: string;
  receivedBy?: string;
  receivedByLoginId?: string;
}

export const DEFAULT_BATTERY_COLUMNS: BatteryColumn[] = [
  { id: '60x24_old', name: '60×24 OLD' },
  { id: '60x24_flat', name: '60×24 FLAT' },
  { id: '60x30_old', name: '60×30 OLD' },
  { id: '60x30_flat', name: '60×30 FLAT' },
  { id: '60x36_old', name: '60×36 OLD' },
  { id: '60x36_flat', name: '60×36 FLAT' },
  { id: '60x38_magnus', name: '60×38 MAGNUS' },
  { id: '48x30_old', name: '48×30 Old' },
  { id: '60x45_flat', name: '60×45 Flat' },
];

// Baseline exact official record from uploaded Excel photo dated 31-10-2026
export const INITIAL_RECORD_31_10_2026: DayRecord = {
  date: '31-10-2026',
  stock: {
    '60x24_old': 2,
    '60x24_flat': 0,
    '60x30_old': 0,
    '60x30_flat': 1,
    '60x36_old': 0,
    '60x36_flat': 2,
    '60x38_magnus': 0,
    '48x30_old': 1,
    '60x45_flat': 1,
    'repair': 0,
    'service': 2,
  },
  inStock: {
    '60x24_old': 0,
    '60x24_flat': 1,
    '60x30_old': 0,
    '60x30_flat': 1,
    '60x36_old': 0,
    '60x36_flat': 0,
    '60x38_magnus': 0,
    '48x30_old': 0,
    '60x45_flat': 0,
    'repair': 1,
    'service': 0,
  },
  inCause: {
    '60x24_flat': 'Service center\nse, luvkush le\nkar aaya',
    '60x30_flat': 'Service center\nse, luvkush le\nkar aaya',
  },
  outStock: {
    '60x24_old': 0,
    '60x24_flat': 0,
    '60x30_old': 0,
    '60x30_flat': 0,
    '60x36_old': 0,
    '60x36_flat': 0,
    '60x38_magnus': 0,
    '48x30_old': 0,
    '60x45_flat': 0,
    'repair': -1,
    'service': 0,
  },
  outCause: {},
  totalInCause: '1.60-24 flat -service\ncenter\n2.60-24 flat -service\ncenter',
  totalOutCause: '',
  repairInCause: '48-30\nMAA SATI SE',
  repairOutCause: '48-30\nMORAR BHEJHI\nSONU BHAIYA\nLEKE GYE',
  lastModified: new Date().toISOString(),
  notes: 'Official live baseline from verified Excel photo dated 31-10-2026',
};

export const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'piyush_shivhare',
    name: 'Piyush Shivhare',
    role: 'Owner & Admin',
    phone: '9009156696',
    active: true,
  },
];

// Baseline authentic serial numbers from 31-10-2026 sheet transactions
export const INITIAL_BASELINE_SERIALS: Record<string, BatterySerialItem> = {
  'BAT-6024F-101': {
    serialNo: 'BAT-6024F-101',
    batchNo: '60×24 FLAT',
    modelId: '60x24_flat',
    modelName: '60×24 FLAT',
    status: 'in_stock',
    inwardDate: '31-10-2026',
    inwardPartner: 'Luvkush (Service Center)',
    inwardCause: 'Service center se, luvkush le kar aaya',
    history: [
      {
        id: 'evt_1',
        timestamp: '2026-10-31T09:30:00.000Z',
        date: '31-10-2026',
        type: 'in',
        cause: 'Service center se, luvkush le kar aaya',
        partner: 'Luvkush (Service Center)',
      },
    ],
  },
  'BAT-6030F-201': {
    serialNo: 'BAT-6030F-201',
    batchNo: '60×30 FLAT',
    modelId: '60x30_flat',
    modelName: '60×30 FLAT',
    status: 'in_stock',
    inwardDate: '31-10-2026',
    inwardPartner: 'Luvkush (Service Center)',
    inwardCause: 'Service center se, luvkush le kar aaya',
    history: [
      {
        id: 'evt_2',
        timestamp: '2026-10-31T09:45:00.000Z',
        date: '31-10-2026',
        type: 'in',
        cause: 'Service center se, luvkush le kar aaya',
        partner: 'Luvkush (Service Center)',
      },
    ],
  },
  'BAT-4830O-REP1': {
    serialNo: 'BAT-4830O-REP1',
    batchNo: '48×30 Old',
    modelId: 'repair',
    modelName: 'OLD BATTERY FOR REPAIR',
    status: 'dispatched',
    inwardDate: '31-10-2026',
    inwardPartner: 'Maa Sati Transport',
    inwardCause: '48-30 MAA SATI SE',
    outwardDate: '31-10-2026',
    outwardPartner: 'Sonu Bhaiya (Morar Dealer / Vehicle)',
    outwardCause: '48-30 MORAR BHEJHI SONU BHAIYA LEKE GYE',
    history: [
      {
        id: 'evt_3a',
        timestamp: '2026-10-31T08:15:00.000Z',
        date: '31-10-2026',
        type: 'repair_in',
        cause: '48-30 MAA SATI SE',
        partner: 'Maa Sati Transport',
      },
      {
        id: 'evt_3b',
        timestamp: '2026-10-31T11:00:00.000Z',
        date: '31-10-2026',
        type: 'out',
        cause: '48-30 MORAR BHEJHI SONU BHAIYA LEKE GYE',
        partner: 'Sonu Bhaiya',
        vehicleOrLocation: 'Morar Hub Vehicle',
      },
    ],
  },
};


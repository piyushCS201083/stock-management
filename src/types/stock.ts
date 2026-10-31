export interface BatteryColumn {
  id: string;
  name: string;
  isSpecial?: boolean; // For Total, OLD BATTERY FOR REPAIR, SERVICE BATTERY TOTAL
}

export interface DayRecord {
  date: string; // "DD-MM-YYYY" e.g. "31-10-2026"
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
  notes?: string;
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
  notes?: string;
}

export interface BatterySerialItem {
  serialNo: string;
  batchNo?: string;
  modelId: string;
  modelName: string;
  status: 'in_stock' | 'dispatched' | 'in_repair' | 'service_standby';
  inwardDate: string;
  inwardCause?: string;
  inwardPartner?: string;
  outwardDate?: string;
  outwardCause?: string;
  outwardPartner?: string;
  currentHolderOrLocation?: string;
  history: BatteryMovementEvent[];
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
    id: 'piyush',
    name: 'Piyush Shivhare',
    role: 'Owner & Admin',
    phone: '919826000000',
    active: true,
  },
  {
    id: 'luvkush',
    name: 'Luvkush (Service Center)',
    role: 'Service Center & Transport',
    phone: '919827000005',
    active: true,
  },
  {
    id: 'sonu_bhaiya',
    name: 'Sonu Bhaiya',
    role: 'Logistics & Morar Transport',
    phone: '919827000001',
    active: true,
  },
  {
    id: 'nikhil',
    name: 'Nikhil (Morar)',
    role: 'Morar Hub Dispatcher',
    phone: '919827000002',
    active: true,
  },
  {
    id: 'reena_ent',
    name: 'Reena Enterprises Rep',
    role: 'Dealer & Service Coordinator',
    phone: '919827000003',
    active: true,
  },
  {
    id: 'store_staff',
    name: 'Store Counter / Workshop',
    role: 'Inventory Manager',
    phone: '919827000004',
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


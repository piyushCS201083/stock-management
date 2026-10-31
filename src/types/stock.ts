export interface BatteryColumn {
  id: string;
  name: string;
  isSpecial?: boolean; // For Total, OLD BATTERY FOR REPAIR, SERVICE BATTERY TOTAL
}

export interface DayRecord {
  date: string; // "DD-MM-YYYY" e.g. "27-10-2026"
  // Opening stock values by column ID
  stock: Record<string, number>;
  // Inward additions by column ID
  inStock: Record<string, number>;
  // Inward causes/remarks
  inCause: Record<string, string>;
  // Outward deductions by column ID (negative numbers like -1 or positive deductions)
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

export const INITIAL_RECORD_27_10_2026: DayRecord = {
  date: '27-10-2026',
  stock: {
    '60x24_old': 2,
    '60x24_flat': 1,
    '60x30_old': 1,
    '60x30_flat': 0,
    '60x36_old': 1,
    '60x36_flat': 0,
    '60x38_magnus': 1,
    '48x30_old': 1,
    '60x45_flat': 1,
    'repair': 0,
    'service': 2,
  },
  inStock: {
    '60x24_old': 0,
    '60x24_flat': 0,
    '60x30_old': 0,
    '60x30_flat': 1,
    '60x36_old': 1,
    '60x36_flat': 0,
    '60x38_magnus': 0,
    '48x30_old': 0,
    '60x45_flat': 0,
    'repair': 1,
    'service': 0,
  },
  inCause: {
    '60x30_flat': 'Nikhil leke aaya morar se',
    '60x36_old': 'wapas aai - exchange Reena ent see',
  },
  outStock: {
    '60x24_old': 0,
    '60x24_flat': -1,
    '60x30_old': -1,
    '60x30_flat': 0,
    '60x36_old': 0,
    '60x36_flat': 0,
    '60x38_magnus': 0,
    '48x30_old': 0,
    '60x45_flat': 0,
    'repair': -1,
    'service': 0,
  },
  outCause: {
    '60x24_flat': 'gaadi mai lagi , aman wadhwani',
    '60x30_old': 'dealer ko , reena enterprises',
  },
  totalInCause: '1. 60-30-morar\n2. 60-36old-return',
  totalOutCause: '1. aman wadhwani\n2. reena enterprises',
  repairInCause: '48-30\nMAA SATI SE',
  repairOutCause: '48-30\nMORAR BHEJHI\nSONU BHAIYA\nLEKE GYE',
  lastModified: '2026-10-27T18:30:00.000Z',
  notes: 'Regular daily ledger entry matching WhatsApp sheet photo',
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

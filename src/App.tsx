import React, { useState, useEffect, useRef } from 'react';
import {
  BatteryColumn,
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
import { exportRecordToExcel, exportAllRecordsToExcel } from './utils/excelExport';
import { Header } from './components/Header';
import { ExcelGrid } from './components/ExcelGrid';
import { QuickEntryModal } from './components/QuickEntryModal';
import { WhatsAppDispatchModal } from './components/WhatsAppDispatchModal';
import { TeamManagementModal } from './components/TeamManagementModal';
import { ReferenceImageViewer } from './components/ReferenceImageViewer';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Send,
  FileSpreadsheet,
  Download,
  Upload,
  Users,
  RotateCcw,
  Sparkles,
  CheckCircle,
  HelpCircle,
  Eye,
} from 'lucide-react';

export default function App() {
  const [records, setRecords] = useState<Record<string, DayRecord>>(() => loadRecords());
  const [columns, setColumns] = useState<BatteryColumn[]>(() => loadColumns());
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => loadTeamMembers());

  // Current active date (defaults to the one with data e.g. 27-10-2026 or most recent)
  const [currentDate, setCurrentDate] = useState<string>(() => {
    const dates = Object.keys(records);
    return dates.length > 0 ? dates[0] : '27-10-2026';
  });

  // Modal states
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);

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

  // Update records in state and storage
  const handleUpdateRecord = (updated: DayRecord, andTriggerWhatsApp = false) => {
    const newRecords = { ...records, [updated.date]: updated };
    setRecords(newRecords);
    saveRecords(newRecords);

    showToast(`Updated stock sheet for ${updated.date}`);

    if (andTriggerWhatsApp) {
      setIsWhatsAppOpen(true);
    }
  };

  const showToast = (msg: string) => {
    setNotificationToast(msg);
    setTimeout(() => setNotificationToast(null), 3000);
  };

  // Add battery column
  const handleAddColumn = (name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (columns.some((c) => c.id === id)) {
      showToast('Column already exists!');
      return;
    }
    const newCol: BatteryColumn = { id, name };
    const updated = [...columns, newCol];
    setColumns(updated);
    saveColumns(updated);
    showToast(`Added battery model: ${name}`);
  };

  // Create next day entry carrying over today's closing stock
  const handleCreateNextDay = () => {
    const nextDayRecord = createNextDayRecord(currentRecord, columns);
    const newRecords = { ...records, [nextDayRecord.date]: nextDayRecord };
    setRecords(newRecords);
    saveRecords(newRecords);
    setCurrentDate(nextDayRecord.date);
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

  // Reset to original photo sample
  const handleResetToPhoto = () => {
    if (window.confirm('Reset this date back to original values from the WhatsApp photo?')) {
      const initial = loadRecords();
      setRecords(initial);
      saveRecords(initial);
      setCurrentDate('27-10-2026');
      showToast('Reset to original photo record.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-900 font-sans">
      {/* Top Bar adhering to Top Bar Contract */}
      <Header
        onOpenQuickEntry={() => setIsQuickEntryOpen(true)}
        onOpenWhatsAppDispatch={() => setIsWhatsAppOpen(true)}
        onOpenTeamModal={() => setIsTeamModalOpen(true)}
        onExportExcel={() => exportRecordToExcel(currentRecord, columns)}
        currentDate={currentDate}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Workspace Toolbar & Date Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Left: Date Switcher & Day Navigation */}
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
                        {d} {d === '27-10-2026' ? '(Photo Sample)' : ''}
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
                onClick={handleCreateNextDay}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                title="Create next day entry carrying forward today's closing stock"
              >
                <Plus className="w-3.5 h-3.5 text-blue-600" />
                <span>Next Day Carryover</span>
              </button>

              <ReferenceImageViewer />
            </div>

            {/* Right: Quick Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
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
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                title="Reset to 27-10-2026 photo reference"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Sample</span>
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
              <span className="text-slate-400">Next day automation:</span>
              <span className="text-blue-700 font-medium">Closing stock auto-rolls into Opening stock!</span>
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
        onSaveRecord={(updated, andWhatsApp) => handleUpdateRecord(updated, andWhatsApp)}
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
        onSaveTeam={(updated) => {
          setTeamMembers(updated);
          saveTeamMembers(updated);
          showToast('Team members updated');
        }}
      />
    </div>
  );
}

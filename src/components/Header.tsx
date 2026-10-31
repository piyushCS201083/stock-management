import React, { useState, useEffect } from 'react';
import { Send, FileSpreadsheet, Users, History, HelpCircle, Clock } from 'lucide-react';
import { getIndianCurrentTime, getIndianTodayDate } from '../utils/date';

interface HeaderProps {
  onOpenQuickEntry: () => void;
  onOpenWhatsAppDispatch: () => void;
  onOpenTeamModal: () => void;
  onOpenCloudSettings: () => void;
  onOpenSerialTracker: () => void;
  onExportExcel: () => void;
  currentDate: string;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenQuickEntry,
  onOpenWhatsAppDispatch,
  onOpenTeamModal,
  onOpenCloudSettings,
  onOpenSerialTracker,
  onExportExcel,
  currentDate,
}) => {
  const [istTime, setIstTime] = useState<string>(() => getIndianCurrentTime());

  useEffect(() => {
    const timer = setInterval(() => {
      setIstTime(getIndianCurrentTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
      {/* Zone 1: Brand Wordmark (Single text element, whitespace-nowrap shrink-0) */}
      <div className="flex items-center gap-3 shrink-0">
        <a href="/" className="text-base font-extrabold tracking-tight text-slate-900 whitespace-nowrap">
          Battery Stock Ledger
        </a>
        <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-50 border border-amber-200/80 text-[11px] font-mono text-amber-900" title="India Standard Time (UTC+5:30)">
          <Clock className="w-3 h-3 text-amber-700" />
          <span>IST: {istTime}</span>
        </div>
      </div>

      {/* Zone 2: 4-5 single-line clean navigation links */}
      <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-600">
        <button
          onClick={onOpenQuickEntry}
          className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Quick Entry
        </button>
        <button
          onClick={onOpenSerialTracker}
          className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer text-blue-700 font-bold"
        >
          Serial Tracker
        </button>
        <button
          onClick={onOpenTeamModal}
          className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Team Contacts
        </button>
        <button
          onClick={onOpenCloudSettings}
          className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
        >
          <span>Cloud DBMS</span>
        </button>
        <button
          onClick={onExportExcel}
          className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Download .XLSX
        </button>
        <button
          onClick={onOpenWhatsAppDispatch}
          className="hover:text-emerald-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer text-emerald-700"
        >
          WhatsApp Share
        </button>
      </nav>

      {/* Zone 3: 1 Primary Action */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onOpenWhatsAppDispatch}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send WhatsApp Photo</span>
        </button>
      </div>
    </header>
  );
};

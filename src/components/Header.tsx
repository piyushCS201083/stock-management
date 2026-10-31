import React from 'react';
import { Send, FileSpreadsheet, Users, History, HelpCircle } from 'lucide-react';

interface HeaderProps {
  onOpenQuickEntry: () => void;
  onOpenWhatsAppDispatch: () => void;
  onOpenTeamModal: () => void;
  onExportExcel: () => void;
  currentDate: string;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenQuickEntry,
  onOpenWhatsAppDispatch,
  onOpenTeamModal,
  onExportExcel,
  currentDate,
}) => {
  return (
    <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
      {/* Zone 1: Brand Wordmark (Single text element, whitespace-nowrap shrink-0) */}
      <div className="flex items-center gap-2 shrink-0">
        <a href="/" className="text-base font-extrabold tracking-tight text-slate-900 whitespace-nowrap">
          Battery Stock Ledger
        </a>
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
          onClick={onOpenTeamModal}
          className="hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Team Contacts
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

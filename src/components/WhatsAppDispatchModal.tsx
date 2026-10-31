import React, { useState, useEffect } from 'react';
import { toPng, toJpeg } from 'html-to-image';
import { BatteryColumn, DayRecord, TeamMember } from '../types/stock';
import { formatWhatsAppMessage, getWhatsAppUrl, getWhatsAppWebUrl, DispatchResult } from '../utils/whatsapp';
import {
  MessageSquare,
  Camera,
  Download,
  Copy,
  Check,
  ExternalLink,
  Send,
  Users,
  Sparkles,
  Smartphone,
  Globe,
  Share2,
  AlertCircle,
  X,
} from 'lucide-react';

interface WhatsAppDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: DayRecord;
  columns: BatteryColumn[];
  teamMembers: TeamMember[];
  tableElementId?: string;
}

export const WhatsAppDispatchModal: React.FC<WhatsAppDispatchModalProps> = ({
  isOpen,
  onClose,
  record,
  columns,
  teamMembers,
  tableElementId = 'battery-stock-sheet-table',
}) => {
  const [messageText, setMessageText] = useState('');
  const [copiedText, setCopiedText] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [isGeneratingPhoto, setIsGeneratingPhoto] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [dispatchLogs, setDispatchLogs] = useState<DispatchResult[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isSendingWebhook, setIsSendingWebhook] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);

  // Re-generate formatted text when record changes
  useEffect(() => {
    if (isOpen) {
      const formatted = formatWhatsAppMessage(record, columns);
      setMessageText(formatted);
      // Select all active team members by default
      setSelectedMemberIds(teamMembers.filter(m => m.active).map(m => m.id));
      captureSheetPhoto();
    }
  }, [isOpen, record, columns, teamMembers]);

  // Capture the sheet photo using html-to-image
  const captureSheetPhoto = async () => {
    setIsGeneratingPhoto(true);
    try {
      const node = document.getElementById(tableElementId);
      if (!node) {
        console.warn('Table node not found for photo generation');
        setIsGeneratingPhoto(false);
        return;
      }

      // Generate crisp high resolution PNG
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2, // 2x crisp retina capture
        backgroundColor: '#ffffff',
      });
      setPhotoDataUrl(dataUrl);
    } catch (err) {
      console.error('Failed to capture sheet photo', err);
    } finally {
      setIsGeneratingPhoto(false);
    }
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2500);
    } catch (e) {
      console.error('Failed to copy text', e);
    }
  };

  const handleCopyPhoto = async () => {
    if (!photoDataUrl) return;
    try {
      const res = await fetch(photoDataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      setCopiedImage(true);
      setTimeout(() => setCopiedImage(false), 2500);
    } catch (e) {
      console.error('Failed to copy image to clipboard', e);
      // Fallback: download image
      handleDownloadPhoto();
    }
  };

  const handleDownloadPhoto = () => {
    if (!photoDataUrl) return;
    const a = document.createElement('a');
    a.href = photoDataUrl;
    a.download = `Battery_Stock_Sheet_${record.date}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleNativeShare = async () => {
    if (!photoDataUrl || !navigator.share) return;
    try {
      const res = await fetch(photoDataUrl);
      const blob = await res.blob();
      const file = new File([blob], `Battery_Stock_${record.date}.png`, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Battery Stock Register - ${record.date}`,
          text: messageText,
          files: [file],
        });
      } else {
        await navigator.share({
          title: `Battery Stock Register - ${record.date}`,
          text: messageText,
        });
      }
    } catch (e) {
      console.warn('Native share error or dismissed', e);
    }
  };

  const toggleSelectMember = (id: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllMembers = () => {
    if (selectedMemberIds.length === teamMembers.length) {
      setSelectedMemberIds([]);
    } else {
      setSelectedMemberIds(teamMembers.map((m) => m.id));
    }
  };

  // Launch direct WhatsApp chat
  const handleSendToMember = (member: TeamMember) => {
    const url = getWhatsAppUrl(member.phone, messageText);
    window.open(url, '_blank');

    setDispatchLogs((prev) => [
      {
        memberId: member.id,
        memberName: member.name,
        phone: member.phone,
        timestamp: new Date().toLocaleTimeString(),
        status: 'sent',
      },
      ...prev,
    ]);
  };

  // Send to all selected members in sequence
  const handleSendToAllSelected = () => {
    const selected = teamMembers.filter((m) => selectedMemberIds.includes(m.id));
    if (selected.length === 0) return;

    selected.forEach((member, index) => {
      setTimeout(() => {
        const url = getWhatsAppUrl(member.phone, messageText);
        window.open(url, '_blank');
      }, index * 800);
    });

    const newLogs: DispatchResult[] = selected.map((m) => ({
      memberId: m.id,
      memberName: m.name,
      phone: m.phone,
      timestamp: new Date().toLocaleTimeString(),
      status: 'sent',
    }));
    setDispatchLogs((prev) => [...newLogs, ...prev]);
  };

  // Optional automated webhook dispatcher
  const handleTriggerWebhook = async () => {
    if (!webhookUrl.trim()) {
      setWebhookStatus('Please provide a webhook URL or use Direct WhatsApp buttons.');
      return;
    }
    setIsSendingWebhook(true);
    setWebhookStatus(null);
    try {
      const payload = {
        date: record.date,
        message: messageText,
        recipientPhones: teamMembers
          .filter((m) => selectedMemberIds.includes(m.id))
          .map((m) => m.phone),
        imageDataUrl: photoDataUrl?.slice(0, 500) + '... (truncated for preview)',
        timestamp: new Date().toISOString(),
      };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setWebhookStatus(`Dispatched successfully to webhook! (Status ${res.status})`);
      } else {
        setWebhookStatus(`Server responded with code: ${res.status}`);
      }
    } catch (e: any) {
      setWebhookStatus(`Notice: ${e.message || 'Webhook request sent.'}`);
    } finally {
      setIsSendingWebhook(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden my-4">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-emerald-600 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center shadow-xs">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Automated WhatsApp Stock Dispatch</h2>
              <p className="text-xs text-emerald-100">
                Confirm stock updates and broadcast the daily report + sheet photo to team members
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-emerald-100 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Top Quick Actions Banner */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>Daily Report for {record.date} is Ready</span>
              </div>
              <p className="text-xs text-emerald-700 mt-0.5">
                Copy the text or sheet photo below, or trigger instant WhatsApp chat with one click.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleCopyText}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-50 transition-colors cursor-pointer"
              >
                {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedText ? 'Copied Message!' : 'Copy Message'}</span>
              </button>

              <button
                onClick={handleCopyPhoto}
                disabled={!photoDataUrl || isGeneratingPhoto}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {copiedImage ? <Check className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
                <span>{copiedImage ? 'Copied Photo!' : 'Copy Photo (Ctrl+V)'}</span>
              </button>

              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button
                  onClick={handleNativeShare}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5 text-slate-600" />
                  <span>Share</span>
                </button>
              )}
            </div>
          </div>

          {/* 2-Column Split: Sheet Photo Preview + WhatsApp Message Text */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Generated Sheet Photo */}
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-blue-600" />
                  Daily Sheet Photo to Send
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={captureSheetPhoto}
                    disabled={isGeneratingPhoto}
                    className="text-[11px] text-blue-600 hover:text-blue-800 font-medium underline"
                  >
                    {isGeneratingPhoto ? 'Refreshing...' : 'Re-capture'}
                  </button>
                  <span className="text-slate-300">·</span>
                  <button
                    onClick={handleDownloadPhoto}
                    disabled={!photoDataUrl}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-900 font-medium"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download PNG</span>
                  </button>
                </div>
              </div>

              <div className="relative border border-slate-300 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center min-h-[220px] max-h-[300px]">
                {isGeneratingPhoto ? (
                  <div className="flex flex-col items-center gap-2 p-6 text-slate-500">
                    <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-xs">Generating photo of Excel sheet...</span>
                  </div>
                ) : photoDataUrl ? (
                  <div className="w-full h-full p-2 overflow-auto bg-slate-50">
                    <img
                      src={photoDataUrl}
                      alt="Daily Battery Excel Snapshot"
                      className="w-full h-auto object-contain shadow-xs border border-slate-200"
                    />
                  </div>
                ) : (
                  <div className="p-6 text-xs text-slate-400 text-center">
                    Snapshot pending capture. Click re-capture above.
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                💡 <span className="font-semibold text-slate-700">Daily Routine:</span> Click <span className="text-emerald-700 font-medium">"Copy Photo (Ctrl+V)"</span> and paste right into your team WhatsApp group chat!
              </p>
            </div>

            {/* Right: Formatted WhatsApp Message */}
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  WhatsApp Text Template
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {messageText.length} characters
                </span>
              </div>

              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={10}
                className="w-full p-3 font-mono text-xs text-slate-800 bg-[#e7f5e8]/40 border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none leading-relaxed"
                placeholder="Message preview..."
              />
              <p className="text-[11px] text-slate-500">
                You can freely adjust this message text before sending to your team.
              </p>
            </div>
          </div>

          {/* Team Members Broadcast Section */}
          <div className="space-y-3 pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">Select Relevant Team Members</h3>
                <span className="text-xs text-slate-500">
                  ({selectedMemberIds.length} of {teamMembers.length} selected)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={selectAllMembers}
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800 underline"
                >
                  {selectedMemberIds.length === teamMembers.length ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  onClick={handleSendToAllSelected}
                  disabled={selectedMemberIds.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 shadow-xs cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send to All Selected</span>
                </button>
              </div>
            </div>

            {/* Members Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {teamMembers.map((member) => {
                const isSelected = selectedMemberIds.includes(member.id);
                return (
                  <div
                    key={member.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'border-emerald-300 bg-emerald-50/50 shadow-2xs'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectMember(member.id)}
                        className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                      />
                      <div>
                        <div className="text-xs font-bold text-slate-900">{member.name}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1">
                          <span>{member.role}</span>
                          <span>·</span>
                          <span className="font-mono text-slate-600">+{member.phone}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleSendToMember(member)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-100/70 hover:bg-emerald-200/80 rounded transition-colors shrink-0 cursor-pointer"
                      title="Open WhatsApp chat with message prefilled"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Chat</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Automated Webhook / API Option (for automated dispatch servers) */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-slate-600" />
                <span className="text-xs font-bold text-slate-800">
                  Automated WhatsApp API / Webhook Dispatch (Optional)
                </span>
              </div>
              <span className="text-[11px] text-slate-500">
                Green-API / Twilio / WhatsApp Business Cloud
              </span>
            </div>

            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://your-whatsapp-gateway.com/api/send-message"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button
                onClick={handleTriggerWebhook}
                disabled={isSendingWebhook}
                className="px-3 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {isSendingWebhook ? 'Triggering...' : 'Dispatch Webhook'}
              </button>
            </div>

            {webhookStatus && (
              <div className="text-xs text-emerald-700 font-medium bg-emerald-50 p-2 rounded border border-emerald-200 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{webhookStatus}</span>
              </div>
            )}
          </div>

          {/* Dispatch Activity History */}
          {dispatchLogs.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Recent Dispatch Confirmations
              </span>
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {dispatchLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span className="font-medium text-slate-900">{log.memberName}</span>
                      <span className="text-slate-400 font-mono">({log.phone})</span>
                    </div>
                    <span className="text-slate-500 text-[11px] font-mono">{log.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-50 border-t border-slate-200 shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>Excel sheet records saved and auto-calculated</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

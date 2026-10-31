import { BatteryColumn, DayRecord, TeamMember } from '../types/stock';
import { calculateRecordTotals } from './storage';
import { getIndianCurrentTime } from './date';

export function formatWhatsAppMessage(record: DayRecord, columns: BatteryColumn[]): string {
  const totals = calculateRecordTotals(record, columns);

  // Collect inward items
  const inItems: string[] = [];
  columns.forEach((col) => {
    const val = record.inStock[col.id];
    if (val && val > 0) {
      const cause = record.inCause[col.id] ? ` _(${record.inCause[col.id]})_` : '';
      inItems.push(`  • *${col.name}:* +${val}${cause}`);
    }
  });

  // Collect outward items
  const outItems: string[] = [];
  columns.forEach((col) => {
    const val = record.outStock[col.id];
    if (val && val !== 0) {
      const cause = record.outCause[col.id] ? ` _(${record.outCause[col.id]})_` : '';
      inItems;
      outItems.push(`  • *${col.name}:* ${val}${cause}`);
    }
  });

  // Repair battery info
  const repairInfo: string[] = [];
  if (record.inStock['repair'] && record.inStock['repair'] > 0) {
    const cause = record.repairInCause ? ` (${record.repairInCause.replace(/\n/g, ', ')})` : '';
    repairInfo.push(`  • Inward: +${record.inStock['repair']}${cause}`);
  }
  if (record.outStock['repair'] && record.outStock['repair'] !== 0) {
    const cause = record.repairOutCause ? ` (${record.repairOutCause.replace(/\n/g, ', ')})` : '';
    repairInfo.push(`  • Outward: ${record.outStock['repair']}${cause}`);
  }

  // Stock summary breakdown by column
  const stockBreakdown: string[] = [];
  columns.forEach((col) => {
    const count = totals.closingStock[col.id] || 0;
    if (count > 0) {
      stockBreakdown.push(`${col.name}: *${count}*`);
    }
  });

  const lines = [
    `📊 *DAILY BATTERY STOCK REGISTER*`,
    `📅 *Date:* ${record.date}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📦 *OPENING STOCK:* ${totals.openingStockTotal} units`,
    ``,
    `📥 *INWARD STOCK (+${totals.inStockTotal}):*`,
    inItems.length > 0 ? inItems.join('\n') : `  • None`,
    record.totalInCause ? `  _Summary Causes:_ ${record.totalInCause.replace(/\n/g, ' | ')}` : '',
    ``,
    `📤 *OUTWARD STOCK (${totals.outStockTotal}):*`,
    outItems.length > 0 ? outItems.join('\n') : `  • None`,
    record.totalOutCause ? `  _Summary Causes:_ ${record.totalOutCause.replace(/\n/g, ' | ')}` : '',
    ``,
    `⚡ *TODAY'S CLOSING STOCK:* ${totals.closingStockTotal} units`,
    stockBreakdown.length > 0 ? `  ${stockBreakdown.join(' | ')}` : '  • 0 units',
    ``,
    `🔧 *OLD BATTERY FOR REPAIR:* Closing: *${totals.repair.closing}* units`,
    repairInfo.length > 0 ? repairInfo.join('\n') : '',
    ``,
    `🛠 *SERVICE BATTERY TOTAL:* *${totals.service.closing}* units`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📷 *Excel sheet snapshot photo updated & verified.*`,
    `⏱ _Updated at: ${getIndianCurrentTime()}_`,
  ].filter(line => line !== '');

  return lines.join('\n');
}

// Format phone number cleanly with Indian +91 prefix
export function formatPhoneNumber(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  if (clean.length === 10) {
    return `+91 ${clean}`;
  }
  if (clean.length === 12 && clean.startsWith('91')) {
    return `+91 ${clean.slice(2)}`;
  }
  return clean.startsWith('+') ? clean : `+${clean}`;
}

// Generate direct WhatsApp link for a team member
export function getWhatsAppUrl(phone: string, message: string): string {
  // Strip non-numeric characters
  let cleanPhone = phone.replace(/\D/g, '');
  // If 10-digit Indian phone (e.g. 9009156696), prepend India country code 91
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }
  const encodedText = encodeURIComponent(message);
  return `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;
}

// Generate direct WhatsApp Web URL
export function getWhatsAppWebUrl(phone: string, message: string): string {
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }
  const encodedText = encodeURIComponent(message);
  return `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;
}

// Send automated dispatch to team members
export interface DispatchResult {
  memberId: string;
  memberName: string;
  phone: string;
  timestamp: string;
  status: 'sent' | 'opened' | 'copied';
}

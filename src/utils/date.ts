// Indian Standard Time (IST: UTC+5:30) Date & Time Utilities

export const TIMEZONE_INDIA = 'Asia/Kolkata';

// Get today's date formatted as DD-MM-YYYY in India Standard Time
export function getIndianTodayDate(): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE_INDIA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  // 'en-GB' formats as DD/MM/YYYY
  const parts = formatter.format(new Date()).split('/');
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

// Get current time formatted in India Standard Time (e.g. "10:45 PM IST")
export function getIndianCurrentTime(): string {
  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: TIMEZONE_INDIA,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  return `${formatter.format(new Date())} IST`;
}

// Get full date string in IST (e.g. "Saturday, 31 October 2026")
export function getIndianFullDateString(): string {
  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: TIMEZONE_INDIA,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return formatter.format(new Date());
}

// Parse DD-MM-YYYY string into a Date object
export function parseDDMMYYYY(dateStr: string): Date {
  const [day, month, year] = dateStr.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

// Increment DD-MM-YYYY string by N days
export function addDaysToDateString(dateStr: string, days = 1): string {
  const [day, month, year] = dateStr.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);

  const nextDay = String(date.getDate()).padStart(2, '0');
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  const nextYear = date.getFullYear();
  return `${nextDay}-${nextMonth}-${nextYear}`;
}

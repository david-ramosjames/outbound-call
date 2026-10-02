import type { BusinessHoursConfig, Weekday } from './config.js';
import { WEEKDAYS } from './config.js';
import type { BusinessStatusValue } from './types.js';

export interface BusinessStatus {
  status: BusinessStatusValue;
  timezone: string;
  /** Local wall-clock time at the firm, e.g. "Tue 2026-10-06 18:42". */
  localTime: string;
  holidayName: string | null;
  /** Next time the office opens (ISO), or null if no hours are configured. */
  nextOpenAt: string | null;
  /** Human phrase for the caller, e.g. "tomorrow at 8:00 AM" or "Monday at 8:00 AM". */
  nextOpenPhrase: string | null;
  overridden: boolean;
}

interface LocalParts {
  date: string; // YYYY-MM-DD
  weekday: Weekday;
  minutes: number; // minutes since local midnight
}

function localParts(at: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekday = String(parts.weekday).slice(0, 3).toLowerCase() as Weekday;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

const WEEKDAY_NAMES: Record<Weekday, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

export function getBusinessStatus(
  config: BusinessHoursConfig,
  now: Date = new Date(),
  override?: BusinessStatusValue | null,
): BusinessStatus {
  const tz = config.timezone || 'America/Chicago';
  const today = localParts(now, tz);
  const holiday = config.holidays.find((h) => h.date === today.date) ?? null;

  let status: BusinessStatusValue;
  if (holiday) {
    status = 'closed';
  } else {
    const ranges = config.weekly[today.weekday] ?? [];
    const open = ranges.some(
      (r) => today.minutes >= toMinutes(r.start) && today.minutes < toMinutes(r.end),
    );
    status = open ? 'business_hours' : 'after_hours';
  }

  const next = status === 'business_hours' ? null : findNextOpen(config, now, tz);

  return {
    status: override ?? status,
    timezone: tz,
    localTime: `${WEEKDAY_NAMES[today.weekday].slice(0, 3)} ${today.date} ${formatClock(today.minutes)}`,
    holidayName: holiday?.name ?? null,
    nextOpenAt: next?.at ?? null,
    nextOpenPhrase: next?.phrase ?? null,
    overridden: Boolean(override),
  };
}

function findNextOpen(
  config: BusinessHoursConfig,
  now: Date,
  tz: string,
): { at: string; phrase: string } | null {
  const today = localParts(now, tz);
  // Walk forward in 15-minute steps for up to 14 days; cheap and DST-safe.
  const stepMs = 15 * 60 * 1000;
  for (let i = 1; i <= 14 * 24 * 4; i += 1) {
    const at = new Date(now.getTime() + i * stepMs);
    const p = localParts(at, tz);
    if (config.holidays.some((h) => h.date === p.date)) continue;
    const ranges = config.weekly[p.weekday] ?? [];
    const opening = ranges.find((r) => p.minutes >= toMinutes(r.start) && p.minutes < toMinutes(r.end));
    if (!opening) continue;

    const openMinutes = toMinutes(opening.start);
    const dayDiff = daysBetween(today.date, p.date);
    const dayWord =
      dayDiff === 0 ? 'today' : dayDiff === 1 ? 'tomorrow' : WEEKDAY_NAMES[p.weekday];
    return {
      at: at.toISOString(),
      phrase: `${dayWord} at ${formatClock(openMinutes)}`,
    };
  }
  return null;
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export { WEEKDAYS };

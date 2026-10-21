/**
 * Calendar dates are represented as "YYYY-MM-DD" strings (DateKey) in the
 * Asia/Kolkata calendar. All budget math works on DateKeys, never on Date
 * objects, so the device timezone can't shift a transaction into another day.
 */
export type DateKey = string;
export type MonthKey = string; // "YYYY-MM"

export const APP_TZ = "Asia/Kolkata";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(s: unknown): s is DateKey {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseKey(k: DateKey): { y: number; m: number; d: number } {
  const m = DATE_RE.exec(k);
  if (!m) throw new Error(`Invalid date key: ${k}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function makeKey(y: number, m: number, d: number): DateKey {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** m is 1-12 */
export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** The calendar date in Asia/Kolkata for an instant. */
export function toISTKey(instant: Date | number = Date.now()): DateKey {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof instant === "number" ? new Date(instant) : instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hour of day (0-23) in Asia/Kolkata. */
export function istHour(instant: Date | number = Date.now()): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TZ, hour: "2-digit", hour12: false }).format(
    typeof instant === "number" ? new Date(instant) : instant,
  );
  return Number(h) % 24;
}

function toUTCms(k: DateKey): number {
  const { y, m, d } = parseKey(k);
  return Date.UTC(y, m - 1, d);
}

function fromUTCms(ms: number): DateKey {
  const dt = new Date(ms);
  return makeKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(k: DateKey, n: number): DateKey {
  return fromUTCms(toUTCms(k) + n * 86_400_000);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((toUTCms(b) - toUTCms(a)) / 86_400_000);
}

export function monthKey(k: DateKey): MonthKey {
  return k.slice(0, 7);
}

export function startOfMonth(k: DateKey): DateKey {
  return `${k.slice(0, 7)}-01`;
}

export function endOfMonth(k: DateKey): DateKey {
  const { y, m } = parseKey(k);
  return makeKey(y, m, daysInMonth(y, m));
}

/** Monday-based start of week. */
export function startOfWeek(k: DateKey): DateKey {
  const dow = new Date(toUTCms(k)).getUTCDay(); // 0=Sun
  return addDays(k, -((dow + 6) % 7));
}

export function addMonths(mk: MonthKey, n: number): MonthKey {
  const [y, m] = mk.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Inclusive range of DateKeys. Empty if from > to. */
export function eachDay(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

/** Clamp a day-of-month (e.g. "due on the 31st") into a real date in the given month. */
export function dueDateInMonth(mk: MonthKey, dueDay: number): DateKey {
  const [y, m] = mk.split("-").map(Number);
  return makeKey(y, m, Math.min(Math.max(1, dueDay), daysInMonth(y, m)));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDay(k: DateKey, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const { y, m, d } = parseKey(k);
  const dow = DOW[new Date(toUTCms(k)).getUTCDay()];
  return `${opts.weekday ? dow + ", " : ""}${d} ${MONTHS[m - 1]}${opts.year ? " " + y : ""}`;
}

export function formatMonth(mk: MonthKey): string {
  const [y, m] = mk.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function relativeDayLabel(k: DateKey, today: DateKey): string {
  const d = diffDays(k, today);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  return formatDay(k, { weekday: true });
}

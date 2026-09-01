// Date helpers used throughout Cadence. Unlike the native app — which kept
// two calendars (device-locale `Calendar.current` for most week math, and
// a Monday-first ISO calendar just for display in WeekGlanceCard/Training
// Log browsing) — the PWA uses ONE convention everywhere: weeks start on
// Monday. This matches PLAN_SCHEMA.md's "every block is a Monday-to-Sunday
// pair of weeks" rule and keeps the web port simpler with no behavioral
// loss (the native app's device-locale weeks only mattered for a
// first-day-of-week locale quirk that doesn't apply here).
import {
  startOfDay as sod,
  startOfWeek as sow,
  addDays as add,
  addWeeks as addW,
  isSameDay as isSame,
  isSameMonth as isSameMon,
  differenceInCalendarDays as diffDays,
  differenceInCalendarWeeks as diffWeeks,
  format as fmt,
  parseISO,
} from 'date-fns'

export const startOfDay = (date) => sod(date)
export const startOfWeekMon = (date) => sow(date, { weekStartsOn: 1 })
export const addDays = (date, n) => add(date, n)
export const addWeeks = (date, n) => addW(date, n)
export const isSameDay = (a, b) => isSame(a, b)
export const isSameMonth = (a, b) => isSameMon(a, b)
export const isToday = (date) => isSame(date, new Date())

export const weeksBetween = (start, end) =>
  diffWeeks(startOfWeekMon(end), startOfWeekMon(start), { weekStartsOn: 1 })

export const daysBetween = (start, end) => diffDays(startOfDay(end), startOfDay(start))

/** "YYYY-MM-DD" for storage / import keys. */
export const toISODateString = (date) => fmt(date, 'yyyy-MM-dd')

/** Best-effort parse of "YYYY-MM-DD" (or a string with a trailing time
 * component, which gets truncated first) into a local Date at midnight. */
export function parseImportDate(raw) {
  if (!raw) return null
  const datePart = String(raw).slice(0, 10)
  const parsed = parseISO(datePart)
  return isNaN(parsed) ? null : startOfDay(parsed)
}

/** Dates may be stored as ISO strings (Dexie-friendly) or Date objects —
 * this normalizes either into a Date. */
export function asDate(value) {
  if (value instanceof Date) return value
  if (!value) return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return parseImportDate(value)
  const d = new Date(value)
  return isNaN(d) ? null : d
}

export function formatDay(date, pattern = 'EEEE, MMM d') {
  return fmt(date, pattern)
}

/** "14 - 20 July" / "28 July - 3 August" across a month boundary. */
export function formatWeekRange(weekStart) {
  const weekEnd = addDays(weekStart, 6)
  if (isSameMonth(weekStart, weekEnd)) {
    return `${fmt(weekStart, 'd')} - ${fmt(weekEnd, 'd MMMM')}`
  }
  return `${fmt(weekStart, 'd MMMM')} - ${fmt(weekEnd, 'd MMMM')}`
}

/** Compact "Week 14 – 20 Jul" style label used in section headers. */
export function formatWeekHeaderLabel(weekStart) {
  const weekEnd = addDays(weekStart, 6)
  if (isSameMonth(weekStart, weekEnd)) {
    return `Week ${fmt(weekStart, 'd')} – ${fmt(weekEnd, 'd MMM')}`
  }
  return `Week ${fmt(weekStart, 'd MMM')} – ${fmt(weekEnd, 'd MMM')}`
}

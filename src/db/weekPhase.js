import { asDate, startOfWeekMon, isSameDay, addWeeks } from '../services/dateUtils'

/** Looks up the phase for whatever week `date` falls in. Missing row →
 * "maintenance", same default the native app uses. */
export function phaseForDate(weekPhases, date) {
  const weekStart = startOfWeekMon(asDate(date))
  const row = weekPhases.find((wp) => isSameDay(asDate(wp.weekStart), weekStart))
  return row?.phase ?? 'maintenance'
}

/** True when none of the last 14 *trained* weeks (ending with the current
 * week) carry an easier phase (Maintenance/Recovery/Taper) — the
 * "consider an easier week" nudge. Ported from `WeekPhase.
 * needsRecoveryWeekWarning`. */
export function needsRecoveryWeekWarning(weekPhases, sessions, today = new Date()) {
  const thisWeekStart = startOfWeekMon(today)
  const windowStart = addWeeks(thisWeekStart, -13)

  const trainedWeekStarts = new Set()
  for (const s of sessions) {
    const weekStart = startOfWeekMon(asDate(s.date))
    if (weekStart >= windowStart && weekStart <= thisWeekStart) {
      trainedWeekStarts.add(weekStart.getTime())
    }
  }
  if (trainedWeekStarts.size === 0) return false

  const restfulPhases = new Set(['maintenance', 'recovery', 'taper'])
  for (const t of trainedWeekStarts) {
    const phase = phaseForDate(weekPhases, new Date(t))
    if (restfulPhases.has(phase)) return false
  }
  return true
}

import { toISODateString, asDate, startOfWeekMon, isSameDay as isSameDayUtil } from '../services/dateUtils'

// ---------------------------------------------------------------------
// SessionSet helpers — ported from Models/SessionSet.swift
// ---------------------------------------------------------------------

/** Prints 65 instead of 65.0, but 62.5 stays 62.5 — matches native's
 * `Double.clean`. */
export function cleanNumber(n) {
  if (n == null) return ''
  return Number.isInteger(n) ? String(n) : String(n)
}

/** Parses strings like "20'", "5'", "20-25'" (averaged), "45 min" into
 * minutes. Returns null if nothing numeric could be found. */
export function durationMinutes(set) {
  if (!set?.duration) return null
  const normalized = String(set.duration).replace(/[–-]/g, ' ')
  const numbers = normalized
    .split(/[^0-9.]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n))
  if (numbers.length === 0) return null
  return numbers.reduce((a, b) => a + b, 0) / numbers.length
}

/** Short human-readable summary, e.g. "Squat — 3x8 @ 65kg" — matches
 * native's `SessionSet.summary`. */
export function setSummary(set) {
  const parts = []
  if (set.exercise) parts.push(set.exercise)
  let scheme = ''
  if (set.setsCount != null) scheme += `${set.setsCount}x`
  if (set.reps != null) scheme += `${set.reps}`
  if (scheme) parts.push(scheme)
  if (set.weightKg != null) parts.push(`@ ${cleanNumber(set.weightKg)}kg`)
  if (set.distanceM != null) parts.push(`${cleanNumber(set.distanceM)}m`)
  if (set.duration) parts.push(set.duration)
  if (set.paceOrPower) parts.push(`@ ${set.paceOrPower}`)
  if (set.rest) parts.push(`(${set.rest} rest)`)
  return parts.join(' ')
}

/** A fresh blank set, matching SessionSet's default init. `isSkipped` is a
 * PWA-only addition (not in the native app's model) — lets an individual
 * prescribed item be explicitly marked "skipped" rather than just left
 * unchecked, so a session with one skipped item can still be recognized
 * as fully addressed and counted in Stats, instead of silently excluding
 * the whole session because one item was never resolved either way. */
export function newSet(overrides = {}) {
  return {
    exercise: null,
    reps: null,
    setsCount: null,
    weightKg: null,
    distanceM: null,
    duration: null,
    paceOrPower: null,
    rest: null,
    notes: null,
    isCompleted: false,
    isSkipped: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------
// TrainingSession helpers — ported from Models/TrainingSession.swift
// ---------------------------------------------------------------------

/** Stable de-dup key: date|discipline|title — matches native's
 * `TrainingSession.importKey` construction. */
export function makeImportKey(date, discipline, title) {
  return `${toISODateString(asDate(date))}|${discipline}|${title}`
}

/** Fraction of a session that's been *addressed* — every set either
 * ticked done or crossed off skipped counts here, so a session with one
 * deliberately-skipped item can still reach 100% and be counted in
 * Stats — see `newSet`'s doc comment on `isSkipped`. Falls back to the
 * whole-session `isCompleted` toggle for sessions with no structured
 * sets. */
export function completionFraction(session) {
  if (!session.sets || session.sets.length === 0) return session.isCompleted ? 1 : 0
  const addressed = session.sets.filter((s) => s.isCompleted || s.isSkipped).length
  return addressed / session.sets.length
}

/** How many sets are ticked done (excludes skipped ones) — used for
 * distance/duration sums so a skipped item never contributes volume. */
export function completedSetCount(session) {
  return (session.sets ?? []).filter((s) => s.isCompleted).length
}

/** How many sets have been addressed one way or the other (done OR
 * skipped) — used for "X/Y addressed" labels alongside `completionFraction`. */
export function addressedSetCount(session) {
  return (session.sets ?? []).filter((s) => s.isCompleted || s.isSkipped).length
}

export function isFullyCompleted(session) {
  return completionFraction(session) >= 1
}

/** Whether a session counts toward discipline totals/stats — required
 * sessions always count, optional ones only once actually done. */
export function countsTowardStats(session) {
  return !session.isOptional || isFullyCompleted(session)
}

/** `totalDistance` normalized to km regardless of discipline (swim's
 * meters divided by 1000). */
export function totalDistanceKm(session) {
  if (session.totalDistance == null) return null
  return session.discipline === 'swim' ? session.totalDistance / 1000 : session.totalDistance
}

/** Bulk-marks every set done/undone — the "tap the ring" shortcut. Always
 * clears any per-set skip marks, since a bulk action is a clean
 * all-done-or-all-undone reset, not a partial/skip state. */
export function withAllSetsCompleted(session, completed) {
  if (!session.sets || session.sets.length === 0) {
    return { ...session, isCompleted: completed }
  }
  return {
    ...session,
    sets: session.sets.map((s) => ({ ...s, isCompleted: completed, isSkipped: false })),
    isCompleted: completed,
  }
}

/** Consecutive weeks (ending with the current week) in which every counted
 * session was fully completed — matches native's `Array<TrainingSession>.
 * weekStreak()`. */
export function weekStreak(sessions, today = new Date()) {
  let weekStart = startOfWeekMon(today)
  let streak = 0
  // Bound the loop generously — a multi-year streak is implausible and
  // this guards against an infinite loop on bad data.
  for (let i = 0; i < 1000; i++) {
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)
    const counted = sessions.filter((s) => {
      const d = asDate(s.date)
      return d >= weekStart && d < weekEnd && countsTowardStats(s)
    })
    if (counted.length === 0 || !counted.every(isFullyCompleted)) break
    streak += 1
    weekStart = new Date(weekStart)
    weekStart.setDate(weekStart.getDate() - 7)
  }
  return streak
}

export function isSameDay(a, b) {
  return isSameDayUtil(asDate(a), asDate(b))
}

import { toISODateString, asDate, startOfWeekMon, isSameDay as isSameDayUtil } from '../services/dateUtils.js'

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
  if (Number.isFinite(set?.durationSeconds) && set.durationSeconds >= 0) return set.durationSeconds / 60
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
 * meters divided by 1000). This is the static, import-time (or manual-
 * entry-time) total — it does NOT reflect later edits to individual
 * sets' `distanceM`. Used only as a fallback by `derivedDistanceKm` below
 * for sessions that don't break distance down per-set. */
export function totalDistanceKm(session) {
  if (session.totalDistance == null) return null
  return session.discipline === 'swim' ? session.totalDistance / 1000 : session.totalDistance
}

/** The distance that actually counts for Stats — summed from completed
 * sets' `distanceM` (× `setsCount` for repeated segments, e.g. 4×150m
 * strides) whenever the session breaks distance down per-set, so editing
 * a set's distance/pace in the session-detail view is immediately
 * reflected here. Skipped sets contribute nothing, matching how skipped
 * items are already excluded from duration/weight stats. Falls back to
 * the static `totalDistance` field only when the session has no
 * distance-bearing sets at all (e.g. a manual entry logged as one
 * lump total, or a session described purely by duration/pace). */
export function derivedDistanceKm(session) {
  const sets = session.sets ?? []
  const distanceBearingSets = sets.filter((s) => s.distanceM != null)
  if (distanceBearingSets.length > 0) {
    const meters = distanceBearingSets
      .filter((s) => s.isCompleted)
      .reduce((sum, s) => sum + s.distanceM * (s.setsCount ?? 1), 0)
    return meters / 1000
  }
  return totalDistanceKm(session)
}

/** Distance shown in session feedback. Before the athlete addresses any
 * distance-bearing steps, show the prescribed whole-session total. Once
 * steps are marked done/skipped, show only completed distance so the card
 * reflects what was actually performed. */
export function sessionDistanceKmForDisplay(session) {
  if (Number.isFinite(session.workoutResult?.actualDistanceKm) && session.workoutResult.actualDistanceKm > 0) return session.workoutResult.actualDistanceKm
  const distanceBearingSets = (session.sets ?? []).filter((s) => s.distanceM != null)
  const hasAddressedDistance = distanceBearingSets.some((s) => s.isCompleted || s.isSkipped)

  if (hasAddressedDistance) {
    const completedMeters = distanceBearingSets
      .filter((s) => s.isCompleted)
      .reduce((sum, s) => sum + s.distanceM * (s.setsCount ?? 1), 0)
    return completedMeters / 1000
  }

  const prescribedTotal = totalDistanceKm(session)
  if (prescribedTotal != null) return prescribedTotal
  if (distanceBearingSets.length === 0) return null

  return distanceBearingSets.reduce((sum, s) => sum + s.distanceM * (s.setsCount ?? 1), 0) / 1000
}

export function effortLabel(value) {
  if (value == null) return 'Not rated'
  if (value <= 2) return 'Easy'
  if (value <= 4) return 'Light'
  if (value <= 6) return 'Moderate'
  if (value <= 8) return 'Hard'
  return 'Very hard'
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

export function isCompletedActivity(session) {
  if (!session || session.discipline === 'rest') return false
  const sets = session.sets ?? []
  if (!sets.length) return !!session.isCompleted
  // A fully skipped workout is addressed for completion-rate purposes but is
  // not an activity performed and therefore cannot extend the streak.
  return isFullyCompleted(session) && sets.some((set) => set.isCompleted)
}

/** Consecutive weeks with at least one completed activity. If the athlete has
 * not trained yet in the current in-progress week, retain the streak through
 * the previous week as a grace period instead of resetting it every Monday.
 * This is derived from stored sessions, so historical weeks update without a
 * data migration. */
export function weekStreak(sessions, today = new Date()) {
  let weekStart = startOfWeekMon(today)
  let streak = 0
  const completedInWeek = (start) => {
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return sessions.some((session) => {
      const date = asDate(session.date)
      return date >= start && date < end && isCompletedActivity(session)
    })
  }

  if (!completedInWeek(weekStart)) {
    weekStart = new Date(weekStart)
    weekStart.setDate(weekStart.getDate() - 7)
  }
  // Bound the loop generously — a multi-year streak is implausible and
  // this guards against an infinite loop on bad data.
  for (let i = 0; i < 1000; i++) {
    if (!completedInWeek(weekStart)) break
    streak += 1
    weekStart = new Date(weekStart)
    weekStart.setDate(weekStart.getDate() - 7)
  }
  return streak
}

export function isSameDay(a, b) {
  return isSameDayUtil(asDate(a), asDate(b))
}

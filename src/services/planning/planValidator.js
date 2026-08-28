import { EXPERIENCE_RULES, DISTANCE_TOLERANCE, clampTrainingDays } from './planRules.js'
import { asDate, toISODateString } from '../dateUtils.js'

const result = () => ({ errors: [], warnings: [], corrections: [] })
const distinct = (xs) => new Set(xs).size

function weekForCalendarDate(skeleton, dateKey) {
  return (skeleton?.weeks ?? []).find((week) => {
    const start = week.calendarStart ?? week.weekStart
    const end = week.calendarEnd ?? week.weekStart
    return dateKey >= start && dateKey <= end
  }) ?? null
}

export function validateSkeleton(skeleton, profile) {
  const out = result()
  if (!skeleton || !Array.isArray(skeleton.weeks)) {
    out.errors.push('Scheduler did not produce a valid plan skeleton.')
    return out
  }
  const tier = skeleton.athleteState?.experienceTier ?? 'Intermediate'
  const rules = EXPERIENCE_RULES[tier] ?? EXPERIENCE_RULES.Intermediate
  const seenIds = new Set()
  for (const week of skeleton.weeks) {
    const sessions = week.sessions ?? []
    if (!Number.isInteger(week.weekNumber) || week.weekLabel !== `Week ${week.weekNumber}`) {
      out.errors.push(`${week.weekStart}: scheduler produced an invalid locked week number/label.`)
    }
    for (const session of sessions) {
      if (session.weekNumber !== week.weekNumber || session.weekLabel !== week.weekLabel) {
        out.errors.push(`${week.weekStart}: session ${session.skeletonId ?? 'unknown'} has a week label that differs from its locked week.`)
      }
    }
    const dates = sessions.filter((s) => s.discipline !== 'rest').map((s) => s.date)
    const scheduledDates = new Set(week.trainingDates ?? [])
    if (distinct(dates) > scheduledDates.size || distinct(dates) > clampTrainingDays(profile.trainingDaysPerWeek)) {
      out.errors.push(`${week.weekStart}: scheduler used more distinct training days than the athlete allows.`)
    }
    for (const date of dates) if (!scheduledDates.has(date)) out.errors.push(`${week.weekStart}: session placed outside the scheduler's selected training dates (${date}).`)
    const quality = sessions.filter((s) => s.role === 'quality').length
    if (quality > rules.maxQualitySessions) out.errors.push(`${week.weekStart}: ${quality} quality sessions exceed ${tier} cap of ${rules.maxQualitySessions}.`)
    for (const s of sessions) {
      if (!s.skeletonId || seenIds.has(s.skeletonId)) out.errors.push(`${week.weekStart}: duplicate or missing skeleton session id.`)
      seenIds.add(s.skeletonId)
      if (profile.sport === 'running' && ['swim', 'bike', 'brick'].includes(s.discipline)) out.errors.push(`${week.weekStart}: running-only plan contains ${s.discipline}.`)
      if (profile.excludeGymSessions && !profile.bodyweightOnlyStrength && s.discipline === 'gym') out.errors.push(`${week.weekStart}: gym session scheduled despite strength exclusion.`)
    }
    if (profile.sport === 'triathlon' && !week.partial && !sessions.some((s) => s.discipline === 'brick')) out.errors.push(`${week.weekStart}: triathlon week has no brick session.`)
    const calendarDays = week.partial ? null : 7
    if (calendarDays) {
      const restDays = calendarDays - distinct(dates)
      if (restDays < rules.minRestDays) out.errors.push(`${week.weekStart}: only ${restDays} rest days; ${tier} requires at least ${rules.minRestDays}.`)
    }
    if (profile.sport === 'running' && Number.isFinite(week.targets?.runKm)) {
      const allocated = sessions.filter((s) => s.discipline === 'run').reduce((sum, s) => sum + (Number(s.targetDistanceKm) || 0), 0)
      if (Math.abs(allocated - week.targets.runKm) > 1e-6) out.errors.push(`${week.weekStart}: allocated run distance does not match the weekly target.`)
    }
    if (profile.sport === 'triathlon') {
      const swim = sessions.filter((s) => s.discipline === 'swim').reduce((sum, s) => sum + (Number(s.targetDistanceKm) || 0), 0)
      const bike = sessions.filter((s) => s.discipline === 'bike').reduce((sum, s) => sum + (Number(s.targetDistanceKm) || 0), 0) + sessions.filter((s) => s.discipline === 'brick').reduce((sum, s) => sum + (Number(s.brickTargets?.bikeKm) || 0), 0)
      const run = sessions.filter((s) => s.discipline === 'run').reduce((sum, s) => sum + (Number(s.targetDistanceKm) || 0), 0) + sessions.filter((s) => s.discipline === 'brick').reduce((sum, s) => sum + (Number(s.brickTargets?.runKm) || 0), 0)
      if (Math.abs(swim - (week.targets?.swimKm ?? swim)) > 1e-6) out.errors.push(`${week.weekStart}: allocated swim distance does not match the weekly target.`)
      if (Math.abs(bike - (week.targets?.bikeKm ?? bike)) > 1e-6) out.errors.push(`${week.weekStart}: allocated bike distance does not match the weekly target.`)
      if (Math.abs(run - (week.targets?.runKm ?? run)) > 1e-6) out.errors.push(`${week.weekStart}: allocated run distance does not match the weekly target.`)
    }
  }
  return out
}

function distanceMismatch(targetKm, session) {
  if (targetKm == null || session.totalDistance == null) return false
  const actualKm = session.discipline === 'swim' ? Number(session.totalDistance) / 1000 : Number(session.totalDistance)
  if (!Number.isFinite(actualKm)) return true
  const tol = Math.min(DISTANCE_TOLERANCE.absoluteKm, targetKm * DISTANCE_TOLERANCE.fraction)
  return Math.abs(actualKm - targetKm) > tol
}

export function validateGeneratedPlan({ skeleton, sessions }) {
  const out = result()
  const expected = new Map()
  for (const week of skeleton?.weeks ?? []) for (const s of week.sessions ?? []) expected.set(s.skeletonId, s)
  const actualById = new Map()
  const blockStart = skeleton?.blockStart ?? null
  const blockEnd = skeleton?.blockEnd ?? null
  for (const s of sessions ?? []) {
    if (!s.skeletonId) {
      // Rest/mobility entries are descriptive calendar items rather than
      // scheduler-owned training sessions. The LLM may include them so the
      // imported calendar visibly shows recovery days, but they do not need
      // skeleton IDs. Extra non-rest training remains forbidden.
      if (s.discipline === 'rest') {
        const d = asDate(s.date)
        const localDate = d ? toISODateString(d) : null
        if (!localDate || (blockStart && localDate < blockStart) || (blockEnd && localDate > blockEnd)) {
          out.errors.push(`Generated rest session "${s.title ?? 'Rest'}" falls outside this scheduled block.`)
          continue
        }
        const week = weekForCalendarDate(skeleton, localDate)
        if (!week) {
          out.errors.push(`Generated rest session "${s.title ?? 'Rest'}" does not belong to a locked Cadence week.`)
        } else if (s.weekLabel !== week.weekLabel) {
          out.errors.push(`Generated rest session "${s.title ?? 'Rest'}" must use locked weekLabel "${week.weekLabel}".`)
        }
        continue
      }
      out.errors.push(`Generated session "${s.title ?? 'unknown'}" is missing skeletonId.`)
      continue
    }
    if (actualById.has(s.skeletonId)) out.errors.push(`Duplicate generated skeletonId ${s.skeletonId}.`)
    actualById.set(s.skeletonId, s)
    const spec = expected.get(s.skeletonId)
    if (!spec) {
      out.errors.push(`Generated session "${s.title ?? s.skeletonId}" does not belong to this scheduled block.`)
      continue
    }
    // Imported date-only strings are parsed at local midnight and stored as
    // ISO instants. In positive UTC offsets that ISO instant is on the prior
    // UTC date, so comparing `.slice(0, 10)` falsely reports a changed date.
    // Compare the athlete's local calendar date instead.
    const generatedDate = asDate(s.date)
    const generatedDateKey = generatedDate ? toISODateString(generatedDate) : null
    if (generatedDateKey !== spec.date) out.errors.push(`${s.skeletonId}: date changed from ${spec.date}.`)
    if (s.discipline !== spec.discipline) out.errors.push(`${s.skeletonId}: discipline changed from ${spec.discipline} to ${s.discipline}.`)
    if (s.skeletonRole !== spec.role) out.errors.push(`${s.skeletonId}: session role must remain ${spec.role}.`)
    if (s.weekLabel !== spec.weekLabel) out.errors.push(`${s.skeletonId}: weekLabel must remain "${spec.weekLabel}".`)
    if (distanceMismatch(spec.targetDistanceKm, s)) out.errors.push(`${s.skeletonId}: total distance differs from the locked target by more than the allowed tolerance.`)
    if (spec.discipline === 'brick') {
      const bike = Number(s.brickTargets?.bikeKm)
      const run = Number(s.brickTargets?.runKm)
      if (!Number.isFinite(bike) || !Number.isFinite(run) || Math.abs(bike - spec.brickTargets.bikeKm) > 0.51 || Math.abs(run - spec.brickTargets.runKm) > 0.51) {
        out.errors.push(`${s.skeletonId}: brick bike/run targets do not match the locked schedule.`)
      }
    }
  }
  for (const [id] of expected) if (!actualById.has(id)) out.errors.push(`Scheduled session ${id} is missing from the generated plan.`)
  return out
}

export function mergeGeneratedWithSkeleton({ skeleton, sessions }) {
  const expected = new Map()
  for (const week of skeleton?.weeks ?? []) for (const s of week.sessions ?? []) expected.set(s.skeletonId, s)
  return sessions.map((s) => {
    const spec = expected.get(s.skeletonId)
    if (!spec) return s
    const totalDistance = spec.targetDistanceKm == null
      ? s.totalDistance
      : spec.discipline === 'swim' ? spec.targetDistanceKm * 1000 : spec.targetDistanceKm
    return {
      ...s,
      date: `${spec.date}T00:00:00.000Z`,
      discipline: spec.discipline,
      totalDistance,
      phase: spec.phase,
      weekLabel: spec.weekLabel,
      isOptional: spec.isOptional,
    }
  })
}

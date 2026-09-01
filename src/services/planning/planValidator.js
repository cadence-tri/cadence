import { EXPERIENCE_RULES, DISTANCE_TOLERANCE, clampTrainingDays } from './planRules.js'
import { asDate, toISODateString, parseImportDate } from '../dateUtils.js'
import { canonicalEnduranceSets } from './endurancePlanning.js'
import { dayGap } from './fitness.js'
import { strengthWeekPolicy, strengthFocuses, strengthPrescription, strengthPlacementAllowed } from './strengthPlanning.js'

function equivalent(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => equivalent(a[key], b[key]))
}
const samePrescription = equivalent
export function validateEnduranceSession(session, spec) {
  const errors = []
  const p = spec.endurancePrescription
  if (!p) return errors
  if (session.endurancePrescription ? !equivalent(session.endurancePrescription, p) : session.endurancePrescriptionId !== p.id) errors.push('endurance prescription reference changed or missing')
  const expected = canonicalEnduranceSets(p)
  if (session.sets?.length !== expected.length) errors.push('prescribed step count changed')
  for (const [index, step] of expected.entries()) {
    const actual = session.sets?.[index]
    for (const field of ['stepId', 'stepType', 'durationSeconds', 'distanceM', 'target', 'duration', 'paceOrPower', 'rest', 'setsCount']) {
      if (!equivalent(actual?.[field] ?? null, step[field] ?? null)) errors.push(`step ${index + 1}: ${field} differs from the locked prescription`)
    }
    if (actual?.reps != null || actual?.weightKg != null) errors.push(`step ${index + 1}: unexpected repetitions/weight`)
  }
  if (!!session.isOptional !== !!spec.isOptional) errors.push('optional status changed')
  return errors
}

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
  const allSessions = skeleton.weeks.flatMap((week) => week.sessions ?? [])
  const endurance = allSessions.filter((s) => s.discipline !== 'gym' && s.discipline !== 'rest')
  if (skeleton.version >= 4) {
    const quality = endurance.filter((s) => s.role === 'quality')
    for (let i = 0; i < quality.length; i++) {
      if (quality.slice(i + 1).some((s) => Math.abs(dayGap(s.date, quality[i].date)) < 2)) out.errors.push('Endurance quality sessions must have at least two calendar days between them.')
      if (endurance.some((s) => ['long', 'brick'].includes(s.role) && Math.abs(dayGap(s.date, quality[i].date)) < 2)) out.errors.push('Quality work conflicts with long/brick recovery spacing.')
    }
  }
  for (const week of skeleton.weeks) {
    const sessions = week.sessions ?? []
    if (skeleton.version >= 3) {
      const gym = sessions.filter((s) => s.discipline === 'gym')
      const policy = strengthWeekPolicy(profile, week, skeleton.athleteState?.checkIn)
      const plan = week.strengthPlan
      if (!plan || plan.requestedSessions !== policy.requestedSessions || plan.targetSessions !== policy.targetSessions
        || plan.mode !== policy.mode || plan.scheduledSessions !== gym.length || gym.length > policy.targetSessions) {
        out.errors.push(`${week.weekLabel}: strength frequency/policy does not match the athlete's preferences and check-in.`)
      }
      if (gym.length < policy.targetSessions && !plan?.messages?.length) out.errors.push(`${week.weekLabel}: strength frequency was reduced without explanation.`)
      const expectedFocuses = strengthFocuses(gym.length)
      if (!expectedFocuses || [...expectedFocuses].sort().join() !== gym.map((s) => s.strengthPrescription?.focus).sort().join()) {
        out.errors.push(`${week.weekLabel}: strength split does not match the scheduled frequency.`)
      }
      for (const session of gym) {
        const prescription = session.strengthPrescription
        const expected = strengthPrescription(profile, prescription?.focus, policy.mode)
        if (!samePrescription(prescription, expected) || session.targetDurationMin !== expected.durationMinutes) {
          out.errors.push(`${week.weekLabel}: strength prescription differs from the locked load policy.`)
        }
        if (!strengthPlacementAllowed({ date: session.date, focus: prescription?.focus, endurance,
          strength: allSessions.filter((s) => s.discipline === 'gym' && s !== session), profile })) {
          out.errors.push(`${week.weekLabel}: strength placement conflicts with endurance, strength spacing, daily capacity, or race protection.`)
        }
      }
    }
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
      if (s.endurancePrescription) {
        const p = s.endurancePrescription
        if (!p.steps?.length || p.steps.some((step) => (step.durationSeconds == null) === (step.distanceM == null)
          || (step.durationSeconds ?? step.distanceM) <= 0 || !Number.isInteger(step.setsCount) || step.setsCount <= 0)) out.errors.push(`${s.skeletonId}: invalid endurance work steps.`)
        if (s.discipline === 'swim') {
          const km = p.steps.reduce((sum, step) => sum + (step.distanceM ?? 0) * (step.setsCount ?? 1), 0) / 1000
          if (Math.abs(km - s.targetDistanceKm) > 1e-6) out.errors.push(`${s.skeletonId}: swim steps do not sum to the allocated distance.`)
        }
      }
      if (!s.skeletonId || seenIds.has(s.skeletonId)) out.errors.push(`${week.weekStart}: duplicate or missing skeleton session id.`)
      seenIds.add(s.skeletonId)
      if (profile.sport === 'running' && ['swim', 'bike', 'brick'].includes(s.discipline)) out.errors.push(`${week.weekStart}: running-only plan contains ${s.discipline}.`)
      if (profile.excludeGymSessions && !profile.bodyweightOnlyStrength && s.discipline === 'gym') out.errors.push(`${week.weekStart}: gym session scheduled despite strength exclusion.`)
    }
    if (profile.sport === 'triathlon' && !week.partial && !week.isRaceWeek && !week.postRaceRecovery && !sessions.some((s) => s.discipline === 'brick')) out.errors.push(`${week.weekStart}: triathlon week has no brick session.`)
    const calendarDays = week.partial ? null : 7
    if (calendarDays) {
      const restDays = calendarDays - distinct(dates)
      if (restDays < rules.minRestDays) out.errors.push(`${week.weekStart}: only ${restDays} rest days; ${tier} requires at least ${rules.minRestDays}.`)
    }
    if (profile.sport === 'running' && Number.isFinite(week.targets?.runKm)) {
      const allocated = sessions.filter((s) => s.discipline === 'run' && !s.isRace).reduce((sum, s) => sum + (Number(s.targetDistanceKm) || 0), 0)
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
    if (skeleton.version >= 4 && !!s.isOptional !== !!spec.isOptional) out.errors.push(`${s.skeletonId}: optional status must remain locked.`)
    out.errors.push(...validateEnduranceSession(s, spec).map((message) => `${s.skeletonId}: ${message}.`))
    if (spec.strengthPrescription) {
      const prescription = spec.strengthPrescription
      if (!samePrescription(s.strengthPrescription, prescription)) {
        out.errors.push(`${s.skeletonId}: strengthPrescription must match the locked focus, equipment, duration, core and deload rules.`)
      }
      const sets = s.sets ?? []
      const expectedSlots = prescription.exerciseSlots ?? []
      if (sets.length !== expectedSlots.length || sets.some((set, index) => set.slot !== expectedSlots[index]
        || set.isCore !== (set.slot === 'core'))) {
        out.errors.push(`${s.skeletonId}: strength slots must be exactly ${expectedSlots.join(', ')} in order, with core last.`)
      }
      if (sets.some((set) => set.setsCount !== (set.isCore ? prescription.coreSets : prescription.workSetsMin))) {
        out.errors.push(`${s.skeletonId}: strength work must use exactly ${prescription.workSetsMin} sets per main exercise and ${prescription.coreSets} core sets.`)
      }
    }
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
      date: parseImportDate(spec.date).toISOString(),
      discipline: spec.discipline,
      isRace: !!spec.isRace,
      totalDistance,
      phase: spec.phase,
      weekLabel: spec.weekLabel,
      isOptional: spec.isOptional,
      notes: [spec.optionalReason, s.notes].filter(Boolean).join('\n\n'),
      ...(spec.strengthPrescription ? { strengthPrescription: spec.strengthPrescription } : {}),
      ...(spec.strengthLoadPlan ? { strengthLoadPlan: spec.strengthLoadPlan } : {}),
      ...(spec.endurancePrescription ? {
        endurancePrescription: spec.endurancePrescription,
        originalPrescription: canonicalEnduranceSets(spec.endurancePrescription),
        sets: canonicalEnduranceSets(spec.endurancePrescription).map((step, index) => ({ ...step, exercise: s.sets[index]?.exercise ?? step.exercise, notes: s.sets[index]?.notes ?? null })),
        workoutResult: null,
        distanceIsEstimate: spec.endurancePrescription.distanceIsEstimate,
        notes: [spec.endurancePrescription.rationale, spec.optionalReason, s.notes].filter(Boolean).join('\n\n'),
      } : {}),
    }
  })
}

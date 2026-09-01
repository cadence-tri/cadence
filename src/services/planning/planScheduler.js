import { addDays, asDate, startOfDay, startOfWeekMon, toISODateString, weeksBetween } from '../dateUtils.js'
import { jsDayToWeekdayValue } from '../../db/raceDistance.js'
import { phaseForDate } from '../../db/weekPhase.js'
import { placeStrengthWeek } from './strengthPlanning.js'
import { applyEndurancePlanning } from './endurancePlanning.js'
import { completedLoadWeeks, marathonBudget } from './seasonPlanning.js'
import { parseDurationSeconds } from './planRules.js'
import { RUNNING_META, TRIATHLON_META } from '../../db/raceDistance.js'
import {
  EXPERIENCE_RULES,
  RUNNING_VOLUME_RANGES,
  TRIATHLON_VOLUME_RANGES,
  TAPER_FACTOR,
  clampTrainingDays,
  lifestyleFactor,
  midpoint,
  loadWeekRangeTarget,
  recoveryWeekTarget,
  recoveryFactor,
  computeExperienceTier,
  PHASE_WINDOWS_DAYS,
  runningPaceTargets,
  triathlonNumericTargets,
} from './planRules.js'

function snappedToMonday(date) {
  const day = startOfDay(date)
  return addDays(day, (8 - day.getDay()) % 7)
}

const round = (n, step = 0.5) => Math.round(n / step) * step
const dateKey = (d) => toISODateString(asDate(d))

// Allocate an already-rounded weekly target across sessions without letting
// per-session rounding change the total. We do the arithmetic in integer
// `step` units, then distribute leftover units by largest fractional
// remainder. This keeps the proportions as close as possible to the desired
// weights while guaranteeing that the returned values sum to `total`.
export function allocateRoundedTotal(total, weights, step = 0.5) {
  const safeTotal = Number(total)
  if (!Number.isFinite(safeTotal) || safeTotal < 0) throw new Error('Allocation total must be a non-negative finite number.')
  if (!Array.isArray(weights) || weights.length === 0) return []
  if (!Number.isFinite(step) || step <= 0) throw new Error('Allocation step must be a positive finite number.')

  const safeWeights = weights.map((weight) => {
    const n = Number(weight)
    return Number.isFinite(n) && n > 0 ? n : 0
  })
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0)
  if (weightSum <= 0) throw new Error('Allocation requires at least one positive weight.')

  const totalUnits = Math.round(safeTotal / step)
  const rawUnits = safeWeights.map((weight) => totalUnits * weight / weightSum)
  const units = rawUnits.map(Math.floor)
  let remaining = totalUnits - units.reduce((sum, value) => sum + value, 0)

  const remainderOrder = rawUnits
    .map((raw, index) => ({ index, fraction: raw - Math.floor(raw) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)

  for (let i = 0; i < remaining; i++) units[remainderOrder[i % remainderOrder.length].index] += 1
  return units.map((value) => round(value * step, step))
}

function latestPlannedDate(planHistory, weekPhases) {
  let latest = null
  for (const session of planHistory ?? []) {
    const d = asDate(session.date)
    if (d && (!latest || d > latest)) latest = d
  }
  // Hybrid imports persist one weekPhase row for every scheduler-owned week.
  // That row therefore records the planned calendar boundary even when the
  // final days of a week are pure rest and have no session objects.
  for (const weekPhase of weekPhases ?? []) {
    const start = asDate(weekPhase.weekStart)
    if (!start) continue
    const end = addDays(startOfWeekMon(start), 6)
    if (!latest || end > latest) latest = end
  }
  return latest
}

function planOriginDate(planHistory, today) {
  let earliest = null
  for (const session of planHistory ?? []) {
    const d = asDate(session.date)
    if (d && (!earliest || d < earliest)) earliest = d
  }
  return earliest ? startOfDay(earliest) : startOfDay(today)
}

function blockDates(planHistory, weekPhases, today) {
  const isFirstPlan = (planHistory ?? []).length === 0
  const anchorToday = startOfDay(today)
  if (isFirstPlan) {
    const monday = snappedToMonday(anchorToday)
    const dates = []
    if (monday > anchorToday) {
      for (let d = anchorToday; d < monday; d = addDays(d, 1)) dates.push(d)
    }
    for (let i = 0; i < 14; i++) dates.push(addDays(monday, i))
    return { dates, blockStart: dates[0], fullBlockStart: monday, blockEnd: dates.at(-1) }
  }
  const lastCovered = latestPlannedDate(planHistory, weekPhases)
  const monday = snappedToMonday(addDays(lastCovered, 1))
  return { dates: Array.from({ length: 14 }, (_, i) => addDays(monday, i)), blockStart: monday, fullBlockStart: monday, blockEnd: addDays(monday, 13) }
}

export function weekNumberForStart(originDate, weekStart) {
  const origin = startOfDay(asDate(originDate))
  const start = startOfDay(asDate(weekStart))
  const firstFullMonday = snappedToMonday(origin)
  if (start < firstFullMonday) return 0
  return weeksBetween(firstFullMonday, start) + 1
}

export function noCompetitionPhaseForWeekNumber(weekNumber) {
  if (weekNumber <= 0) return 'buildUp'
  // Three loading weeks followed by one deload. The first loading mesocycle
  // is Build-up; after that, an athlete without a race date rolls through
  // Endurance + Recovery instead of sitting in Build-up indefinitely.
  if (weekNumber % 4 === 0) return 'recovery'
  return weekNumber <= 3 ? 'buildUp' : 'endurance'
}

export function raceDrivenBasePhase(profile, weekStart) {
  const daysOut = Math.round((asDate(profile.competitionDate) - weekStart) / 86400000)
  if (daysOut < 0) return 'recovery'
  const taperDays = profile.sport === 'running' && profile.runningDistance === 'marathon'
    ? PHASE_WINDOWS_DAYS.taperMarathon
    : PHASE_WINDOWS_DAYS.taperDefault
  if (daysOut <= taperDays) return 'taper'
  if (daysOut <= PHASE_WINDOWS_DAYS.peak) return 'peak'
  if (daysOut <= PHASE_WINDOWS_DAYS.endurance) return 'endurance'
  return 'buildUp'
}

/**
 * Canonical scheduler-owned phase for a calendar week.
 *
 * Legacy/manual imports and backup restores use this same helper so an old
 * model-authored `phase` string cannot disagree with the deterministic
 * macrocycle shown elsewhere in Cadence. `originDate` is the start of the
 * athlete's current training block (or the earliest imported session when a
 * legacy backup predates that field).
 */
export function deterministicPhaseForWeek(profile, weekStart, originDate = weekStart, explicitWeekNumber = null) {
  const start = startOfWeekMon(asDate(weekStart))
  const weekNumber = Number.isInteger(explicitWeekNumber)
    ? explicitWeekNumber
    : weekNumberForStart(originDate, start)

  if (!profile?.competitionDate) return noCompetitionPhaseForWeekNumber(weekNumber)

  const basePhase = raceDrivenBasePhase(profile, start)
  // Match choosePhase(): recovery cycling can interrupt Build-Up/Endurance,
  // but it must never override the event-specific Peak/Taper windows.
  if (weekNumber > 0 && weekNumber % 4 === 0 && ['buildUp', 'endurance'].includes(basePhase)) return 'recovery'
  return basePhase
}

function choosePhase(profile, recentSessions, weekPhases, weekStart, weekNumber) {
  return deterministicPhaseForWeek(profile, weekStart, profile.trainingBlockStartDate ?? weekStart, weekNumber)
}

function loadingWeekIndex(weekNumber) {
  if (weekNumber <= 0) return 0
  return (weekNumber - 1) % 4
}

function availableWeekDates(weekDates, profile, minRestDays = 1) {
  const weeklyCount = clampTrainingDays(profile.trainingDaysPerWeek)
  const proportionalCount = weekDates.length < 7 ? Math.max(1, Math.ceil(weeklyCount * weekDates.length / 7)) : weeklyCount
  // A first-plan partial week should still contain recovery. Without this, a
  // Fri-Sun start with a 5-day profile becomes three consecutive training
  // days. Preserve at least one rest day whenever the partial window has
  // more than one calendar day. Full weeks continue to use the tier floor.
  const restAdjustedMax = weekDates.length < 7
    ? (weekDates.length > 1 ? weekDates.length - 1 : 1)
    : Math.max(1, 7 - minRestDays)
  const count = Math.min(proportionalCount, weekDates.length, restAdjustedMax)
  const higher = new Set(profile.longSessionDays ?? [])
  const sorted = [...weekDates].sort((a, b) => {
    const ah = higher.has(jsDayToWeekdayValue(a.getDay())) ? 1 : 0
    const bh = higher.has(jsDayToWeekdayValue(b.getDay())) ? 1 : 0
    if (ah !== bh) return bh - ah
    // Prefer Tue/Thu/Sat/Sun rhythm before filling remaining days.
    const pref = [2, 4, 6, 0, 3, 5, 1]
    return pref.indexOf(a.getDay()) - pref.indexOf(b.getDay())
  })
  const chosen = sorted.slice(0, count).sort((a, b) => a - b)
  return chosen
}

function longSessionDate(trainDates, profile) {
  const preferred = new Set(profile.longSessionDays ?? [])
  return trainDates.filter((date) => preferred.has(jsDayToWeekdayValue(date.getDay()))).at(-1) ?? trainDates.at(-1)
}

function sessionWasFullyCompleted(session) {
  const sets = Array.isArray(session?.sets) ? session.sets : []
  const hasExplicitSetStatus = sets.some((set) => typeof set?.isCompleted === 'boolean' || typeof set?.isSkipped === 'boolean')
  if (hasExplicitSetStatus && sets.length) return sets.every((set) => set.isCompleted === true)
  if (typeof session?.isCompleted === 'boolean') return session.isCompleted === true
  // Legacy/synthetic history can pre-date completion fields. Preserve
  // compatibility by treating those records as demonstrated rather than
  // discarding all progression context.
  return true
}

function completedWeeklyDistances(planHistory, discipline, originDate, beforeDate) {
  return completedLoadWeeks(planHistory ?? [], discipline, beforeDate, originDate)
}

function latestCompletedWeeklyDistance(planHistory, discipline, originDate, beforeDate) {
  return completedWeeklyDistances(planHistory, discipline, originDate, beforeDate).at(-1)?.totalKm ?? null
}

function latestCompletedLoadWeekDistance(planHistory, weekPhases, discipline, originDate, beforeDate) {
  const weeks = completedWeeklyDistances(planHistory, discipline, originDate, beforeDate)
  for (let i = weeks.length - 1; i >= 0; i--) {
    const week = weeks[i]
    const phase = phaseForDate(weekPhases, asDate(week.weekStart))
    if (phase !== 'recovery' && phase !== 'taper') return week.totalKm
  }
  return weeks.at(-1)?.totalKm ?? null
}

// Progression caps are ceilings on *increases*, not a formula that is
// repeatedly applied to an arbitrary recent average. Under normal recovery
// in the same non-taper context, volume should move toward the phase target
// without ratcheting downward. Explicit recovery/pain/taper conditions may
// reduce load, and never force an increase.
export function progressTowardTarget(desiredTarget, previousFullWeek, tier, { allowReduction = false, step = 0.5 } = {}) {
  const desired = Number(desiredTarget)
  const previous = Number(previousFullWeek)
  if (!Number.isFinite(desired) || desired < 0) return desiredTarget
  if (!Number.isFinite(previous) || previous <= 0) return round(desired, step)

  if (allowReduction) return round(Math.min(desired, previous), step)
  if (previous >= desired) return round(previous, step)

  const capped = Math.min(desired, previous * (1 + EXPERIENCE_RULES[tier].maxWeeklyIncrease))
  // Floor capped increases to the scheduler's distance precision so rounding
  // can never accidentally exceed the tier's percentage ceiling.
  return Math.floor((capped + 1e-9) / step) * step
}

function makeSession(date, discipline, role, distanceKm, phase, extras = {}) {
  const id = `${dateKey(date)}-${discipline}-${role}-${extras.sequence ?? 1}`
  return {
    skeletonId: id,
    date: dateKey(date),
    discipline,
    role,
    phase,
    targetDistanceKm: distanceKm == null ? null : round(distanceKm, discipline === 'swim' ? 0.1 : 0.5),
    targetDurationMin: extras.targetDurationMin ?? null,
    intensity: extras.intensity ?? (role === 'quality' ? 'threshold' : role === 'long' ? 'easy/Z2' : 'easy/Z2'),
    targetPaceOrPower: extras.targetPaceOrPower ?? null,
    isOptional: !!extras.isOptional,
    locked: true,
  }
}

function runningWeek(profile, weekDates, phase, tier, checkIn, previousFullWeekKm = null, weekNumber = 1) {
  const trainDates = availableWeekDates(weekDates, profile, EXPERIENCE_RULES[tier].minRestDays)
  const range = RUNNING_VOLUME_RANGES[profile.runningDistance]?.[phase] ?? RUNNING_VOLUME_RANGES[profile.runningDistance]?.endurance ?? [20, 30]
  const lowerBias = lifestyleFactor(profile) < 1 || recoveryFactor(checkIn) < 1
  const partialWeekFactor = weekDates.length < 7 ? weekDates.length / 7 : 1
  const recovery = recoveryFactor(checkIn)
  const loadIndex = loadingWeekIndex(weekNumber)
  let target
  if (phase === 'recovery' && weekDates.length === 7) {
    target = recoveryWeekTarget(previousFullWeekKm, tier, 0.5)
      ?? round(loadWeekRangeTarget(range, tier, 0, true) * 0.8, 0.5)
  } else if (phase === 'taper') {
    target = midpoint(range, true) * recovery
    target = progressTowardTarget(target, previousFullWeekKm, tier, { allowReduction: true, step: 0.5 })
  } else {
    const desired = loadWeekRangeTarget(range, tier, loadIndex, lowerBias) * recovery
    target = weekDates.length === 7
      ? progressTowardTarget(desired, previousFullWeekKm, tier, { allowReduction: recovery < 1, step: 0.5 })
      : round(desired * partialWeekFactor, 0.5)
  }

  const paceTargets = runningPaceTargets(profile)
  const qualityCap = (checkIn.painLevel === 'significant' || phase === 'recovery') ? 0 : EXPERIENCE_RULES[tier].maxQualitySessions
  const qualityCount = Math.min(qualityCap, trainDates.length >= 4 ? 2 : 1)
  const longDate = longSessionDate(trainDates, profile)
  const remaining = trainDates.filter((d) => d !== longDate)
  // Choose feasible separated slots, not the first two consecutive dates
  // only to discard one later. Tue/Thu also protect the preceding Sunday.
  const qualityDates = []
  const preference = [2, 4, 3, 1, 5, 6, 0]
  for (const d of [...remaining].sort((a, b) => preference.indexOf(a.getDay()) - preference.indexOf(b.getDay()))) {
    if (qualityDates.length >= qualityCount) break
    if (Math.abs((d - longDate) / 86400000) < 1.9 || qualityDates.some(q => Math.abs((q - d) / 86400000) < 1.9)) continue
    qualityDates.push(d)
  }
  const easyDates = remaining.filter((d) => !qualityDates.includes(d))
  const longShare = trainDates.length <= 2 ? 0.55 : 0.38
  const qualityShare = qualityDates.length ? Math.min(0.28, 0.18 * qualityDates.length) : 0
  const easyShare = Math.max(0, 1 - longShare - qualityShare)
  const allocationWeights = [
    ...(longDate ? [longShare] : []),
    ...qualityDates.map(() => qualityShare / Math.max(1, qualityDates.length)),
    ...easyDates.map(() => easyShare / Math.max(1, easyDates.length)),
  ]
  const allocations = allocateRoundedTotal(target, allocationWeights, 0.5)
  let allocationIndex = 0
  const sessions = []
  if (longDate) sessions.push(makeSession(longDate, 'run', 'long', allocations[allocationIndex++], phase, { targetPaceOrPower: paceTargets.easyPace }))
  qualityDates.forEach((d) => sessions.push(makeSession(d, 'run', 'quality', allocations[allocationIndex++], phase, { intensity: 'threshold', targetPaceOrPower: paceTargets.thresholdPace })))
  easyDates.forEach((d) => sessions.push(makeSession(d, 'run', 'easy', allocations[allocationIndex++], phase, { targetPaceOrPower: paceTargets.easyPace })))

  return { sessions, targets: { runKm: target }, trainingDates: trainDates.map(dateKey) }
}

function triWeek(profile, weekDates, phase, tier, checkIn, previousFullWeekTargets = {}, weekNumber = 1) {
  const trainDates = availableWeekDates(weekDates, profile, EXPERIENCE_RULES[tier].minRestDays)
  const base = TRIATHLON_VOLUME_RANGES[profile.triathlonDistance] ?? TRIATHLON_VOLUME_RANGES.olympic
  const partialWeekFactor = weekDates.length < 7 ? weekDates.length / 7 : 1
  const recovery = recoveryFactor(checkIn)
  const lowerBias = lifestyleFactor(profile) < 1 || recovery < 1
  const loadIndex = loadingWeekIndex(weekNumber)
  const numeric = triathlonNumericTargets(profile)
  const targets = {}
  for (const disc of ['swim', 'bike', 'run']) {
    const step = disc === 'swim' ? 0.1 : 0.5
    const previous = previousFullWeekTargets[`${disc}Km`]
    let t
    if (phase === 'recovery' && weekDates.length === 7) {
      t = recoveryWeekTarget(previous, tier, step)
        ?? round(loadWeekRangeTarget(base[disc], tier, 0, true) * 0.8, step)
    } else if (phase === 'taper') {
      const desired = loadWeekRangeTarget(base[disc], tier, 0, true) * TAPER_FACTOR * recovery
      t = progressTowardTarget(desired, previous, tier, { allowReduction: true, step })
    } else {
      const desired = loadWeekRangeTarget(base[disc], tier, loadIndex, lowerBias) * recovery
      t = weekDates.length === 7
        ? progressTowardTarget(desired, previous, tier, { allowReduction: recovery < 1, step })
        : round(desired * partialWeekFactor, step)
    }
    targets[`${disc}Km`] = t
  }
  if (!trainDates.length) return { sessions: [], targets, trainingDates: [] }
  const longDate = longSessionDate(trainDates, profile)
  const sessions = [makeSession(longDate, 'brick', 'brick', null, phase, { intensity: 'Z2/steady', targetPaceOrPower: numeric.ftpWatts ? `bike Z2 relative to FTP ${numeric.ftpWatts}W; run ${numeric.run?.easyPace ?? 'easy/Z2'}` : (numeric.run?.easyPace ?? null) })]

  const other = trainDates.filter((d) => d !== longDate)
  const placements = other.length ? other : [longDate]
  // Core coverage: one swim, one bike, one run. Extra available dates are
  // used to split the largest discipline loads instead of making a single
  // implausibly large session.
  const swimDates = [placements[0]]
  const bikeDates = [placements[Math.min(1, placements.length - 1)]]
  const runDates = [placements[Math.min(2, placements.length - 1)]]
  for (let i = 3; i < placements.length; i++) {
    if (swimDates.length < 2) swimDates.push(placements[i])
    else if (bikeDates.length < 2) bikeDates.push(placements[i])
    else runDates.push(placements[i])
  }
  // Allocate each discipline in the same precision used by its target. The
  // brick participates in bike/run allocation, so rounding there cannot
  // create or lose weekly distance either.
  const swimAllocations = allocateRoundedTotal(targets.swimKm, swimDates.map(() => 1), 0.1)
  const bikeAllocations = allocateRoundedTotal(targets.bikeKm, [0.4, ...bikeDates.map(() => 0.6 / Math.max(1, bikeDates.length))], 0.5)
  const runAllocations = allocateRoundedTotal(targets.runKm, [0.4, ...runDates.map(() => 0.6 / Math.max(1, runDates.length))], 0.5)
  sessions[0].brickTargets = { bikeKm: bikeAllocations[0], runKm: runAllocations[0] }

  swimDates.forEach((d, i) => sessions.push(makeSession(d, 'swim', 'easy', swimAllocations[i], phase, { sequence: i + 1, targetPaceOrPower: numeric.swimPacePer100m })))
  const suppressQuality = checkIn.painLevel === 'significant' || phase === 'recovery'
  bikeDates.forEach((d, i) => sessions.push(makeSession(d, 'bike', i === 0 && !suppressQuality ? 'quality' : 'easy', bikeAllocations[i + 1], phase, { intensity: i === 0 && !suppressQuality ? 'tempo/threshold' : 'easy/Z2', sequence: i + 1, targetPaceOrPower: numeric.ftpWatts ? `${i === 0 && !suppressQuality ? 'tempo/threshold' : 'Z2'} relative to FTP ${numeric.ftpWatts}W` : (numeric.bikeSpeedKph ? `goal-derived reference ${numeric.bikeSpeedKph} km/h` : null) })))
  runDates.forEach((d, i) => {
    const quality = i === 0 && !suppressQuality && tier !== 'Beginner'
    sessions.push(makeSession(d, 'run', quality ? 'quality' : 'easy', runAllocations[i + 1], phase, { intensity: quality ? 'threshold' : 'easy/Z2', sequence: i + 1, targetPaceOrPower: quality ? numeric.run?.thresholdPace : numeric.run?.easyPace }))
  })
  return { sessions, targets, trainingDates: trainDates.map(dateKey) }
}

export function buildPlanSkeleton({ profile, recentSessions = [], planHistory = recentSessions, weekPhases = [], checkIn = {}, today = new Date() }) {
  const { dates, blockStart, fullBlockStart, blockEnd } = blockDates(planHistory, weekPhases, today)
  const originDate = planOriginDate(planHistory, today)
  const { tier, reasons, hasSubstantialLog } = computeExperienceTier(profile, recentSessions)
  const progressionReference = profile.sport === 'triathlon'
    ? {
        swimKm: latestCompletedLoadWeekDistance(planHistory, weekPhases, 'swim', originDate, blockStart),
        bikeKm: latestCompletedLoadWeekDistance(planHistory, weekPhases, 'bike', originDate, blockStart),
        runKm: latestCompletedLoadWeekDistance(planHistory, weekPhases, 'run', originDate, blockStart),
      }
    : { runKm: latestCompletedLoadWeekDistance(planHistory, weekPhases, 'run', originDate, blockStart) }
  const weeks = []
  const grouped = new Map()
  for (const d of dates) {
    const ws = dateKey(startOfWeekMon(d))
    if (!grouped.has(ws)) grouped.set(ws, [])
    grouped.get(ws).push(d)
  }
  for (const weekDates of grouped.values()) {
    const weekStart = startOfWeekMon(weekDates[0])
    const weekNumber = weekNumberForStart(originDate, weekStart)
    const phase = choosePhase(profile, recentSessions, weekPhases, weekStart, weekNumber)
    const result = profile.sport === 'triathlon'
      ? triWeek(profile, weekDates, phase, tier, checkIn, progressionReference, weekNumber)
      : runningWeek(profile, weekDates, phase, tier, checkIn, progressionReference.runKm, weekNumber)
    if (profile.sport === 'running' && profile.runningDistance === 'marathon' && profile.competitionDate) {
      const budget = marathonBudget({ profile, history: planHistory, origin: originDate,
        week: { calendarStart: dateKey(weekDates[0]), calendarEnd: dateKey(weekDates.at(-1)), partial: weekDates.length < 7, phase },
        previousKm: latestCompletedLoadWeekDistance(planHistory, weekPhases, 'run', originDate, blockStart), checkIn })
      const long = result.sessions.find(s => s.role === 'long')
      const others = result.sessions.filter(s => s !== long)
      const allocation = allocateRoundedTotal(Math.max(0, budget.km - (long ? budget.longKm : 0)), others.map(s => s.role === 'quality' ? 1.2 : 1), 0.5)
      if (long) long.targetDistanceKm = budget.longKm
      others.forEach((s, i) => { s.targetDistanceKm = allocation[i] })
      result.sessions = result.sessions.filter(s => s.targetDistanceKm > 0)
      result.sessions.forEach(s => { s.seasonAnchor = budget.anchor; s.distanceLed = s.role !== 'quality' })
      result.targets.runKm = result.sessions.reduce((sum, s) => sum + s.targetDistanceKm, 0)
      result.marathonPlan = budget
    }
    // Only complete generated weeks become the progression reference for the
    // next generated week. A partial Week 0 must never suppress Week 1.
    if (weekDates.length === 7 && !['recovery', 'taper'].includes(phase)) {
      if (profile.sport === 'triathlon') Object.assign(progressionReference, result.targets)
      else progressionReference.runKm = result.targets.runKm
    }
    const weekLabel = `Week ${weekNumber}`
    const sessions = result.sessions.map((session) => ({ ...session, weekNumber, weekLabel }))
    weeks.push({
      weekStart: dateKey(weekStart),
      calendarStart: dateKey(weekDates[0]),
      calendarEnd: dateKey(weekDates.at(-1)),
      weekNumber,
      weekLabel,
      phase,
      partial: weekDates.length < 7,
      ...result,
      sessions,
    })
  }
  // The event is a real calendar entry, not a normal long run. Race week
  // training totals exclude the event; the following seven days are recovery.
  if (profile.competitionDate) {
    const raceDate = dateKey(profile.competitionDate)
    for (const week of weeks) {
      week.sessions = week.sessions.filter(s => s.date < raceDate || s.date > dateKey(addDays(asDate(profile.competitionDate), 7)))
      for (const s of week.sessions) {
        const days = Math.round((asDate(profile.competitionDate) - asDate(s.date)) / 86400000)
        if (days > 0 && days <= 7 && s.role === 'long') { s.role = 'easy'; s.targetDistanceKm = Math.min(s.targetDistanceKm, 5) }
        if (days > 0 && days <= 7 && s.discipline === 'brick') {
          s.brickTargets = { bikeKm: Math.min(s.brickTargets.bikeKm, 10), runKm: Math.min(s.brickTargets.runKm, 2) }
        }
      }
      if (raceDate >= week.calendarStart && raceDate <= week.calendarEnd) {
        week.isRaceWeek = true
        if (!week.trainingDates.includes(raceDate)) {
          const removed = week.trainingDates.at(-1)
          week.sessions = week.sessions.filter(s => s.date !== removed)
          week.trainingDates = [...week.trainingDates.filter(d => d !== removed), raceDate].sort()
        }
        const discipline = profile.sport === 'running' ? 'run' : 'other'
        const legs = profile.sport === 'running' ? [{ discipline: 'run', km: RUNNING_META[profile.runningDistance].distanceKm }]
          : Object.entries(TRIATHLON_META[profile.triathlonDistance].legs).map(([discipline, km]) => ({ discipline, km }))
        week.sessions.push({ skeletonId: `${raceDate}-race`, date: raceDate, discipline, role: 'race', isRace: true,
          phase: week.phase, weekNumber: week.weekNumber, weekLabel: week.weekLabel,
          targetDistanceKm: legs.reduce((sum, leg) => sum + leg.km, 0), targetDurationMin: null, isOptional: false,
          endurancePrescription: { version: 1, id: `endurance-v1:${raceDate}-race`, discipline, purpose: 'race', family: 'event',
            feedbackRequired: false, distanceIsEstimate: false, rationale: 'Race event. Goal time is an aspiration, not a required pace. Event distance is excluded from training-volume progression.',
            steps: legs.map((leg, i) => ({ stepId: `${raceDate}:race:${i}`, stepType: 'race', discipline: leg.discipline,
              distanceM: leg.km * 1000, durationSeconds: null, exercise: `Race ${leg.discipline}`, duration: null,
              paceOrPower: 'Race effort according to current readiness; no forced goal pace', target: null, rest: null, setsCount: 1 })) } })
      }
      if (week.calendarStart > raceDate && week.calendarStart <= dateKey(addDays(asDate(profile.competitionDate), 7))) week.postRaceRecovery = true
    }
  }
  // Endurance dates in both weeks are known before placing strength, so a
  // Sunday lower-body session cannot ignore next Monday's key workout.
  const runGoal = parseDurationSeconds(profile.sport === 'running' ? profile.goalOverallTime : profile.goalRunTime)
  const swimGoal = parseDurationSeconds(profile.goalSwimTime)
  const runKm = profile.sport === 'running' ? RUNNING_META[profile.runningDistance]?.distanceKm : TRIATHLON_META[profile.triathlonDistance]?.legs.run
  const swimKm = TRIATHLON_META[profile.triathlonDistance]?.legs.swim
  const endurancePlan = applyEndurancePlanning({ profile, weeks, history: planHistory, today, checkIn, qualityCap: EXPERIENCE_RULES[tier].maxQualitySessions,
    goals: { run: runGoal && runKm ? runGoal / runKm : null, swim: swimGoal && swimKm ? swimGoal / (swimKm * 10) : null } })
  const endurance = weeks.flatMap((week) => week.sessions)
  const priorStrength = planHistory.filter((s) => s.discipline === 'gym'
    && asDate(s.date) >= addDays(blockStart, -2) && asDate(s.date) < blockStart)
  for (const week of weeks) {
    const strength = placeStrengthWeek({ profile, week, checkIn, endurance, priorStrength, history: planHistory })
    week.sessions.push(...strength.sessions)
    week.strengthPlan = strength.strengthPlan
    priorStrength.push(...strength.sessions)
  }
  return {
    version: 5,
    endurancePlan,
    planOriginDate: dateKey(originDate),
    blockStart: dateKey(blockStart),
    fullBlockStart: dateKey(fullBlockStart),
    blockEnd: dateKey(blockEnd),
    athleteState: { experienceTier: tier, experienceReasons: reasons, hasSubstantialLog, checkIn: { ...checkIn } },
    weeks,
  }
}

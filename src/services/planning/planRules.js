import { RUNNING_META, TRIATHLON_META } from '../../db/raceDistance.js'
import { normalizeFitness, formatFitness } from './fitness.js'

export const EXPERIENCE_RULES = {
  Beginner: { maxWeeklyIncrease: 0.05, minRestDays: 2, maxQualitySessions: 1 },
  Intermediate: { maxWeeklyIncrease: 0.07, minRestDays: 1, maxQualitySessions: 2 },
  Advanced: { maxWeeklyIncrease: 0.10, minRestDays: 1, maxQualitySessions: 3 },
}

export const RUNNING_VOLUME_RANGES = {
  fiveK: { buildUp: [15, 25], endurance: [25, 35], peak: [30, 40], taper: [15, 20] },
  tenK: { buildUp: [20, 30], endurance: [30, 45], peak: [40, 55], taper: [20, 25] },
  halfMarathon: { buildUp: [25, 35], endurance: [35, 55], peak: [50, 65], taper: [25, 35] },
  marathon: { buildUp: [30, 45], endurance: [45, 70], peak: [65, 85], taper: [30, 45] },
}

export const TRIATHLON_VOLUME_RANGES = {
  sprint: { swim: [4, 8], bike: [60, 120], run: [15, 30] },
  olympic: { swim: [6, 12], bike: [100, 180], run: [20, 40] },
  halfIronman: { swim: [8, 15], bike: [150, 280], run: [25, 45] },
  ironman: { swim: [10, 18], bike: [200, 350], run: [30, 55] },
}

export const TAPER_FACTOR = 0.5
export const RECOVERY_DELOAD_FACTORS = { Beginner: 0.70, Intermediate: 0.75, Advanced: 0.80 }
export const LOAD_WEEK_RANGE_FRACTIONS = { Beginner: [0.35, 0.50, 0.65], Intermediate: [0.45, 0.62, 0.78], Advanced: [0.50, 0.68, 0.85] }
export const PHASE_WINDOWS_DAYS = { endurance: 84, peak: 35, taperDefault: 14, taperMarathon: 21 }
export const DISTANCE_TOLERANCE = { fraction: 0.05, absoluteKm: 0.5 }


export function loadWeekRangeTarget(range, tier, loadWeekIndex = 0, lowerBias = false) {
  const [low, high] = range
  const fractions = LOAD_WEEK_RANGE_FRACTIONS[tier] ?? LOAD_WEEK_RANGE_FRACTIONS.Intermediate
  const index = Math.max(0, Math.min(2, Math.trunc(loadWeekIndex)))
  const bias = lowerBias ? 0.12 : 0
  const fraction = Math.max(0.2, fractions[index] - bias)
  return low + (high - low) * fraction
}

export function recoveryWeekTarget(previousLoad, tier, step = 0.5) {
  const previous = Number(previousLoad)
  if (!Number.isFinite(previous) || previous <= 0) return null
  const factor = RECOVERY_DELOAD_FACTORS[tier] ?? RECOVERY_DELOAD_FACTORS.Intermediate
  return Math.round((previous * factor) / step) * step
}

export function computeExperienceTier(profile, recentSessions = []) {
  let beginnerPoints = 0
  let advancedPoints = 0
  const reasons = []
  const isTri = profile.sport === 'triathlon'
  const disciplinePriorExperience = isTri ? profile.onboardingTriPriorExperience : profile.onboardingAlreadyRuns

  if (profile.onboardingPriorStructuredPlan === false) { beginnerPoints++; reasons.push('never followed a structured training plan before') }
  else if (profile.onboardingPriorStructuredPlan === true) { advancedPoints++; reasons.push('has followed a structured training plan before') }

  if (profile.onboardingConsistencyRating === 'Not tested yet' || profile.onboardingConsistencyRating === 'I struggle with consistency') {
    beginnerPoints++; reasons.push(`self-rated consistency: "${profile.onboardingConsistencyRating}"`)
  } else if (profile.onboardingConsistencyRating === 'Very consistent') {
    advancedPoints++; reasons.push('self-rated consistency: "Very consistent"')
  }

  if (disciplinePriorExperience === false) { beginnerPoints++; reasons.push(isTri ? 'no prior triathlon completed' : 'new to running') }
  else if (disciplinePriorExperience === true) { advancedPoints++; reasons.push(isTri ? 'has completed triathlon(s) before' : 'already running before this plan') }

  const hasKnownNumbers = profile.onboardingKnowsThreshold === true || (profile.onboardingAlreadyRuns === true && !!profile.onboardingCurrentRacePace?.trim())
  if (hasKnownNumbers) { advancedPoints++; reasons.push('has known threshold/FTP or current race pace numbers') }

  const tier = beginnerPoints > advancedPoints ? 'Beginner' : advancedPoints > beginnerPoints ? 'Advanced' : 'Intermediate'
  return { tier, reasons, hasSubstantialLog: recentSessions.length >= 15 }
}

export function recommendedTrainingDays(profile) {
  return profile.sport === 'triathlon'
    ? TRIATHLON_META[profile.triathlonDistance]?.minTrainingDaysPerWeek ?? 4
    : RUNNING_META[profile.runningDistance]?.minTrainingDaysPerWeek ?? 3
}

export function clampTrainingDays(value) {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) ? Math.min(7, Math.max(1, n)) : 3
}

export function recoveryFactor(checkIn = {}) {
  let factor = 1
  if (checkIn.recovery === 'fatigued') factor *= 0.9
  if (checkIn.recovery === 'veryFatigued') factor *= 0.8
  if (checkIn.previousBlockLoad === 'tooHard') factor *= 0.9
  if (checkIn.painLevel === 'mild') factor *= 0.9
  if (checkIn.painLevel === 'significant') factor *= 0.7
  return Math.max(0.6, factor)
}

export function lifestyleFactor(profile) {
  const sleep = Number.parseFloat(profile.onboardingSleepHours)
  const activeJob = profile.onboardingJobType === 'Physically active job'
  const lowSleep = Number.isFinite(sleep) && sleep < 6.5
  return activeJob || lowSleep ? 0.9 : 1
}

export function midpoint([low, high], lowerBias = false) {
  return lowerBias ? low + (high - low) * 0.35 : (low + high) / 2
}

export function parseDurationSeconds(raw) {
  if (!raw || typeof raw !== 'string') return null
  const parts = raw.trim().split(':').map(Number)
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] > 0 ? parts[0] : null
}

export function formatPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return null
  const total = Math.round(secPerKm)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/km`
}

export function runningPaceTargets(profile, distanceKm = null, goalTime = null) {
  const km = distanceKm ?? RUNNING_META[profile.runningDistance]?.distanceKm
  const seconds = parseDurationSeconds(goalTime ?? profile.goalOverallTime)
  const race = km && seconds ? seconds / km : null
  const baseline = normalizeFitness(profile.trainingFitness).run
  return {
    racePace: race == null ? null : formatPace(race),
    easyPace: baseline.value == null ? null : formatPace(baseline.value * 1.25),
    thresholdPace: baseline.value == null ? null : formatPace(baseline.value),
    intervalPace: null,
    baselineStatus: baseline.status,
  }
}

export function triathlonNumericTargets(profile) {
  const meta = TRIATHLON_META[profile.triathlonDistance]
  if (!meta) return {}
  const swimSeconds = parseDurationSeconds(profile.goalSwimTime)
  const bikeSeconds = parseDurationSeconds(profile.goalBikeTime)
  const fitness = normalizeFitness(profile.trainingFitness)
  return {
    swimPacePer100m: swimSeconds ? `${formatPace(swimSeconds / (meta.legs.swim * 10))?.replace('/km', '/100m')}` : null,
    bikeSpeedKph: bikeSeconds ? Math.round((meta.legs.bike / (bikeSeconds / 3600)) * 10) / 10 : null,
    ftpWatts: fitness.bike.value,
    swimThreshold: fitness.swim.value == null ? null : formatFitness(fitness.swim.value, 'swim'),
    fitness,
    run: runningPaceTargets(profile, meta.legs.run, profile.goalRunTime || ' '),
  }
}

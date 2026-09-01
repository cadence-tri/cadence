import { addDays, asDate, startOfWeekMon, toISODateString } from '../dateUtils.js'
import { dayGap, normalizeFitness, normalizeWorkoutResult } from './fitness.js'
import { parseDurationSeconds, recoveryFactor, lifestyleFactor } from './planRules.js'

// Product targets informed by published plans, not guaranteed outcomes or
// hard physiological limits. A goal alone never establishes current capacity.
export const MARATHON_PEAK_RANGES = { beginner: [45, 55], intermediate: [55, 65], performance: [75, 85] }
const rounded = n => Math.round(n * 2) / 2
export const fullyDone = s => s.sets?.length
  ? s.sets.every(x => x.isCompleted === true && !x.isSkipped)
  : s.isCompleted === true
export function disciplineKm(s, discipline) {
  if (s.isRace || s.endurancePrescription?.purpose === 'race') return 0
  const result = normalizeWorkoutResult(s.workoutResult)
  if (s.discipline === discipline) return result?.actualDistanceKm ?? (discipline === 'swim' ? Number(s.totalDistance) / 1000 : Number(s.totalDistance))
  if (s.discipline === 'brick') return s.endurancePrescription?.legDistancesKm?.[discipline] ?? s.brickTargets?.[`${discipline}Km`] ?? 0
  return 0
}

// This is workload evidence, NOT pace evidence. Completion of a planned
// distance/time budget can support capacity without a structured test result.
// Never mistake the sum of a few completed sessions for a full completed week.
export function completedLoadWeeks(history, discipline, before, origin) {
  const groups = new Map()
  const firstMonday = startOfWeekMon(asDate(origin))
  if (dayGap(firstMonday, origin) !== 0) firstMonday.setDate(firstMonday.getDate() + 7)
  const seen = new Set()
  for (const s of history) {
    const d = asDate(s.date)
    if (!d || s.isRace || s.endurancePrescription?.purpose === 'race') continue
    if (s.discipline !== discipline && !(s.discipline === 'brick' && ['run', 'bike'].includes(discipline))) continue
    const ws = startOfWeekMon(d)
    if (ws < firstMonday || addDays(ws, 6) >= asDate(before)) continue
    const id = s.importKey ?? `${s.date}|${s.discipline}|${s.title}`
    if (seen.has(id)) continue
    seen.add(id)
    const key = toISODateString(ws)
    const g = groups.get(key) ?? { weekStart: key, totalKm: 0, expected: 0, done: 0, phase: s.phase }
    if (!s.isOptional) { g.expected++; if (fullyDone(s)) g.done++ }
    if (fullyDone(s)) g.totalKm += Math.max(0, disciplineKm(s, discipline) || 0)
    groups.set(key, g)
  }
  return [...groups.values()].filter(g => g.expected > 0 && g.done === g.expected && g.totalKm > 0)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export function marathonCategory(profile) {
  const f = normalizeFitness(profile.trainingFitness).run
  const goal = parseDurationSeconds(profile.goalOverallTime)
  const experienced = f.level === 'experienced'
  const background = f.currentWeeklyKm >= 30 || !!profile.onboardingCurrentRacePace?.trim()
  if (experienced && background && goal > 0 && goal <= 3 * 3600) return 'performance'
  return f.level === 'new' ? 'beginner' : 'intermediate'
}
export function marathonBudget({ profile, history, origin, week, previousKm, checkIn }) {
  const f = normalizeFitness(profile.trainingFitness).run
  const category = marathonCategory(profile)
  const range = MARATHON_PEAK_RANGES[category]
  const old = history.find(s => s.endurancePrescription?.seasonAnchor)?.endurancePrescription.seasonAnchor
  const startKm = f.currentWeeklyKm ?? old?.startKm ?? ({ new: 30, regular: 34, experienced: 37 }[f.level])
  const startLongKm = f.longestRunKm ?? old?.startLongKm ?? Math.min(14, startKm * 0.38)
  const peakKm = Math.max(startKm, (range[0] + range[1]) / 2)
  const daysToPeak = Math.max(28, dayGap(origin, profile.competitionDate) - 28)
  const fraction = Math.max(0, Math.min(1, dayGap(origin, week.calendarStart) / daysToPeak))
  const target = (startKm + (peakKm - startKm) * fraction) * lifestyleFactor(profile)
  const reference = previousKm ?? startKm
  const recent = history.filter(s => s.discipline === 'run' && !s.isOptional && dayGap(s.date, week.calendarStart) > 0 && dayGap(s.date, week.calendarStart) <= 14)
  const adherence = recent.length ? recent.filter(fullyDone).length / recent.length : 1
  const adverse = recent.some(s => ['tooHard'].includes(s.workoutResult?.feel) || ['pain', 'fatigue'].includes(s.workoutResult?.context))
  const difficult = recent.some(s => s.workoutResult?.feel === 'difficult')
  const normal = recoveryFactor(checkIn) === 1 && adherence >= 0.8 && !adverse
  let km = normal ? Math.max(reference, Math.min(target, reference * 1.10)) : reference * Math.min(0.9, recoveryFactor(checkIn))
  if (normal && difficult) km = reference
  if (week.phase === 'recovery') km = reference * 0.78
  if (week.phase === 'taper') {
    const days = dayGap(week.calendarStart, profile.competitionDate)
    km = reference * (days <= 7 ? 0.30 : days <= 14 ? 0.50 : 0.70)
  }
  if (week.partial) km *= (dayGap(week.calendarStart, week.calendarEnd) + 1) / 7
  const goalLong = Math.min({ beginner: 28, intermediate: 32, performance: 34 }[category], peakKm * (category === 'performance' ? 0.45 : 0.55))
  const recentLong = history.filter(s => s.discipline === 'run' && s.endurancePrescription?.sessionRole === 'long'
    && !['recovery', 'taper'].includes(s.phase ?? s.endurancePrescription?.trainingPhase) && fullyDone(s) && dayGap(s.date, week.calendarStart) > 0 && dayGap(s.date, week.calendarStart) <= 42)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
  const longReference = recentLong ? disciplineKm(recentLong, 'run') : startLongKm
  let longKm = Math.min(startLongKm + (goalLong - startLongKm) * fraction, longReference * 1.10)
  if (normal && difficult) longKm = longReference
  if (!normal) longKm = longReference * Math.min(0.9, recoveryFactor(checkIn))
  if (week.phase === 'recovery') longKm = longReference * 0.75
  if (week.phase === 'taper') longKm = Math.min(longReference * 0.65, km * 0.4)
  if (week.partial) longKm = Math.min(longKm, km * 0.4)
  longKm = Math.min(longKm, km * (category === 'performance' ? 0.48 : 0.55))
  return { km: rounded(Math.max(1, km)), longKm: rounded(Math.max(0.5, longKm)),
    anchor: { startKm, startLongKm }, category, peakRange: range,
    message: `Marathon ${category}: peak target ${range[0]}–${range[1]} km/week, subject to completion, recovery and available time. ${f.currentWeeklyKm == null ? 'Starting mileage is provisional; enter current consistent mileage and longest comfortable run in Fitness settings.' : ''}` }
}

export function assessmentPhaseKey(profile, week) {
  if (!['buildUp', 'endurance', 'peak'].includes(week.phase) || week.partial) return null
  const cycle = profile.competitionDate ?? `cycle-${Math.floor(Math.max(0, week.weekNumber - 1) / 16)}`
  return `${cycle}:${week.phase}`
}

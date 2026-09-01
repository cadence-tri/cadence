import { parseImportDate, toISODateString, daysBetween } from '../dateUtils.js'

export const DISCIPLINES = ['run', 'bike', 'swim']
export const FITNESS_POLICY_VERSION = 1
export const OPTIONAL_NOTE = 'Optional: skip this session if you feel unusually tired or heavy. Prioritize rest; there is no need to make it up.'
const finite = (v) => v !== '' && v != null && typeof v !== 'boolean' && Number.isFinite(Number(v)) ? Number(v) : null
export function calendarDay(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return parseImportDate(v)
  if (v == null || v === '') return null
  const date = v instanceof Date ? v : new Date(v)
  return Number.isFinite(date.getTime()) ? parseImportDate(toISODateString(date)) : null
}
export function dayGap(a, b) {
  const first = calendarDay(a), last = calendarDay(b)
  return first && last ? daysBetween(first, last) : Infinity
}
export function paceSeconds(raw) {
  if (typeof raw === 'number') return raw > 0 ? raw : null
  const m = String(raw ?? '').trim().match(/^(\d{1,2})\s*[:'’′]\s*(\d{1,2})(?:\s*["'’”″]{1,2})?\s*(?:\/(?:km|100\s*m))?$/i)
  return m && Number(m[2]) < 60 && Number(m[1]) * 60 + Number(m[2]) > 0 ? Number(m[1]) * 60 + Number(m[2]) : null
}
export function formatFitness(value, discipline) {
  if (!Number.isFinite(value)) return 'Effort-led'
  if (discipline === 'bike') return `${Math.round(value)} W`
  const seconds = Math.round(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}/${discipline === 'swim' ? '100m' : 'km'}`
}
export function normalizeFitness(raw = {}) {
  return Object.fromEntries(DISCIPLINES.map((disc) => {
    const r = raw?.[disc] ?? {}
    const n = finite(r.value)
    const valid = n != null && n >= (disc === 'bike' ? 30 : disc === 'swim' ? 30 : 120) && n <= (disc === 'bike' ? 700 : 1200)
    const source = ['personal', 'test', 'race'].includes(r.source) ? r.source : 'personal'
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r.assessedOn ?? '') && parseImportDate(r.assessedOn) ? r.assessedOn : null
    return [disc, {
      value: valid ? n : null, source, assessedOn: date,
      status: valid && source !== 'personal' && date && r.status === 'assessed' ? 'assessed' : 'provisional',
      level: ['new', 'regular', 'experienced'].includes(r.level) ? r.level : 'new',
      maxSessionMinutes: finite(r.maxSessionMinutes) == null ? null : Math.max(15, Math.min(300, Math.round(Number(r.maxSessionMinutes)))),
      comfortableSwimMeters: disc === 'swim' && finite(r.comfortableSwimMeters) != null ? Math.max(25, Math.min(10000, Math.round(Number(r.comfortableSwimMeters)))) : null,
      currentWeeklyKm: disc === 'run' && finite(r.currentWeeklyKm) != null ? Math.max(1, Math.min(250, Number(r.currentWeeklyKm))) : null,
      longestRunKm: disc === 'run' && finite(r.longestRunKm) != null ? Math.max(1, Math.min(80, Number(r.longestRunKm))) : null,
    }]
  }))
}

export function updateFitness(profile, discipline, fields, today = new Date()) {
  const before = normalizeFitness(profile.trainingFitness)
  const next = normalizeFitness({ ...before, [discipline]: { ...before[discipline], ...fields } })
  const changed = JSON.stringify(before[discipline]) !== JSON.stringify(next[discipline])
  return {
    trainingFitness: next,
    fitnessHistory: changed ? [...(profile.fitnessHistory ?? []), { discipline, before: before[discipline], after: next[discipline], confirmedAt: today.toISOString() }] : (profile.fitnessHistory ?? []),
  }
}

export function normalizeWorkoutResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return {
    outcome: ['asPrescribed', 'modified', 'stopped'].includes(raw.outcome) ? raw.outcome : null,
    feel: ['comfortable', 'controlled', 'difficult', 'tooHard'].includes(raw.feel) ? raw.feel : null,
    recovery: ['asPrescribed', 'extended'].includes(raw.recovery) ? raw.recovery : null,
    completedReps: finite(raw.completedReps) == null ? null : Math.max(0, Math.min(100, Math.trunc(Number(raw.completedReps)))),
    actualValue: finite(raw.actualValue) != null && Number(raw.actualValue) > 0 ? Number(raw.actualValue) : null,
    actualDistanceKm: finite(raw.actualDistanceKm) != null && Number(raw.actualDistanceKm) > 0 ? Number(raw.actualDistanceKm) : null,
    actualDurationMinutes: finite(raw.actualDurationMinutes) != null && Number(raw.actualDurationMinutes) > 0 ? Number(raw.actualDurationMinutes) : null,
    context: ['normal', 'fatigue', 'conditions', 'pain'].includes(raw.context) ? raw.context : 'normal',
    recordedAt: typeof raw.recordedAt === 'string' ? raw.recordedAt : null,
  }
}

// Evidence is athlete-entered performance, never generated text or completion
// alone. Deduplicate by session identity; exclude future dates and stale work.
export function evidenceFor(history, discipline, today = new Date()) {
  const seen = new Set()
  return [...history].sort((a, b) => String(b.date).localeCompare(String(a.date))).filter((s) => {
    const p = s.endurancePrescription
    const r = normalizeWorkoutResult(s.workoutResult)
    if (s.prescriptionEdited || s.discipline !== discipline || p?.version !== 1 || !p?.baseline || !Array.isArray(p.steps) || !p?.feedbackRequired || !r?.outcome || !r.feel || !r.recovery) return false
    const age = dayGap(s.date, today)
    if (age < 0 || age > 42 || (r.recordedAt && (!Number.isFinite(dayGap(r.recordedAt, today)) || dayGap(r.recordedAt, today) < 0))) return false
    const key = s.importKey ?? `${s.date}|${s.discipline}|${s.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map((s) => ({ session: s, prescription: s.endurancePrescription, result: normalizeWorkoutResult(s.workoutResult) }))
}
export const successfulEvidence = (e) => e.result.outcome === 'asPrescribed'
  && ['comfortable', 'controlled'].includes(e.result.feel) && e.result.recovery === 'asPrescribed'
  && e.result.context === 'normal'
  && (e.result.completedReps == null || e.result.completedReps >= e.prescription.repetitions)
  && (e.result.actualValue == null || e.prescription.target?.low == null || (e.prescription.discipline === 'bike'
    ? e.result.actualValue >= e.prescription.target.low * 0.98
    : e.result.actualValue <= e.prescription.target.high * 1.02))

export function resolveFitness(profile, discipline, history = [], today = new Date()) {
  const baseline = normalizeFitness(profile.trainingFitness)[discipline]
  const evidence = evidenceFor(history, discipline, today).filter((e) => e.prescription.baseline.value === baseline.value)
  const successful = evidence.filter(successfulEvidence)
  const stale = !!baseline.assessedOn && (dayGap(baseline.assessedOn, today) > 84 || dayGap(baseline.assessedOn, today) < 0)
  const established = baseline.value != null && (!stale || successful.length >= 3) && (baseline.status === 'assessed' || successful.length >= 3)
  const effortEstablished = successful.some(e => e.prescription.purpose === 'assessment') || successful.length >= 3
  const comfortable = evidence.slice(0, 2).length === 2 && evidence.slice(0, 2).every((e) => successfulEvidence(e) && e.result.feel === 'comfortable')
  // Moving toward a personal estimate changes the prescription, NOT baseline.
  const approach = established ? 1 : comfortable ? 0.98 : successful.length >= 2 ? 0.94 : 0.90
  const powerAvailable = profile.bikePowerAvailable === true || (profile.bikePowerAvailable == null && /smart trainer|power meter/i.test(profile.onboardingBikeSetup ?? '') && !/no power meter/i.test(profile.onboardingBikeSetup ?? ''))
  const workingValue = baseline.value == null || (discipline === 'bike' && !powerAvailable) ? null : discipline === 'bike'
    ? Math.round(baseline.value * approach) : Math.round(baseline.value / approach)
  return { ...baseline, stale, established, effortEstablished, workingValue, evidenceCount: evidence.length,
    explanation: discipline === 'bike' && !powerAvailable ? 'No power-capable setup confirmed: effort-led cycling; FTP estimate retained for reference.' : baseline.value == null ? 'No confirmed numerical input: effort-led training; no numerical pace is inferred.'
      : stale ? 'Baseline needs review; conservative calibration, not an automatic fitness reduction.'
        : established ? 'Working from the recorded baseline and recent evidence.'
          : comfortable ? 'Repeated comfortable feedback: move closer to the personal estimate, without changing it.'
            : 'Personal estimate: conservative calibration; completion alone does not verify pace/power.' }
}

// A candidate is deliberately a review request, not a newly asserted threshold.
export function baselineReview(profile, discipline, history, today = new Date()) {
  const state = resolveFitness(profile, discipline, history, today)
  const evidence = evidenceFor(history, discipline, today)
  const newest = evidence[0]
  const assessment = evidence.find(e => e.prescription.purpose === 'assessment' && successfulEvidence(e))
  if (assessment && state.value == null) return assessment.result.actualValue == null
    ? 'Phase assessment completed: continue effort-led progression. Record measured main-work pace/power if available; short repetitions alone do not establish a threshold. Confirm a supported estimate in Fitness settings.'
    : 'Measured phase-assessment feedback is available. Review it in Fitness settings and confirm a supported baseline; no threshold was inferred automatically.'
  if (newest && ['stopped', 'modified'].includes(newest.result.outcome) && newest.result.feel === 'tooHard') {
    return 'Recent work was too hard. Review pace/power, recovery and workload; no baseline was changed.'
  }
  if (state.stale) return 'Your baseline is older than 12 weeks or has an invalid future date. Consider reassessment.'
  const strong = evidence.filter((e) => successfulEvidence(e) && e.result.actualValue != null && e.prescription.workSeconds >= 1200 && e.prescription.recoverySeconds <= 90)
  if (strong.length >= 2 && (!state.assessedOn || dayGap(state.assessedOn, today) >= 28)) {
    return 'Repeated sustained results are available. Consider a fresh assessment; confirm any baseline change in Fitness settings.'
  }
  return null
}

export function fitnessFingerprint(profile) {
  return JSON.stringify({ fitness: normalizeFitness(profile.trainingFitness), sport: profile.sport,
    background: Object.fromEntries(Object.entries(profile).filter(([key]) => key.startsWith('onboarding')).sort(([a], [b]) => a.localeCompare(b))),
    goals: [profile.goalOverallTime, profile.goalSwimTime, profile.goalBikeTime, profile.goalRunTime],
    distance: [profile.runningDistance, profile.triathlonDistance], race: profile.competitionDate,
    days: profile.trainingDaysPerWeek, longDays: profile.longSessionDays, pool: profile.onboardingPoolDaysPerWeek, power: [profile.bikePowerAvailable, profile.onboardingBikeSetup],
    strength: [profile.strengthSessionsPerWeek, profile.excludeGymSessions, profile.bodyweightOnlyStrength] })
}
export function evidenceFingerprint(history, today = new Date()) {
  return JSON.stringify(history.filter((s) => s.endurancePrescription && dayGap(s.date, today) >= 0 && dayGap(s.date, today) <= 42
    && (s.workoutResult || (s.sets?.length && s.sets.every((set) => set.isCompleted && !set.isSkipped))))
    .map((s) => ({ key: s.importKey ?? `${s.date}|${s.discipline}|${s.title}`, date: s.date,
      result: normalizeWorkoutResult(s.workoutResult), edited: !!s.prescriptionEdited, family: s.endurancePrescription.family,
      stage: s.endurancePrescription.loadStage, completed: s.sets?.every((set) => set.isCompleted && !set.isSkipped) ?? false }))
    .sort((a, b) => a.key.localeCompare(b.key)))
}

import { asDate, parseImportDate, toISODateString, daysBetween } from '../dateUtils.js'
import { jsDayToWeekdayValue } from '../../db/raceDistance.js'
import { OPTIONAL_NOTE } from './fitness.js'

export const MAX_STRENGTH_SESSIONS = 4
export function normalizeStrengthFrequency(value) {
  if (value == null || value === '' || typeof value === 'boolean') return 1
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_STRENGTH_SESSIONS, Math.trunc(n))) : 1
}
export function requestedStrengthSessions(profile) {
  return profile.excludeGymSessions && !profile.bodyweightOnlyStrength
    ? 0 : normalizeStrengthFrequency(profile.strengthSessionsPerWeek)
}
export function strengthFocuses(count) {
  return ({ 0: [], 1: ['fullBody'], 2: ['upperBody', 'lowerBody'],
    3: ['upperBody', 'lowerBody', 'fullBody'],
    4: ['upperBody', 'lowerBody', 'upperBody', 'lowerBody'] })[count]
}
const EXERCISE_SLOTS = {
  upperBody: ['upperPush', 'upperPull', 'shoulder', 'core'],
  lowerBody: ['squat', 'hinge', 'singleLeg', 'core'],
  fullBody: ['squatOrHinge', 'upperPush', 'upperPull', 'singleLegOrCarry', 'core'],
}
export const STRENGTH_SLOT_LABELS = {
  upperPush: 'upper-body push', upperPull: 'upper-body pull', shoulder: 'shoulder press/stability',
  squat: 'squat pattern', hinge: 'hip-hinge pattern', singleLeg: 'single-leg pattern',
  squatOrHinge: 'squat or hip-hinge pattern', singleLegOrCarry: 'single-leg pattern or loaded carry',
  core: 'core/abs finisher',
}
export function strengthExerciseSlots(focus, mode = 'normal') {
  const slots = [...(EXERCISE_SLOTS[focus] ?? [])]
  return mode === 'taper' && focus === 'fullBody' ? slots.filter(slot => slot !== 'singleLegOrCarry') : slots
}
export const involvesLowerBody = (focus) => focus !== 'upperBody'
const day = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? parseImportDate(value) : parseImportDate(toISODateString(asDate(value)))
const gap = (a, b) => daysBetween(day(a), day(b))
const isKeyEndurance = (s) => ['run', 'bike', 'brick'].includes(s.discipline)
  && ['quality', 'long', 'brick'].includes(s.role ?? s.skeletonRole)
const exerciseKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const roundedHalf = value => Math.round(value * 2) / 2
const successfulLoad = (session, set) => set?.isCompleted && !set?.isSkipped
  && Number.isFinite(set.weightKg) && set.weightKg > 0
  && Number.isFinite(session.perceivedEffort) && session.perceivedEffort <= 7
  && !['pain', 'fatigue'].includes(session.workoutResult?.context)
const completedLoad = (session, set) => set?.isCompleted && !set?.isSkipped
  && Number.isFinite(set.weightKg) && set.weightKg > 0
  && session.strengthPrescription?.mode === 'normal'

export function strengthLoadPlan({ prescription, history = [], checkIn = {} }) {
  return prescription.exerciseSlots.map(slot => {
    const evidence = history.filter(session => session.discipline === 'gym')
      .flatMap(session => (session.sets ?? []).filter(set => set.slot === slot && set.exercise)
        .map(set => ({ session, set })))
      .sort((a, b) => String(a.session.date).localeCompare(String(b.session.date)))
    const latest = evidence.at(-1)
    const preferredExercise = latest?.set.exercise ?? null
    const sameExercise = evidence.filter(row => exerciseKey(row.set.exercise) === exerciseKey(preferredExercise))
    // Recovery/taper loads are temporary derivatives of the normal working
    // baseline. They remain useful log data but must never become that baseline
    // or every deload would ratchet the next one down by another 10%.
    const normalLoaded = sameExercise.filter(row => completedLoad(row.session, row.set))
    // Repair plans created by the old ratcheting bug without disregarding a
    // genuinely athlete-chosen reduction. A lower normal load is ignored only
    // when it exactly followed Cadence's own lower suggestion; performing less
    // than the suggestion remains valid new evidence.
    const trustedNormalLoaded = normalLoaded.reduce((trusted, row) => {
      const baseline = trusted.at(-1)?.set.weightKg
      const suggested = row.set.suggestedWeightKg
      const followedInvalidReduction = Number.isFinite(baseline) && row.set.weightKg < baseline
        && Number.isFinite(suggested) && Math.abs(row.set.weightKg - suggested) < 0.01
      if (!followedInvalidReduction) trusted.push(row)
      return trusted
    }, [])
    const latestNormalLoaded = trustedNormalLoaded.at(-1)
    if (!latestNormalLoaded) {
      return { slot, action: 'establish', preferredExercise,
        fromWeightKg: null, suggestedWeightKg: null, targetReps: slot === 'core' ? null : 8,
        reason: 'Log a completed normal-session load; recovery/taper loads do not establish a baseline.' }
    }
    const comparable = trustedNormalLoaded.filter(row =>
      row.session.strengthPrescription?.mode === 'normal' && successfulLoad(row.session, row.set))
    const lastTwo = comparable.slice(-2)
    const fromWeightKg = latestNormalLoaded.set.weightKg
    const lastReps = Number.isInteger(latestNormalLoaded.set.reps) ? latestNormalLoaded.set.reps : null
    if (prescription.mode !== 'normal') {
      return { slot, action: 'reduce', preferredExercise, fromWeightKg,
        suggestedWeightKg: roundedHalf(fromWeightKg * 0.9), targetReps: slot === 'core' ? null : 8,
        reason: `${prescription.mode} week: about 10% lighter, no progression; the normal baseline and repetition stage are preserved.` }
    }
    const recoveryOkay = checkIn.recovery === 'normal' && checkIn.previousBlockLoad !== 'tooHard'
      && !['mild', 'significant'].includes(checkIn.painLevel)
    const ready = recoveryOkay && lastTwo.length === 2
      && lastTwo.every(row => row.set.weightKg === lastTwo[0].set.weightKg && row.set.reps === lastTwo[0].set.reps)
    if (!ready) return { slot, action: 'hold', preferredExercise, fromWeightKg,
      suggestedWeightKg: fromWeightKg, targetReps: lastReps,
      reason: 'Repeat the established load until two comparable controlled completions support progression.' }
    if (lastReps != null && lastReps < 10) return { slot, action: 'addRep', preferredExercise, fromWeightKg,
      suggestedWeightKg: fromWeightKg, targetReps: lastReps + 1,
      reason: 'Double progression: add one repetition before increasing load.' }
    const lower = ['squat', 'hinge', 'singleLeg', 'squatOrHinge', 'singleLegOrCarry'].includes(slot)
    const rate = lower ? 0.05 : 0.025
    return { slot, action: 'increaseLoad', preferredExercise, fromWeightKg,
      suggestedWeightKg: Math.max(fromWeightKg + 0.5, roundedHalf(fromWeightKg * (1 + rate))), targetReps: 8,
      reason: 'Two controlled top-of-range completions support a small load increase; use the nearest available load.' }
  })
}

/** Product policy, not a clinical prescription: explicit low-load modes,
 * no strength near race day, and no automatic workouts with significant pain. */
export function strengthWeekPolicy(profile, week, checkIn = {}) {
  const requested = requestedStrengthSessions(profile)
  let target = week.partial ? Math.ceil(requested * (daysBetween(day(week.calendarStart), day(week.calendarEnd)) + 1) / 7) : requested
  let mode = 'normal'
  const messages = []
  if (week.partial && target < requested) messages.push('Introductory partial week: frequency is scaled to the available days.')
  if (week.phase === 'recovery' || (checkIn.recovery !== undefined && checkIn.recovery !== 'normal')
    || checkIn.previousBlockLoad === 'tooHard' || checkIn.painLevel === 'mild') mode = 'deload'
  if (week.phase === 'taper') {
    mode = 'taper'
    target = Math.min(target, 1)
    if (requested) messages.push('Taper: at most one short, light full-body session.')
  } else if (mode === 'deload' && requested) {
    messages.push('Deload: keep frequency where feasible, reduce work sets and session duration; no load progression.')
  }
  if (checkIn.painLevel === 'significant') {
    target = 0
    if (requested) messages.push('Strength omitted because significant pain was reported. Review recovery before resuming.')
  }
  return { requestedSessions: requested, targetSessions: target, mode, messages }
}

export function strengthPrescription(profile, focus, mode) {
  const bodyweight = profile.excludeGymSessions && profile.bodyweightOnlyStrength
  const sets = mode === 'normal' ? 3 : 2
  const fullBody = focus === 'fullBody'
  return {
    focus,
    equipment: bodyweight ? 'bodyweight' : 'gym',
    mode,
    durationMinutes: mode === 'normal' ? (fullBody ? (bodyweight ? 35 : 45) : (bodyweight ? 25 : 35))
      : mode === 'deload' ? (fullBody ? 30 : 25) : 20,
    workSetsMin: sets,
    workSetsMax: sets,
    coreSets: sets,
    maxEffort: mode === 'normal' ? 7 : mode === 'deload' ? 6 : 5,
    coreFinisherRequired: true,
    exerciseSlots: strengthExerciseSlots(focus, mode),
    instructions: mode === 'normal'
      ? 'Controlled work, no sets to failure. Finish with short core/abs work; adapt exercises to reported conditions.'
      : 'Familiar exercises only, easy controlled effort, no sets to failure and no load progression. Reduce total work versus normal weeks. Finish with short, gentle core/abs work adapted to reported conditions.',
  }
}

export function strengthPlacementAllowed({ date, focus, endurance, strength, profile }) {
  if (profile.competitionDate) {
    const daysToRace = gap(date, profile.competitionDate)
    if (daysToRace >= -7 && daysToRace <= 6) return false
  }
  const sameDay = endurance.filter((s) => gap(date, s.date) === 0)
  // Do not increase training days or stack a third session onto a busy day.
  if (sameDay.length >= 2 || strength.some((s) => gap(date, s.date) === 0)) return false
  if (sameDay.some((s) => ['long', 'brick'].includes(s.role))) return false
  if (involvesLowerBody(focus)) {
    if (endurance.some((s) => isKeyEndurance(s) && gap(date, s.date) === 1)) return false
    if (strength.some((s) => involvesLowerBody(s.strengthPrescription?.focus) && Math.abs(gap(date, s.date)) < 2)) return false
  }
  return true
}

/** Fit a whole split rather than greedily allocating the first gym day.
 * If the full split cannot fit, recompute a balanced smaller split and
 * explicitly report requested vs scheduled frequency. */
export function placeStrengthWeek({ profile, week, checkIn, endurance, priorStrength = [], history = [] }) {
  const policy = strengthWeekPolicy(profile, week, checkIn)
  const preferred = new Set(profile.longSessionDays ?? [])
  let chosen = []
  for (let count = policy.targetSessions; count > 0; count--) {
    let best = null
    let bestScore = -Infinity
    const focuses = strengthFocuses(count)
    const search = (index, placed, score) => {
      if (index === focuses.length) {
        if (score > bestScore) { best = placed; bestScore = score }
        return
      }
      const focus = focuses[index]
      for (const date of week.trainingDates) {
        if (!strengthPlacementAllowed({ date, focus, endurance, strength: [...priorStrength, ...placed], profile })) continue
        const workouts = endurance.filter((s) => gap(date, s.date) === 0)
        const highTime = preferred.has(jsDayToWeekdayValue(day(date).getDay()))
        const prescription = strengthPrescription(profile, focus, policy.mode)
        const session = {
          skeletonId: `${date}-gym-${focus}-${index + 1}`,
          date, discipline: 'gym', role: prescription.equipment === 'bodyweight' ? 'bodyweightStrength' : 'strength',
          phase: week.phase, weekNumber: week.weekNumber, weekLabel: week.weekLabel,
          targetDistanceKm: null, targetDurationMin: prescription.durationMinutes,
          intensity: `Strength RPE <= ${prescription.maxEffort}/10`,
          targetPaceOrPower: null, isOptional: checkIn?.recovery === 'fatigued' || checkIn?.previousBlockLoad === 'tooHard', locked: true,
          optionalReason: checkIn?.recovery === 'fatigued' || checkIn?.previousBlockLoad === 'tooHard' ? OPTIONAL_NOTE : null,
          strengthPrescription: prescription,
        }
        // Higher-time dates lead; easy/swim pairings are preferred.
        const easyPairing = workouts.every((s) => s.role === 'easy' || s.discipline === 'swim')
        const adjacent = [...priorStrength, ...placed].some((s) => Math.abs(gap(date, s.date)) === 1)
        search(index + 1, [...placed, session], score + (highTime ? 10 : 0) + (easyPairing ? 4 : 0) - (adjacent ? 2 : 0))
      }
    }
    search(0, [], 0)
    if (best) { chosen = best; break }
  }
  if (chosen.length < policy.targetSessions) {
    policy.messages.push(`Requested ${policy.requestedSessions} strength session(s); only ${chosen.length} of this week's ${policy.targetSessions} target fit. No extra training days, no third daily session, no long/brick-day pairing, no lower-body work the day before key endurance, and at least two calendar days between lower/full-body sessions. Race protection also excludes the final six days before the race, race day, and the following seven days. Review frequency or availability in Profile.`)
  }
  if (chosen.some((s) => endurance.some((e) => gap(s.date, e.date) === 0 && e.role === 'quality'))) {
    policy.messages.push('A strength session shares a quality day: complete the endurance workout first and separate sessions where possible.')
  }
  const sessions = chosen.sort((a, b) => a.date.localeCompare(b.date)).map(session => ({ ...session,
    strengthLoadPlan: strengthLoadPlan({ prescription: session.strengthPrescription, history, checkIn }) }))
  return { sessions, strengthPlan: { ...policy, scheduledSessions: sessions.length } }
}

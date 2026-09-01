import { DISCIPLINES, FITNESS_POLICY_VERSION, OPTIONAL_NOTE, resolveFitness, normalizeFitness, evidenceFor, successfulEvidence, dayGap, formatFitness, fitnessFingerprint, evidenceFingerprint, baselineReview } from './fitness.js'
import { assessmentPhaseKey, fullyDone } from './seasonPlanning.js'
import { recoveryWeekTarget } from './planRules.js'

// Conservative product defaults, not individually measured physiological zones.
// Only one workload dimension changes between adjacent stages.
export const WORK_STAGES = {
  run: [[5, 180, 90], [6, 180, 90], [6, 210, 90], [6, 240, 90], [6, 240, 75]],
  bike: [[3, 300, 150], [4, 300, 150], [4, 360, 150], [4, 420, 150], [4, 420, 120]],
  // Swim work length is metres (pool-compatible); run/bike use seconds.
  swim: [[6, 50, 30], [8, 50, 30], [10, 50, 30], [10, 50, 25], [10, 75, 25]],
}
export const RACE_STAGES = {
  run: [[2, 300, 120], [3, 300, 120], [3, 360, 120], [3, 420, 120], [3, 480, 120]],
  bike: [[2, 480, 180], [3, 480, 180], [3, 600, 180], [3, 720, 180], [3, 720, 150]],
  swim: [[4, 100, 30], [5, 100, 30], [6, 100, 30], [6, 125, 30], [6, 125, 25]],
}
const round = (n, step = 1) => Number((Math.round(n / step) * step).toFixed(6))

function allocateRoundedTotal(total, weights, step) {
  const totalUnits = Math.round(total / step)
  const weightSum = weights.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (!weights.length || weightSum <= 0) return weights.map(() => 0)
  const rawUnits = weights.map((value) => totalUnits * Math.max(0, value) / weightSum)
  const units = rawUnits.map(Math.floor)
  let remaining = totalUnits - units.reduce((sum, value) => sum + value, 0)
  const order = rawUnits.map((raw, index) => ({ index, fraction: raw - Math.floor(raw) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; i < remaining; i++) units[order[i % order.length].index] += 1
  return units.map((value) => round(value * step, step))
}

function setTriDisciplineTotal(week, discipline, totalKm) {
  const portions = []
  for (const session of week.sessions) {
    if (session.discipline === discipline) {
      portions.push({ value: session.targetDistanceKm ?? 0, set: (value) => { session.targetDistanceKm = value } })
    } else if (session.discipline === 'brick' && ['bike', 'run'].includes(discipline)) {
      portions.push({ value: session.brickTargets?.[`${discipline}Km`] ?? 0,
        set: (value) => { session.brickTargets[`${discipline}Km`] = value } })
    }
  }
  const step = discipline === 'swim' ? 0.1 : 0.5
  const allocations = allocateRoundedTotal(totalKm, portions.map((portion) => portion.value), step)
  portions.forEach((portion, index) => portion.set(allocations[index]))
  week.targets[`${discipline}Km`] = round(allocations.reduce((sum, value) => sum + value, 0), step)
}
const isReduced = (week, checkIn) => ['recovery', 'taper'].includes(week.phase) || checkIn.recovery !== 'normal'
  || checkIn.previousBlockLoad === 'tooHard' || checkIn.painLevel !== 'none'
const normalCheckIn = (raw) => ({ recovery: 'normal', previousBlockLoad: 'aboutRight', painLevel: 'none', ...raw })

const BRICK_EVENT_CAP_MINUTES = {
  bike: { sprint: 75, olympic: 120, halfIronman: 180, ironman: 300 },
  run: { sprint: 25, olympic: 40, halfIronman: 60, ironman: 90 },
}
function brickEventCapMinutes(profile, discipline) {
  return BRICK_EVENT_CAP_MINUTES[discipline][profile.triathlonDistance] ?? BRICK_EVENT_CAP_MINUTES[discipline].olympic
}
// Minutes actually logged on the athlete's most recent completed, non-reduced
// brick for this leg. Only completion is required (not structured feedback):
// a quick "mark as done" already sets every set's isCompleted.
function brickPriorMinutes(history, discipline, today) {
  const prior = history.filter((s) => s.discipline === 'brick' && fullyDone(s) && dayGap(s.date, today) >= 0 && dayGap(s.date, today) <= 42 && !['recovery', 'taper'].includes(s.phase))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.endurancePrescription
  return prior?.steps?.filter((s) => s.discipline === discipline).reduce((n, s) => n + (s.durationSeconds ?? 0) / 60, 0) ?? 0
}

// The brick's bike/run legs have a genuine event-specific ceiling — they're a
// race-simulation touch, not meant to carry most of the week's dose. Once
// there's brick history, the leg is capped at that steady-state ceiling (see
// the brick prescription below); whatever it can't carry belongs on the
// week's standalone session(s) for that discipline instead of silently
// vanishing from the week's total. This mirrors the same "don't lose volume
// to an individual duration cap" principle already applied to swim and to
// standalone run/bike sessions. Skipped on an athlete's very first-ever
// brick, where a smaller, deliberately conservative ramp still applies.
function redistributeBrickShortfall({ profile, week, states, history, today }) {
  const brick = week.sessions.find((s) => s.discipline === 'brick')
  if (!brick) return
  for (const disc of ['bike', 'run']) {
    if (!(brickPriorMinutes(history, disc, today) > 0)) continue
    const desiredKm = brick.brickTargets?.[`${disc}Km`] ?? 0
    if (!(desiredKm > 0)) continue
    const target = effortTarget(disc, states[disc], 'brick')
    const conversion = disc === 'bike' ? 3 : (target.high ?? 420) / 60
    const capMinutes = Math.min(brickEventCapMinutes(profile, disc), normalizeFitness(profile.trainingFitness)[disc].maxSessionMinutes ?? Infinity)
    const step = disc === 'swim' ? 0.1 : 0.5
    const shortfall = round(Math.max(0, desiredKm - capMinutes / conversion), step)
    if (!shortfall) continue
    const standalone = week.sessions.filter((s) => s.discipline === disc && !s.isRace)
    if (!standalone.length) continue
    // Largest-remainder allocation, same as every other weekly split in this
    // file, rather than an ad-hoc last-one-gets-the-remainder split — keeps
    // the boost stable and evenly distributed instead of biasing one session.
    const boosts = allocateRoundedTotal(shortfall, standalone.map(() => 1), step)
    standalone.forEach((s, index) => { s.targetDistanceKm = round((s.targetDistanceKm ?? 0) + boosts[index], step) })
  }
}

export function swimSessionCap(profile, history, today) {
  const f = normalizeFitness(profile.trainingFitness).swim
  const base = { new: 1000, regular: 1800, experienced: 2600 }[f.level]
  const evidence = evidenceFor(history, 'swim', today).filter(successfulEvidence)
  const actualMeters = evidence.map((e) => (e.result.actualDistanceKm ?? e.prescription.estimatedDistanceKm) * 1000).filter((n) => n > 0)
  const demonstrated = actualMeters.length >= 2 ? Math.min(...actualMeters.slice(0, 2)) : null
  const starterTimeMeters = ({ new: 35, regular: 50, experienced: 65 }[f.level]) * 60 / ((f.value ?? 180) * 1.4) * 100
  const starter = Math.min(base, starterTimeMeters)
  const byExperience = demonstrated ? Math.min(4000, Math.max(starter, demonstrated * 1.05)) : starter
  const ability = f.comfortableSwimMeters ? Math.max(100, f.comfortableSwimMeters * 4, demonstrated ? demonstrated * 1.05 : 0) : byExperience
  // Include drill/rest time; unknown pace uses a conservative time budget only,
  // not a claimed fitness estimate or prescribed numerical speed.
  const timeCap = f.maxSessionMinutes ? f.maxSessionMinutes * 60 / ((f.value ?? 180) * 1.4) * 100 : Infinity
  return Math.max(100, Math.floor(Math.min(byExperience, ability, timeCap) / 25) * 25)
}

export function constrainSwimWeek({ profile, week, history, today, checkIn = {} }) {
  const all = week.sessions.filter((s) => s.discipline === 'swim')
  const raw = profile.onboardingPoolDaysPerWeek
  const poolDays = raw !== '' && raw != null && Number.isFinite(Number(raw)) ? Math.max(0, Math.min(7, Math.trunc(Number(raw)))) : 2
  const swims = all.slice(0, poolDays)
  week.sessions = week.sessions.filter((s) => s.discipline !== 'swim' || swims.includes(s))
  const factor = week.phase === 'taper' ? 0.5 : week.phase === 'recovery' || checkIn.recovery === 'fatigued' || checkIn.recovery === 'veryFatigued' || checkIn.previousBlockLoad === 'tooHard' ? 0.7 : 1
  const cap = Math.max(100, Math.floor(swimSessionCap(profile, history, today) * factor / 25) * 25)
  // Put the lower-intensity technique swim closest to the key long/brick
  // session, leaving the other swim eligible for a controlled assessment.
  const keyDates = [...week.sessions.filter((s) => ['long', 'brick'].includes(s.role)).map((s) => s.date),
    ...history.filter(s => s.discipline === 'brick' && dayGap(s.date, week.calendarStart) >= 0 && dayGap(s.date, week.calendarStart) <= 2).map(s => s.date)]
  const techniqueSession = swims.length > 1 ? [...swims].sort((a, b) =>
    Math.min(...keyDates.map((d) => Math.abs(dayGap(a.date, d)))) - Math.min(...keyDates.map((d) => Math.abs(dayGap(b.date, d)))) || b.date.localeCompare(a.date))[0] : null
  let total = 0
  const desiredMeters = Math.floor(Math.min(week.targets.swimKm * 1000, cap * (techniqueSession ? 1.8 : swims.length)) / 25) * 25
  swims.forEach((s, i) => {
    const technique = s === techniqueSession
    // Allocate the whole budget with technique weighting, instead of losing
    // part of an equal split every time the capped total is fed back.
    const regularMeters = Math.min(cap, Math.floor(desiredMeters / (techniqueSession ? 1.8 : Math.max(1, swims.length)) / 25) * 25)
    const meters = technique ? desiredMeters - regularMeters : regularMeters
    s.targetDistanceKm = Math.max(0.1, Math.min(cap, meters) / 1000)
    s.swimTechnique = technique
    total += s.targetDistanceKm
  })
  if (round(total, 0.025) < week.targets.swimKm) week.progressionNotes.push('Swim volume reduced to fit pool access and current session capacity; unused distance is not crammed into other swims.')
  week.targets.swimKm = round(total, 0.025)
  if (!swims.length) week.progressionNotes.push('No pool sessions available: swimming omitted. Review pool access before planning race readiness.')
}

function progressionDecision(profile, disc, history, today, checkIn, state, purpose = 'development') {
  const family = `${disc}:${purpose}`
  const evidence = evidenceFor(history, disc, today).filter((e) => e.prescription.family === family && e.prescription.baseline.value === state.value)
  const last = evidence[0]
  let stage = last?.prescription.loadStage ?? 0
  stage = Math.max(0, Math.min(WORK_STAGES[disc].length - 1, stage))
  let action = 'hold'
  let reason = 'Hold the current workload until comparable feedback supports progression.'
  const successful = evidence.filter((e) => successfulEvidence(e) && !e.prescription.stageLimited && e.prescription.loadStage === stage)
  const bad = last && (last.result.feel === 'tooHard' || last.result.outcome === 'stopped' || last.result.context === 'pain')
  if (bad || checkIn.recovery !== 'normal' || checkIn.previousBlockLoad === 'tooHard' || checkIn.painLevel !== 'none') {
    stage = Math.max(0, stage - 1); action = 'reduce'; reason = 'Reduce workload for recent difficulty or recovery; baseline unchanged.'
  } else if (last && last.prescription.baseline.workingValue !== state.workingValue) {
    reason = 'Working intensity is moving toward the personal estimate; hold repetitions and recovery this block.'
  } else if (successful.length >= 2 && stage < WORK_STAGES[disc].length - 1) {
    stage = Math.min(WORK_STAGES[disc].length - 1, stage + 1); action = 'progress'; reason = 'Two comparable controlled results: progress one workload dimension, not the stored baseline.'
  } else if (state.established && !last && history.filter((s) => !s.prescriptionEdited && s.discipline === disc && s.endurancePrescription?.family === family
    && s.endurancePrescription?.loadStage === stage && dayGap(s.date, today) >= 0 && dayGap(s.date, today) <= 42
    && s.sets?.length && s.sets.every((set) => set.isCompleted && !set.isSkipped)).length >= 3) {
    stage = Math.min(WORK_STAGES[disc].length - 1, stage + 1); action = 'progress'; reason = 'Established baseline, consistent completion and normal block recovery: conservative workload progression only.'
  }
  return { family, stage, action, reason }
}

function effortTarget(disc, state, purpose) {
  const easy = ['easy', 'technique', 'brick'].includes(purpose)
  const race = purpose === 'raceSpecific'
  let low = null, high = null
  if (state.workingValue != null) {
    if (disc === 'bike') { low = round(state.workingValue * (easy ? 0.6 : race ? 0.8 : 0.85)); high = round(state.workingValue * (easy ? 0.72 : race ? 0.87 : 0.93)) }
    else { low = round(state.workingValue * (easy ? 1.18 : race ? 1.05 : 1.0)); high = round(state.workingValue * (easy ? 1.35 : race ? 1.12 : 1.04)) }
  }
  return { unit: disc === 'bike' ? 'watts' : disc === 'swim' ? 'seconds/100m' : 'seconds/km', low, high,
    effortMin: easy ? 2 : 4, effortMax: easy ? 4 : 6 }
}
export function targetText(target, discipline) {
  const numeric = target.low == null ? 'Effort-led' : `${formatFitness(target.low, discipline)}–${formatFitness(target.high, discipline)}`
  return `${numeric}; controlled effort ${target.effortMin}–${target.effortMax}/10 (slow down if needed)`
}
const durationText = (s) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
function step(id, kind, disc, target, { seconds = null, meters = null, label = null, notes = null, rest = null, setsCount = 1 } = {}) {
  return { stepId: id, stepType: kind, durationSeconds: seconds, distanceM: meters,
    target, exercise: label ?? kind, duration: seconds == null ? null : durationText(seconds),
    paceOrPower: targetText(target, disc), rest, setsCount, notes }
}

// Full instructions remain in the local deterministic prescription. The
// focused Coach payload includes only each short exercise label and step ID,
// so useful beginner guidance does not inflate the prompt or depend on the LLM.
export const SWIM_DRILLS = {
  streamlineKick: {
    focus: 'body position and kick',
    label: 'Streamline kick → easy freestyle',
    notes: 'Kick from the hips with small, quiet movements. Keep your head between your arms and hips near the surface; use a board if needed. On the freestyle length, preserve the same long body line.',
  },
  sideKick: {
    focus: 'body position and breathing',
    label: 'Side kick → easy freestyle',
    notes: 'Keep one arm forward and the other at your side. Rotate the whole body slightly to breathe without lifting the head; change sides each repetition. Transfer the same controlled rotation into freestyle.',
  },
  strokeAndRoll: {
    focus: 'breathing and rotation',
    label: 'Stroke-and-roll breathing → easy freestyle',
    notes: 'Exhale continuously while your face is in the water. Rotate with the body to breathe without lifting the head, then swim easy freestyle and breathe whenever needed. Never force breath-holding.',
  },
  catchUp: {
    focus: 'entry and coordination',
    label: 'Catch-up drill → easy freestyle',
    notes: 'Keep one hand extended until the recovering hand enters in front of its shoulder. Do not touch hands, cross the centre line or exaggerate the glide. On the freestyle length, remove the deliberate pause but keep the clean entry.',
  },
  sixKickSwitch: {
    focus: 'rotation timing',
    label: 'Six-kick switch → easy freestyle',
    notes: 'Kick six small beats on one side, take one relaxed stroke to change sides, then repeat. Fins are optional. Transfer the balanced rotation into continuous freestyle without pausing.',
  },
  singleArm: {
    focus: 'pull and breathing timing',
    label: 'Single-arm freestyle → full stroke',
    notes: 'Swim one length with one arm while the other remains forward, then change arms next repetition. Keep the head aligned and use relaxed rotation. Return to full stroke with equal pressure from both arms.',
  },
  frontScull: {
    focus: 'catch and feel for the water',
    label: 'Front scull → easy freestyle',
    notes: 'Keep the elbows slightly higher than the hands and make small inward-and-outward movements. Feel pressure on the palms and forearms, then swim freestyle while pressing water backward rather than downward.',
  },
  fist: {
    focus: 'forearm engagement',
    label: 'Fist drill → open-hand freestyle',
    notes: 'Swim with softly closed fists without increasing effort. Use the forearms during the pull, then open the hands and preserve that same forearm pressure during freestyle.',
  },
  pullBuoy: {
    focus: 'upper-body mechanics',
    label: 'Pull-buoy freestyle → normal freestyle',
    notes: 'If a pull buoy is available, place it high between the thighs, keep the body long and pull backward without forcing the shoulders. Then remove it and restore a light kick. If no buoy is available, use the fist drill instead.',
  },
  fingertipDrag: {
    focus: 'relaxed recovery and entry',
    label: 'Fingertip drag → easy freestyle',
    notes: 'Let the fingertips skim the surface during recovery. Keep the shoulder relaxed and enter in front of the shoulder, then swim normally with the same relaxed recovery.',
  },
  sighting: {
    focus: 'open-water sighting',
    label: 'Pool sighting drill → steady freestyle',
    notes: 'Every six to eight strokes, lift only the eyes briefly, return the face to the water, then take a normal side breath. Continue steady freestyle without losing rhythm or kicking harder.',
  },
}

const SWIM_DRILL_BUNDLES = {
  new: [
    ['streamlineKick', 'catchUp'],
    ['sideKick', 'strokeAndRoll'],
    ['pullBuoy', 'streamlineKick'],
  ],
  regular: [
    ['frontScull', 'fist'],
    ['sixKickSwitch', 'singleArm'],
    ['fingertipDrag', 'catchUp'],
    ['pullBuoy', 'frontScull'],
  ],
  experienced: [
    ['frontScull', 'fist'],
    ['sixKickSwitch', 'singleArm'],
    ['pullBuoy', 'fingertipDrag'],
    ['sighting', 'strokeAndRoll'],
  ],
}

export function swimDrillSelection(profile, week) {
  const level = normalizeFitness(profile.trainingFitness).swim.level
  const bundles = SWIM_DRILL_BUNDLES[level]
  let ids = bundles[Math.abs((week.weekNumber ?? 1) - 1) % bundles.length]
  if (ids.includes('sighting') && !['endurance', 'peak'].includes(week.phase)) {
    ids = ids.map((id) => id === 'sighting' ? 'catchUp' : id)
  }
  return { level, ids, focus: [...new Set(ids.map((id) => SWIM_DRILLS[id].focus))].join(' + ') }
}

function prescription(profile, session, week, state, decision, checkIn, goal, history, today) {
  const disc = session.discipline
  const reduced = isReduced(week, checkIn)
  const development = session.role === 'quality' && !session.suppressDevelopment
  let purpose = session.swimTechnique ? 'technique' : development && !reduced
    ? session.assessmentKey ? 'assessment' : state.established ? 'threshold' : 'development' : 'easy'
  // Race-specific exposure replaces a quality slot, never adds one. Goal
  // reference is advisory until comparable race-specific results support it.
  if (development && !session.assessmentKey && !reduced && (state.established || state.effortEstablished) && ['endurance', 'peak'].includes(week.phase)
    && (session.sequenceInWeek > 0 || week.weekNumber % 2 === 0 || disc === 'swim')) purpose = 'raceSpecific'
  const activeDecision = purpose === 'raceSpecific' ? decision.raceSpecific : decision
  let activeStage = activeDecision.stage
  let [repetitions, workRepSeconds, recoverySeconds] = (purpose === 'raceSpecific' ? RACE_STAGES : WORK_STAGES)[disc][activeStage]
  let stageLimited = false
  if (reduced || week.partial) repetitions = Math.max(2, Math.floor(repetitions / 2))
  let feedbackRequired = !reduced && !week.partial && ['development', 'calibration', 'assessment', 'threshold', 'raceSpecific'].includes(purpose)
  const target = effortTarget(disc, state, purpose)
  let goalUsed = false
  const supported = evidenceFor(history, disc, today).filter((e) => successfulEvidence(e) && e.prescription.purpose === 'raceSpecific' && e.result.actualValue != null)
  if (purpose === 'raceSpecific' && goal != null && disc !== 'bike' && supported.length >= 2
    && supported.slice(0, 2).every((e) => e.result.actualValue <= goal * 1.02)
    && target.low != null && goal >= state.value) {
    target.low = Math.max(goal, target.low * 0.98); target.high = Math.max(target.low, goal * 1.03); goalUsed = true
  }
  const easy = effortTarget(disc, state, 'easy')
  const steps = []
  const add = (kind, t, opts) => steps.push(step(`${session.skeletonId}:${steps.length + 1}`, kind, disc, t, opts))
  let estimatedDistanceKm = session.targetDistanceKm
  let drillSelection = null
  if (disc === 'swim') {
    const total = Math.round(session.targetDistanceKm * 1000 / 25) * 25
    const warm = Math.max(25, Math.floor(total * 0.15 / 25) * 25)
    const cool = Math.max(25, Math.floor(total * 0.1 / 25) * 25)
    add('warmup', easy, { meters: warm, label: 'Easy full-stroke swim', notes: 'Start relaxed. Keep the stroke long and breathe whenever needed.' })
    const available = Math.max(0, total - warm - cool)
    const skillTarget = Math.max(50, Math.round(total * (purpose === 'technique' ? 0.45 : 0.15) / 50) * 50)
    const reserveForMain = available >= 75 ? 25 : 0
    const skillMeters = Math.min(skillTarget, Math.max(0, Math.floor((available - reserveForMain) / 50) * 50))
    const skillRounds = skillMeters / 50
    drillSelection = swimDrillSelection(profile, week)
    const drillIds = drillSelection.ids.slice(0, skillRounds >= 4 ? 2 : 1)
    drillSelection = { ...drillSelection, ids: drillIds,
      focus: [...new Set(drillIds.map((id) => SWIM_DRILLS[id].focus))].join(' + ') }
    let allocatedRounds = 0
    drillIds.forEach((id, index) => {
      const rounds = Math.floor(skillRounds / drillIds.length) + (index < skillRounds % drillIds.length ? 1 : 0)
      if (!rounds) return
      allocatedRounds += rounds
      const drill = SWIM_DRILLS[id]
      add('drill', { ...easy, low: null, high: null }, {
        meters: 50,
        setsCount: rounds,
        rest: '20–30s after each 50m',
        label: drill.label,
        notes: `Each repetition is 25m drill + 25m easy full-stroke transfer. ${drill.notes}`,
      })
    })
    const drill = allocatedRounds * 50
    const remaining = total - warm - cool - drill
    const swimStages = (purpose === 'raceSpecific' ? RACE_STAGES : WORK_STAGES).swim
    while (activeStage > 0 && repetitions * workRepSeconds > remaining && remaining > 0) {
      activeStage--
      stageLimited = true
      ;[repetitions, workRepSeconds, recoverySeconds] = swimStages[activeStage]
      if (reduced || week.partial) repetitions = Math.max(2, Math.floor(repetitions / 2))
    }
    let workMeters = 0
    if (remaining > 0) {
      const repDistance = workRepSeconds
      repetitions = Math.max(1, Math.min(repetitions, Math.floor(remaining / 25)))
      workMeters = Math.min(Math.floor(remaining / repetitions / 25) * 25, repDistance)
      if (workMeters < repDistance) stageLimited = true
      add('work', target, {
        meters: workMeters,
        setsCount: repetitions,
        rest: repetitions > 1 ? `${recoverySeconds}s between repetitions` : null,
        label: purpose === 'technique' ? 'Controlled full-stroke swim — preserve the drill cues' : 'Controlled full-stroke swim',
        notes: 'Keep the stroke controlled and stop or extend the rest if technique deteriorates.',
      })
    } else {
      repetitions = 0
      recoverySeconds = 0
      stageLimited = true
      feedbackRequired = false
    }
    if (remaining - workMeters * repetitions > 0) add('easy', easy, { meters: remaining - workMeters * repetitions, label: 'Easy full-stroke swim; preserve form' })
    add('cooldown', easy, { meters: cool, label: 'Easy cool-down swim', notes: 'Finish relaxed with continuous exhalation and no forced breathing pattern.' })
    workRepSeconds = repetitions ? round(workMeters / 100 * (state.workingValue ?? 180)) : 0
    estimatedDistanceKm = total / 1000
  } else {
    const f = normalizeFitness(profile.trainingFitness)[disc]
    const speed = disc === 'run' ? (easy.high ?? 420) : 180 // seconds/km used only for a labelled distance/time estimate
    const requestedSeconds = Math.max(900, round((session.targetDistanceKm ?? 5) * speed))
    const limits = disc === 'run' ? { new: [50, 90], regular: [65, 120], experienced: [90, 180] } : { new: [75, 120], regular: [100, 180], experienced: [120, 240] }
    const defaultLimit = limits[f.level][session.role === 'long' ? 1 : 0]
    const durations = evidenceFor(history, disc, today).filter(successfulEvidence).map((e) => e.result.actualDurationMinutes).filter((n) => n > 0)
    const supportedLimit = durations.length >= 2 ? Math.max(defaultLimit, Math.min(...durations.slice(0, 2)) * 1.05) : defaultLimit
    // A fallback speed is a display estimate, never evidence that a distance
    // session breaches capacity. Explicit user time limits always take priority.
    const distanceLed = session.distanceLed && purpose === 'easy'
    const distanceLimit = session.role === 'long' ? ({ new: 180, regular: 200, experienced: 210 }[f.level]) : supportedLimit
    const limit = (f.maxSessionMinutes ?? (distanceLed ? state.workingValue == null ? Infinity : distanceLimit : supportedLimit)) * 60
    const totalSeconds = Math.min(limit, requestedSeconds)
    const warm = Math.min(600, round(totalSeconds * 0.2)), cool = Math.min(300, round(totalSeconds * 0.1))
    add('warmup', easy, { seconds: warm, label: 'Easy warm-up' })
    if (['easy', 'technique'].includes(purpose)) {
      repetitions = 1; workRepSeconds = totalSeconds - warm - cool; recoverySeconds = 0
      add('work', easy, { seconds: workRepSeconds, label: session.role === 'long' ? 'Easy endurance' : 'Easy aerobic work' })
    } else {
      const stages = (purpose === 'raceSpecific' ? RACE_STAGES : WORK_STAGES)[disc]
      while (activeStage > 0 && repetitions * workRepSeconds + (repetitions - 1) * recoverySeconds > totalSeconds - warm - cool) {
        activeStage--; stageLimited = true
        ;[repetitions, workRepSeconds, recoverySeconds] = stages[activeStage]
      }
      if (repetitions * workRepSeconds + (repetitions - 1) * recoverySeconds > totalSeconds - warm - cool) stageLimited = true
      while (repetitions > 1 && repetitions * workRepSeconds + (repetitions - 1) * recoverySeconds > totalSeconds - warm - cool) repetitions--
      workRepSeconds = Math.min(workRepSeconds, totalSeconds - warm - cool)
      for (let i = 0; i < repetitions; i++) {
        add('work', target, { seconds: workRepSeconds, label: `${purpose} repetition ${i + 1}` })
        if (i < repetitions - 1) add('recovery', easy, { seconds: recoverySeconds, label: 'Easy recovery' })
      }
      const spare = totalSeconds - warm - cool - repetitions * workRepSeconds - (repetitions - 1) * recoverySeconds
      if (spare > 0) add('easy', easy, { seconds: spare, label: 'Easy aerobic work' })
    }
    add('cooldown', easy, { seconds: cool, label: 'Easy cool-down' })
    estimatedDistanceKm = round(totalSeconds / speed, 0.5)
    if (distanceLed) {
      estimatedDistanceKm = Math.min(session.targetDistanceKm, Math.floor(totalSeconds / speed * 2) / 2)
      const totalMeters = Math.round(estimatedDistanceKm * 1000)
      let allocated = 0
      steps.forEach((s, i) => {
        const meters = i === steps.length - 1 ? totalMeters - allocated : Math.round(totalMeters * s.durationSeconds / totalSeconds)
        allocated += meters
        s.distanceM = meters; s.durationSeconds = null; s.duration = null
      })
    }
  }
  const actualWork = steps.filter((s) => s.stepType === 'work')
  return { version: FITNESS_POLICY_VERSION, discipline: disc, family: activeDecision.family, purpose, loadStage: activeStage, stageLimited,
    assessmentKey: session.assessmentKey ?? null, sessionRole: session.role, trainingPhase: week.phase,
    seasonAnchor: session.seasonAnchor ?? null,
    baseline: { value: state.value, source: state.source, assessedOn: state.assessedOn, status: state.status, workingValue: state.workingValue },
    repetitions, workRepSeconds, recoverySeconds, workSeconds: repetitions * workRepSeconds,
    workDistanceM: actualWork.reduce((sum, s) => sum + (s.distanceM ?? 0) * (s.setsCount ?? 1), 0),
    feedbackRequired, target, goalReference: goal, goalUsed, estimatedDistanceKm,
    distanceIsEstimate: disc !== 'swim' && !session.distanceLed,
    swimDrills: drillSelection ? { level: drillSelection.level, focus: drillSelection.focus, ids: drillSelection.ids } : null,
    rationale: `${state.explanation} ${reduced ? 'Recovery/taper: reduced work, baseline unchanged.' : activeDecision.reason}${stageLimited ? ' Session capacity limits the workout; this is not completion of the full progression stage.' : ''}${purpose === 'technique' ? ' Technique focus: more drills, not a speed test.' : ''}${purpose === 'assessment' ? ' Controlled assessment, not a maximal test. Stop or slow if effort is excessive.' : ''}`,
    steps }
}

export function canonicalEnduranceSets(prescription) {
  return prescription.steps.map((s) => ({ ...s, isCompleted: false, isSkipped: false }))
}

export function applyEndurancePlanning({ profile, weeks, history, today, checkIn: input, goals = {}, qualityCap = 2, experienceTier = 'Intermediate' }) {
  const checkIn = normalCheckIn(input)
  const states = Object.fromEntries(DISCIPLINES.map((d) => [d, resolveFitness(profile, d, history, today)]))
  const decisions = Object.fromEntries(DISCIPLINES.map((d) => [d, { ...progressionDecision(profile, d, history, today, checkIn, states[d]),
    raceSpecific: progressionDecision(profile, d, history, today, checkIn, states[d], 'raceSpecific') }]))
  const assessed = new Set(history.map(s => s.endurancePrescription?.assessmentKey).filter(Boolean))
  // Advance one load dimension at a time. Keep quality stable in blocks where
  // the weekly distance budget grows; pace evidence remains separate.
  for (const disc of DISCIPLINES) {
    const latest = evidenceFor(history, disc, today)[0]?.prescription
    if (latest && weeks.some(w => w.marathonPlan && !['recovery', 'taper'].includes(w.phase) && w.targets[`${disc}Km`] > (latest.weekVolumeTargets?.[`${disc}Km`] ?? Infinity) + 0.5)) {
      if (decisions[disc].action === 'progress') decisions[disc] = { ...decisions[disc], stage: latest.loadStage, action: 'hold', reason: 'Hold quality workload while the weekly volume budget grows.' }
    }
  }
  const keyDays = history.filter((s) => ['run', 'bike', 'brick'].includes(s.discipline)
    && dayGap(s.date, today) >= 0 && dayGap(s.date, today) <= 2
    && (s.endurancePrescription?.feedbackRequired || s.endurancePrescription?.sessionRole === 'long' || s.discipline === 'brick')).map((s) => s.date)
  let previousLoadWeek = null
  for (const week of weeks) {
    week.progressionNotes = week.marathonPlan ? [week.marathonPlan.message] : []
    // The scheduler creates both weeks before prescriptions apply session
    // capacity. For triathlon recovery in Week 2, derive the deload from Week
    // 1's achievable final total rather than its larger preliminary budget.
    if (profile.sport === 'triathlon' && week.phase === 'recovery' && previousLoadWeek) {
      for (const disc of DISCIPLINES) {
        const prior = previousLoadWeek.targets[`${disc}Km`]
        if (!(prior > 0) || !( `${disc}Km` in week.targets)) continue
        setTriDisciplineTotal(week, disc, recoveryWeekTarget(prior, experienceTier, disc === 'swim' ? 0.1 : 0.5))
      }
    }
    for (const disc of DISCIPLINES) {
      const evidence = evidenceFor(history, disc, today)
      const latest = evidence[0]?.prescription
      const changingIntensity = latest && latest.baseline?.workingValue !== states[disc].workingValue
      const previousBudget = latest?.weekVolumeTargets?.[`${disc}Km`]
      const desired = week.targets[`${disc}Km`]
      // Swim is allocated from its evidence-based session cap below, never
      // from the old inflated range. Its <=5% capacity increase is checked
      // together with whether a complete progression stage actually fits.
      if (disc !== 'swim' && changingIntensity && previousBudget > 0 && desired > previousBudget) {
        const ratio = previousBudget / desired
        for (const s of week.sessions) {
          if (s.discipline === disc) s.targetDistanceKm = Math.max(disc === 'swim' ? 0.1 : 0.5, Math.floor(s.targetDistanceKm * ratio * (disc === 'swim' ? 10 : 2)) / (disc === 'swim' ? 10 : 2))
          if (s.discipline === 'brick' && s.brickTargets?.[`${disc}Km`] != null) s.brickTargets[`${disc}Km`] = Math.max(0.5, Math.floor(s.brickTargets[`${disc}Km`] * ratio * 2) / 2)
        }
        week.progressionNotes.push(`${disc}: hold volume while progressing quality workload or working intensity.`)
      }
    }
    // Hold the capacity-adjusted allocations inside a block. This avoids
    // compounding the old weekly-volume ramp with quality progression and
    // avoids repeatedly scaling an already-capped swim target downward.
    if (previousLoadWeek && !isReduced(week, checkIn)) {
      for (const disc of DISCIPLINES) {
        const prior = previousLoadWeek.sessions.filter((s) => s.discipline === disc)
        const next = week.sessions.filter((s) => s.discipline === disc)
        for (const [index, s] of next.entries()) {
          if (prior[index]?.targetDistanceKm != null) s.targetDistanceKm = Math.min(s.targetDistanceKm, prior[index].targetDistanceKm)
        }
      }
      const priorBrick = previousLoadWeek.sessions.find((s) => s.discipline === 'brick')
      for (const s of week.sessions.filter((s) => s.discipline === 'brick')) {
        for (const disc of ['bike', 'run']) if (priorBrick) s.brickTargets[`${disc}Km`] = Math.min(s.brickTargets[`${disc}Km`], priorBrick.brickTargets[`${disc}Km`])
      }
      week.progressionNotes.push('Within-block workload held; the next block will reassess. No automatic weekly speed increase.')
    }
    if (profile.sport === 'triathlon') {
      constrainSwimWeek({ profile, week, history, today, checkIn })
      redistributeBrickShortfall({ profile, week, states, history, today })
    }
    let qualityIndex = 0
    const brickDays = weeks.flatMap((w) => w.sessions.filter((s) => s.discipline === 'brick').map((s) => s.date))
    const longDays = weeks.flatMap((w) => w.sessions.filter((s) => s.role === 'long').map((s) => s.date))
    const firstRun = profile.sport === 'triathlon' ? week.sessions.find((s) => s.discipline === 'run') : null
    const candidates = week.sessions.filter((s) => !s.isRace && (s.role === 'quality' || (s.discipline === 'swim' && !s.swimTechnique) || s === firstRun))
    const priority = week.weekNumber % 2 === 0 ? ['run', 'swim', 'bike'] : ['bike', 'swim', 'run']
    const phaseKey = assessmentPhaseKey(profile, week)
    const needsAssessment = s => phaseKey && checkIn.assessment !== 'skip' && !assessed.has(`${phaseKey}:${s.discipline}`)
    const accepted = []
    for (const s of [...candidates].sort((a, b) => Number(!!needsAssessment(b)) - Number(!!needsAssessment(a)) ||
      (needsAssessment(a) && needsAssessment(b) ? ['swim','bike','run'].indexOf(a.discipline) - ['swim','bike','run'].indexOf(b.discipline) : 0) ||
      priority.indexOf(a.discipline) - priority.indexOf(b.discipline) || a.date.localeCompare(b.date))) {
      const conflict = [...keyDays, ...accepted.map((s) => s.date), ...brickDays, ...longDays].some((d) => Math.abs(dayGap(d, s.date)) < 2)
      const raceProtected = profile.competitionDate && Math.abs(dayGap(s.date, profile.competitionDate)) <= 7
      if (!isReduced(week, checkIn) && !week.partial && !conflict && !raceProtected && accepted.length < qualityCap) {
        accepted.push(s); s.role = 'quality'
        if (needsAssessment(s)) { s.assessmentKey = `${phaseKey}:${s.discipline}`; assessed.add(s.assessmentKey) }
      }
      else { s.role = 'easy'; s.suppressDevelopment = true }
    }
    if (candidates.some((s) => s.suppressDevelopment)) week.progressionNotes.push('Some quality work replaced with easy work to protect cross-discipline spacing, recovery and the weekly quality cap.')
    for (const session of [...week.sessions].sort((a, b) => a.date.localeCompare(b.date))) {
      if (session.isRace) continue
      if (session.discipline === 'brick') {
        const steps = []
        for (const disc of ['bike', 'run']) {
          const target = effortTarget(disc, states[disc], 'brick')
          const previousMinutes = brickPriorMinutes(history, disc, today)
          const baseMinutes = disc === 'bike' ? 60 : 20
          const eventCap = brickEventCapMinutes(profile, disc)
          const conversion = disc === 'bike' ? 3 : (target.high ?? 420) / 60
          const desiredMinutes = (session.brickTargets[`${disc}Km`] ?? 0) * conversion
          // A slow ramp from a small floor only protects a brand-new athlete's
          // very first brick from an unrealistic maiden distance. Once there is
          // any completed brick, trust the scheduler's own phase-aware weekly
          // target for this leg instead: it is already growth-limited and held
          // from declining upstream (triWeek / progressTowardTarget). Re-capping
          // it here every week to a slow, independent minutes ramp silently
          // discarded most of the intended run/bike volume forever, and that
          // shrunken number then became next block's own progression baseline.
          // (Whatever this steady-state ceiling can't carry was already moved
          // onto the standalone sessions above, in redistributeBrickShortfall.)
          const rampMinutes = previousMinutes > 0 ? previousMinutes * (isReduced(week, checkIn) ? 0.75 : 1.05) : baseMinutes
          const supportedMinutes = previousMinutes > 0 ? Infinity : Math.max(baseMinutes, rampMinutes)
          const minutes = Math.min(eventCap, normalizeFitness(profile.trainingFitness)[disc].maxSessionMinutes ?? supportedMinutes, desiredMinutes)
          const km = round(minutes / conversion, 0.5)
          session.brickTargets[`${disc}Km`] = km
          steps.push({ ...step(`${session.skeletonId}:${disc}`, 'work', disc, target, { seconds: Math.max(60, round(minutes * 60)), label: `Easy ${disc} leg; no threshold assessment off the bike` }), discipline: disc })
        }
        session.endurancePrescription = { version: FITNESS_POLICY_VERSION, discipline: 'brick', purpose: 'brick', family: 'brick:easy',
          baseline: { bike: states.bike, run: states.run }, feedbackRequired: false, distanceIsEstimate: true,
          legDistancesKm: { bike: session.brickTargets.bikeKm, run: session.brickTargets.runKm },
          estimatedDistanceKm: null, rationale: 'Easy race-combination practice. Fresh-run fitness is not inferred from brick results.', steps }
        session.targetPaceOrPower = 'Easy effort 2–4/10 in both legs; no goal-derived pace forced.'
        session.targetDurationMin = round(steps.reduce((sum, s) => sum + s.durationSeconds, 0) / 60)
        continue
      }
      if (!DISCIPLINES.includes(session.discipline)) continue
      if (session.role === 'quality') {
        keyDays.push(session.date); session.sequenceInWeek = qualityIndex++
      }
      const p = prescription(profile, session, week, states[session.discipline], decisions[session.discipline], checkIn, goals[session.discipline] ?? null, history, today)
      session.endurancePrescription = p
      session.targetPaceOrPower = targetText(p.target, session.discipline)
      session.intensity = p.purpose
      session.targetDistanceKm = p.estimatedDistanceKm
      session.targetDurationMin = round(p.steps.reduce((sum, s) => sum + (s.durationSeconds ?? (session.discipline === 'swim' ? s.distanceM / 100 * (states.swim.workingValue ?? 180) : s.distanceM / 1000 * (p.target.high ?? (session.discipline === 'bike' ? 180 : 420)))) * (s.setsCount ?? 1), 0) / 60)
      // Soft reductions retain a genuinely feasible easy session. Hard
      // spacing/pain constraints cannot be evaded using Optional.
      if (session.role === 'easy' && (checkIn.recovery === 'fatigued' || checkIn.previousBlockLoad === 'tooHard') && !['recovery', 'taper'].includes(week.phase)) {
        session.isOptional = true; session.optionalReason = OPTIONAL_NOTE
      }
    }
    for (const disc of DISCIPLINES) {
      if (!( `${disc}Km` in week.targets)) continue
      week.targets[`${disc}Km`] = round(week.sessions.filter(s => !s.isRace).reduce((sum, s) => sum + (s.discipline === disc ? s.targetDistanceKm ?? 0 : s.discipline === 'brick' ? s.brickTargets?.[`${disc}Km`] ?? 0 : 0), 0), disc === 'swim' ? 0.025 : 0.5)
    }
    week.requiredTargets = Object.fromEntries(DISCIPLINES.filter((d) => `${d}Km` in week.targets).map((d) => [`${d}Km`, round(week.sessions.filter((s) => !s.isOptional && !s.isRace).reduce((sum, s) => sum + (s.discipline === d ? s.targetDistanceKm ?? 0 : s.discipline === 'brick' ? s.brickTargets?.[`${d}Km`] ?? 0 : 0), 0), d === 'swim' ? 0.025 : 0.5)]))
    for (const s of week.sessions) if (s.endurancePrescription) {
      s.endurancePrescription.id = `endurance-v1:${s.skeletonId}`
      s.endurancePrescription.weekVolumeTargets = { ...week.targets }
    }
    week.progressionNotes.push('Fitness baseline fixed for this block; workload stage changes only at next generation after reviewing evidence. Existing recovery rotation is preserved.')
    if (week.marathonPlan && week.phase === 'peak' && week.targets.runKm < week.marathonPlan.peakRange[0]) week.progressionNotes.push('Peak mileage target is not yet supported by current capacity/availability. Do not cram or catch up missed distance; review preparation and the race goal.')
    if (phaseKey && DISCIPLINES.some(d => (profile.sport === 'triathlon' || d === 'run') && !assessed.has(`${phaseKey}:${d}`))) week.progressionNotes.push('A phase checkpoint is pending or was declined. It will not override recovery, access or quality-spacing constraints.')
    if (!week.partial && !['recovery', 'taper'].includes(week.phase)) previousLoadWeek = week
  }
  return { policyVersion: FITNESS_POLICY_VERSION, fingerprint: fitnessFingerprint(profile), evidenceFingerprint: evidenceFingerprint(history, today), evidenceAsOf: today.toISOString(), baselines: states,
    decisions, reviews: Object.fromEntries(DISCIPLINES.map((d) => [d, baselineReview(profile, d, history, today)])) }
}

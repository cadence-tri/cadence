import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlanSkeleton } from '../src/services/planning/planScheduler.js'
import { validateSkeleton, validateGeneratedPlan, mergeGeneratedWithSkeleton } from '../src/services/planning/planValidator.js'
import { parseMarkdown, importMarkdown } from '../src/services/markdownImporter.js'
import { normalizeFitness, paceSeconds, updateFitness, resolveFitness, normalizeWorkoutResult, evidenceFor, baselineReview, dayGap, fitnessFingerprint } from '../src/services/planning/fitness.js'
import { canonicalEnduranceSets, swimSessionCap, WORK_STAGES } from '../src/services/planning/endurancePlanning.js'
import { runningPaceTargets, triathlonNumericTargets } from '../src/services/planning/planRules.js'
import { sessionDistanceKmForDisplay, durationMinutes, withAllSetsCompleted } from '../src/db/session.js'
import { parseImportDate, toISODateString } from '../src/services/dateUtils.js'
import { raceProjection } from '../src/services/raceProjection.js'
const today = new Date('2026-08-31T12:00:00')
const p = (extra = {}) => ({ id: 1, sport: 'running', runningDistance: 'marathon', triathlonDistance: 'olympic', trainingDaysPerWeek: 5, longSessionDays: [1], goalOverallTime: '2:58:00', excludeGymSessions: true, onboardingAlreadyRuns: true, onboardingTriPriorExperience: true, onboardingPriorStructuredPlan: true, onboardingConsistencyRating: 'Very consistent', trainingFitness: {}, ...extra })
const build = (profile = p(), history = [], checkIn = {}, date = today) => buildPlanSkeleton({ profile, planHistory: history, recentSessions: history, today: date, checkIn: { recovery: 'normal', previousBlockLoad: 'aboutRight', painLevel: 'none', ...checkIn } })
const all = (s) => s.weeks.flatMap((w) => w.sessions)
const generated = (skeleton) => all(skeleton).map((s) => ({ ...s, title: `${s.discipline} ${s.role}`, skeletonRole: s.role, totalDistance: s.discipline === 'swim' ? s.targetDistanceKm * 1000 : s.targetDistanceKm,
  sets: s.endurancePrescription ? canonicalEnduranceSets(s.endurancePrescription) : [{ exercise: 'Strength', setsCount: 1 }, { exercise: 'Core', setsCount: 1, isCore: true }] }))
const baseline = (value, extra = {}) => ({ value, source: 'test', assessedOn: '2026-08-01', status: 'assessed', ...extra })
function feedbackSession(discipline, date, prescription, result = {}) {
  return { date: parseImportDate(date).toISOString(), discipline, title: 'Logged result', importKey: `${date}|${discipline}|result`, totalDistance: 5,
    endurancePrescription: structuredClone(prescription), sets: canonicalEnduranceSets(prescription).map((s) => ({ ...s, isCompleted: true })), isCompleted: true,
    workoutResult: { outcome: 'asPrescribed', feel: 'controlled', recovery: 'asPrescribed', context: 'normal', ...result } }
}

test('fitness input parsing and normalization never turns goals/legacy text into a baseline', () => {
  assert.equal(paceSeconds("4'00''/km"), 240)
  assert.equal(paceSeconds('2:15/100m'), 135)
  for (const raw of ['4:99', 'fast', '', null]) assert.equal(paceSeconds(raw), null)
  assert.equal(normalizeFitness({ run: { value: true } }).run.value, null)
  assert.equal(normalizeFitness({ run: { value: 240, status: 'assessed' } }).run.status, 'provisional')
  assert.equal(runningPaceTargets(p()).thresholdPace, null)
  assert.equal(resolveFitness(p({ onboardingThresholdDetails: "4'00/km" }), 'run', [], today).value, null)
})

test('personal 4:00 input becomes conservative calibration, not fixed marathon-goal-plus-15', () => {
  const profile = p({ trainingFitness: { run: { value: 240 } } })
  const skeleton = build(profile)
  const s = all(skeleton).find((s) => s.endurancePrescription?.feedbackRequired)
  assert.equal(s.endurancePrescription.baseline.value, 240)
  assert.equal(s.endurancePrescription.baseline.status, 'provisional')
  assert.ok(s.endurancePrescription.target.low > 240)
  assert.ok(s.endurancePrescription.target.low !== 268)
  assert.equal(runningPaceTargets(profile).thresholdPace, '4:00/km')
  assert.deepEqual(profile.trainingFitness, { run: { value: 240 } })
})

test('unknown fitness is effort-led in all three disciplines, including brick legs', () => {
  const skeleton = build(p({ sport: 'triathlon', goalSwimTime: '20:00', goalBikeTime: '1:00:00', goalRunTime: '40:00' }))
  for (const session of all(skeleton)) for (const step of session.endurancePrescription?.steps ?? []) {
    assert.equal(step.target.low, null)
    assert.equal(step.target.high, null)
    assert.match(step.paceOrPower, /Effort-led/)
  }
})

test('cycling uses FTP only with a power-capable setup and does not convert goal speed to watts', () => {
  const profile = p({ sport: 'triathlon', trainingFitness: { bike: { value: 220 } } })
  assert.equal(resolveFitness(profile, 'bike', [], today).workingValue, null)
  assert.equal(resolveFitness({ ...profile, bikePowerAvailable: true }, 'bike', [], today).workingValue, 198)
  assert.equal(triathlonNumericTargets(profile).ftpWatts, 220)
})

test('Olympic weak-swimmer volume is capped and two swims include a true technique session', () => {
  const profile = p({ sport: 'triathlon', trainingDaysPerWeek: 6, trainingFitness: { swim: { level: 'new' } } })
  const skeleton = build(profile)
  assert.deepEqual(validateSkeleton(skeleton, profile).errors, [])
  for (const week of skeleton.weeks) {
    const swims = week.sessions.filter((s) => s.discipline === 'swim')
    assert.equal(swims.length, 2)
    assert.ok(swims.every((s) => s.targetDistanceKm <= 1))
    assert.equal(swims.filter((s) => s.endurancePrescription.purpose === 'technique').length, 1)
    const drillShare = (s) => s.endurancePrescription.steps.filter((s) => s.stepType === 'drill').reduce((n, s) => n + s.distanceM, 0) / (s.targetDistanceKm * 1000)
    assert.ok(drillShare(swims.find((s) => s.endurancePrescription.purpose === 'technique')) > drillShare(swims.find((s) => s.endurancePrescription.purpose !== 'technique')))
    for (const s of swims) assert.equal(s.endurancePrescription.steps.reduce((n, s) => n + (s.distanceM ?? 0), 0), s.targetDistanceKm * 1000)
  }
})

test('pool access 0/1 is a real limit; one swim keeps drills without a technique-only label', () => {
  for (const days of [0, 1]) {
    const profile = p({ sport: 'triathlon', onboardingPoolDaysPerWeek: String(days) })
    const skeleton = build(profile)
    assert.deepEqual(validateSkeleton(skeleton, profile).errors, [])
    for (const w of skeleton.weeks) {
      const swims = w.sessions.filter((s) => s.discipline === 'swim')
      assert.equal(swims.length, days)
      if (days) assert.ok(swims[0].endurancePrescription.steps.some((s) => s.stepType === 'drill'))
      else assert.equal(w.targets.swimKm, 0)
    }
  }
})

test('legacy prescribed 5km swims do not establish swim capacity', () => {
  const history = [{ date: '2026-08-25', discipline: 'swim', totalDistance: 5000, isCompleted: true }]
  assert.equal(swimSessionCap(p(), history, today), swimSessionCap(p(), [], today))
  assert.ok(swimSessionCap(p({ trainingFitness: { swim: { comfortableSwimMeters: 50 } } }), [], today) <= 200)
})

test('feedback normalization preserves zero repetitions, rejects booleans and treats missing feedback as missing', () => {
  assert.equal(normalizeWorkoutResult(null), null)
  assert.equal(normalizeWorkoutResult({ completedReps: 0 }).completedReps, 0)
  assert.equal(normalizeWorkoutResult({ actualValue: true }).actualValue, null)
  assert.equal(normalizeWorkoutResult({ outcome: 'fabricated' }).outcome, null)
})

test('completion and free text cannot independently change a personal baseline', () => {
  const profile = p({ trainingFitness: { run: { value: 240 } } })
  const session = all(build(profile)).find((s) => s.endurancePrescription?.feedbackRequired)
  const logged = withAllSetsCompleted({ ...session, date: '2026-08-25', sets: canonicalEnduranceSets(session.endurancePrescription), athleteFeedback: 'Very easy at 3:30/km' }, true)
  assert.equal(evidenceFor([logged], 'run', today).length, 0)
  assert.equal(resolveFitness(profile, 'run', [logged], today).workingValue, resolveFitness(profile, 'run', [], today).workingValue)
})

test('comfortable feedback moves prescription toward estimate without raising workload simultaneously', () => {
  const profile = p({ trainingFitness: { run: { value: 240 } } })
  const spec = all(build(profile)).find((s) => s.endurancePrescription?.feedbackRequired).endurancePrescription
  const history = ['2026-08-25', '2026-08-28'].map((date) => feedbackSession('run', date, spec, { feel: 'comfortable', actualValue: 260 }))
  const next = build(profile, history)
  assert.ok(next.endurancePlan.baselines.run.workingValue < spec.baseline.workingValue)
  assert.equal(next.endurancePlan.decisions.run.stage, spec.loadStage)
  assert.equal(next.endurancePlan.baselines.run.value, 240)
  assert.equal(next.endurancePlan.baselines.run.status, 'provisional')
})

test('comparable controlled results progress one workload stage, not threshold', () => {
  const profile = p({ trainingDaysPerWeek: 3, trainingFitness: { run: baseline(240) } })
  const spec = all(build(profile)).find((s) => s.endurancePrescription?.feedbackRequired).endurancePrescription
  const history = ['2026-08-25', '2026-08-28'].map((date) => feedbackSession('run', date, spec, { actualValue: 240 }))
  const next = build(profile, history)
  assert.equal(next.endurancePlan.decisions.run.stage, 1)
  assert.equal(next.endurancePlan.baselines.run.value, 240)
  for (const stages of Object.values(WORK_STAGES)) for (let i = 1; i < stages.length; i++) assert.equal(stages[i].filter((v, j) => v !== stages[i - 1][j]).length, 1)
})

test('extended recoveries, modified or painful results do not earn progression', () => {
  const profile = p({ trainingFitness: { run: baseline(240) } })
  const spec = all(build(profile)).find((s) => s.endurancePrescription?.feedbackRequired).endurancePrescription
  for (const result of [{ recovery: 'extended' }, { outcome: 'modified' }, { context: 'pain' }, { completedReps: 0 }]) {
    const history = ['2026-08-25', '2026-08-28'].map((date) => feedbackSession('run', date, spec, result))
    assert.notEqual(build(profile, history).endurancePlan.decisions.run.action, 'progress')
  }
})

test('evidence excludes duplicates, future work, invalid dates and stale work', () => {
  const spec = all(build()).find((s) => s.endurancePrescription?.feedbackRequired).endurancePrescription
  const good = feedbackSession('run', '2026-08-25', spec)
  const future = feedbackSession('run', '2026-09-25', spec)
  const old = feedbackSession('run', '2026-01-25', spec)
  assert.equal(evidenceFor([good, good, future, old, { ...good, date: 'bad' }], 'run', today).length, 1)
  assert.equal(dayGap('bad', today), Infinity)
})

test('reassessment is suggested, never silently applied; short reps alone are not a formal assessment', () => {
  const profile = p({ trainingFitness: { run: baseline(240) } })
  const spec = all(build(profile)).find((s) => s.endurancePrescription?.feedbackRequired).endurancePrescription
  const history = ['2026-08-25', '2026-08-28'].map((date) => feedbackSession('run', date, spec, { actualValue: 230 }))
  assert.equal(baselineReview(profile, 'run', history, today), null)
  const longer = history.map((s) => ({ ...s, endurancePrescription: { ...s.endurancePrescription, workSeconds: 1440 } }))
  assert.match(baselineReview(profile, 'run', longer, today), /assessment/)
  assert.equal(profile.trainingFitness.run.value, 240)
  const fields = updateFitness(profile, 'run', baseline(235, { assessedOn: '2026-08-31' }), today)
  assert.equal(fields.fitnessHistory.length, 1)
  assert.equal(fields.fitnessHistory[0].before.value, 240)
})

test('repeated generation is pure and both weeks use the same baseline/stage', () => {
  const profile = p({ trainingFitness: { run: { value: 240 } } })
  const before = JSON.stringify(profile)
  const first = build(profile)
  assert.deepEqual(first, build(profile))
  assert.equal(JSON.stringify(profile), before)
  const specs = all(first).filter((s) => s.endurancePrescription?.feedbackRequired).map((s) => s.endurancePrescription)
  assert.equal(new Set(specs.map((s) => s.loadStage)).size, 1)
  assert.equal(new Set(specs.map((s) => s.baseline.workingValue)).size, 1)
  assert.ok(first.weeks[1].targets.runKm <= first.weeks[0].targets.runKm * 1.02)
})

test('assessment preference changes purpose without adding a hard session', () => {
  const yes = build(p(), [], { assessment: 'offer' })
  const no = build(p(), [], { assessment: 'skip' })
  assert.equal(all(yes).length, all(no).length)
  assert.ok(all(yes).some((s) => s.endurancePrescription?.purpose === 'assessment'))
  assert.ok(all(no).some((s) => s.endurancePrescription?.purpose === 'development'))
})

test('race-specific sessions replace existing quality slots and never force an unsupported goal', () => {
  const profile = p({ competitionDate: '2026-10-18', trainingFitness: { run: baseline(240) }, goalOverallTime: '2:10:00' })
  const skeleton = build(profile)
  const race = all(skeleton).filter((s) => s.endurancePrescription?.purpose === 'raceSpecific')
  assert.ok(race.length)
  assert.ok(race.every((s) => !s.endurancePrescription.goalUsed && s.endurancePrescription.target.low >= 240))
})

test('recovery swim volume deloads against session capacity, not just the old inflated weekly range', () => {
  const profile = p({ sport: 'triathlon', trainingDaysPerWeek: 6, trainingBlockStartDate: '2026-08-10' })
  // Week 4 is a recovery week, then a new loading phase.
  const history = [{ date: '2026-08-10', discipline: 'run', totalDistance: 5 }, { date: '2026-08-30', discipline: 'run', totalDistance: 5 }]
  const skeleton = build(profile, history)
  assert.equal(skeleton.weeks[0].phase, 'recovery')
  assert.ok(skeleton.weeks[0].targets.swimKm < skeleton.weeks[1].targets.swimKm)
  assert.ok(skeleton.weeks[0].sessions.every((s) => !s.endurancePrescription?.feedbackRequired))
})

test('optional soft reductions do not add days or evade significant-pain/strength rules', () => {
  const profile = p({ excludeGymSessions: false, strengthSessionsPerWeek: 2 })
  const fatigue = build(profile, [], { recovery: 'fatigued' })
  assert.ok(all(fatigue).some((s) => s.isOptional))
  for (const w of fatigue.weeks) assert.ok(w.requiredTargets.runKm < w.targets.runKm)
  assert.ok(all(fatigue).filter((s) => s.isOptional).every((s) => /Prioritize rest/.test(s.optionalReason)))
  const pain = build(profile, [], { painLevel: 'significant' })
  assert.ok(all(pain).every((s) => s.discipline !== 'gym' && s.role !== 'quality'))
  assert.deepEqual(validateSkeleton(pain, profile).errors, [])
})

test('AI roundtrip preserves numeric contract and rejects mutated steps, targets or optional state', () => {
  const skeleton = build(p({ sport: 'triathlon' }))
  const reply = generated(skeleton)
  const parsed = parseMarkdown('```session\n' + JSON.stringify(reply) + '\n```', [], []).decodedSessions
  assert.deepEqual(validateGeneratedPlan({ skeleton, sessions: parsed }).errors, [])
  const i = parsed.findIndex((s) => s.endurancePrescription)
  for (const mutate of [s => { s.sets[0].durationSeconds = 2 }, s => { s.sets[0].paceOrPower = 'Go all out' }, s => { s.isOptional = !s.isOptional }, s => { s.endurancePrescription.purpose = 'race' }, s => { s.sets.pop() }, s => { s.sets[0].target.low = 100 }]) {
    const bad = structuredClone(parsed); mutate(bad[i]); assert.ok(validateGeneratedPlan({ skeleton, sessions: bad }).errors.length)
  }
  const stored = mergeGeneratedWithSkeleton({ skeleton, sessions: parsed })
  assert.ok(stored.every((s) => s.originalPrescription?.length))
  assert.ok(stored.every((s) => s.workoutResult === null))
  assert.equal(toISODateString(new Date(stored[0].date)), reply[0].date)
})

test('estimated distance and structured duration are correctly labelled/calculated', () => {
  assert.equal(durationMinutes({ durationSeconds: 180, duration: '3m 0s' }), 3)
  assert.equal(sessionDistanceKmForDisplay({ discipline: 'run', totalDistance: 8, workoutResult: { actualDistanceKm: 7.4 } }), 7.4)
})

test('projections do not turn personal estimates or completed prescribed pace into measured fitness', () => {
  const profile = p({ competitionDate: '2026-11-01', trainingFitness: { run: { value: 240 } }, onboardingThresholdDetails: "4'00/km" })
  assert.equal(raceProjection(profile, [], today).status, 'building')
  assert.equal(raceProjection({ ...profile, trainingFitness: { run: baseline(240) } }, [], today).status, 'ready')
})

test('fingerprint notices profile changes before import', async () => {
  const profile = p()
  assert.notEqual(fitnessFingerprint(profile), fitnessFingerprint({ ...profile, trainingFitness: { run: { value: 240 } } }))
  const { db } = await import('../src/db/db.js')
  const originals = [db.profile.get, db.sessions.toArray, db.weekPhases.toArray]
  db.profile.get = async () => ({ ...profile, goalOverallTime: '3:30:00' })
  db.sessions.toArray = async () => []
  db.weekPhases.toArray = async () => []
  try { await assert.rejects(importMarkdown('anything', { skeleton: build(profile) }), /changed after this prompt/) }
  finally { [db.profile.get, db.sessions.toArray, db.weekPhases.toArray] = originals }
})

test('calendar-day evidence and import survive DST and opposite UTC offsets', () => {
  const original = process.env.TZ
  try {
    for (const tz of ['UTC', 'Europe/Rome', 'America/Los_Angeles']) {
      process.env.TZ = tz
      assert.equal(dayGap('2026-10-24', '2026-10-26'), 2)
      const skeleton = build(p())
      const stored = mergeGeneratedWithSkeleton({ skeleton, sessions: generated(skeleton) })
      assert.deepEqual(stored.map((s) => toISODateString(new Date(s.date))), all(skeleton).map((s) => s.date))
    }
  } finally { if (original == null) delete process.env.TZ; else process.env.TZ = original }
})

test('scheduling matrix validates all sports, availability and swim-capacity combinations', () => {
  for (const sport of ['running', 'triathlon']) for (const days of [2, 3, 5, 7]) for (const pool of [0, 1, 2]) {
    const profile = p({ sport, trainingDaysPerWeek: days, onboardingPoolDaysPerWeek: String(pool), trainingFitness: { swim: { comfortableSwimMeters: 25 } } })
    const skeleton = build(profile)
    assert.deepEqual(validateSkeleton(skeleton, profile).errors, [], `${sport}/${days}/${pool}`)
  }
})

test('compact prescription references roundtrip without duplicating the full contract', () => {
  const skeleton = build(p({ sport: 'triathlon' }))
  const reply = generated(skeleton).map(({ endurancePrescription, ...s }) => ({ ...s, endurancePrescriptionId: endurancePrescription.id }))
  const parsed = parseMarkdown('```session\n' + JSON.stringify(reply) + '\n```', [], []).decodedSessions
  assert.deepEqual(validateGeneratedPlan({ skeleton, sessions: parsed }).errors, [])
  const stored = mergeGeneratedWithSkeleton({ skeleton, sessions: parsed })
  assert.ok(stored.every((s) => s.endurancePrescription?.steps?.length))
  parsed[0].endurancePrescriptionId = 'wrong'
  assert.ok(validateGeneratedPlan({ skeleton, sessions: parsed }).errors.length)
})

test('triathlon rotates assessment opportunities across disciplines while protecting spacing', () => {
  const skeleton = build(p({ sport: 'triathlon', trainingDaysPerWeek: 5 }))
  const quality = all(skeleton).filter((s) => s.role === 'quality')
  assert.deepEqual([...new Set(quality.map((s) => s.discipline))].sort(), ['bike', 'run', 'swim'])
  for (let i = 0; i < quality.length; i++) for (let j = i + 1; j < quality.length; j++) assert.ok(Math.abs(dayGap(quality[i].date, quality[j].date)) >= 2)
})

test('reported swim capacity can grow beyond the initial cap without arbitrary calendar advancement', () => {
  const profile = p({ sport: 'triathlon', trainingDaysPerWeek: 5 })
  const spec = all(build(profile)).find((s) => s.discipline === 'swim' && s.endurancePrescription.feedbackRequired).endurancePrescription
  const oldCap = swimSessionCap(profile, [], today)
  const history = ['2026-08-24', '2026-08-27'].map((date) => feedbackSession('swim', date, spec, { actualDistanceKm: oldCap / 1000 }))
  const newCap = swimSessionCap(profile, history, today)
  assert.ok(newCap > oldCap)
  assert.ok(newCap <= oldCap * 1.05)
  assert.equal(swimSessionCap(profile, [], new Date('2026-10-01')), oldCap)
})

test('edited prescriptions and capacity-limited stages are not credited as full stage completion', () => {
  const profile = p({ trainingFitness: { run: baseline(240) } })
  const spec = all(build(profile)).find((s) => s.endurancePrescription.feedbackRequired).endurancePrescription
  const history = ['2026-08-25', '2026-08-28'].map((date) => ({ ...feedbackSession('run', date, spec), prescriptionEdited: true }))
  assert.equal(evidenceFor(history, 'run', today).length, 0)
  const limited = history.map((s) => ({ ...s, prescriptionEdited: false, endurancePrescription: { ...s.endurancePrescription, stageLimited: true } }))
  assert.notEqual(build(profile, limited).endurancePlan.decisions.run.action, 'progress')
})

test('backup roundtrip retains baselines, assessment history, original prescription and reported result', async () => {
  const { db } = await import('../src/db/db.js')
  const { encodeBackup, restoreBackup } = await import('../src/services/backupService.js')
  const profile = p({ trainingFitness: { run: baseline(240) }, fitnessHistory: [{ discipline: 'run', confirmedAt: today.toISOString() }] })
  const skeleton = build(profile)
  const session = mergeGeneratedWithSkeleton({ skeleton, sessions: generated(skeleton) })[0]
  session.workoutResult = normalizeWorkoutResult({ outcome: 'asPrescribed', feel: 'controlled', recovery: 'asPrescribed', actualDistanceKm: 8, actualDurationMinutes: 40, completedReps: 0, actualValue: 245 })
  const tables = { profile: [profile], sessions: [{ ...session, prescriptionEdited: true }], weekPhases: [], raceProjections: [] }
  const undo = []
  const replace = (object, key, value) => { const old = object[key]; object[key] = value; undo.push(() => { object[key] = old }) }
  replace(db, 'transaction', async (...args) => args.at(-1)())
  for (const name of Object.keys(tables)) {
    replace(db[name], 'toArray', async () => structuredClone(tables[name]))
    replace(db[name], 'get', async () => tables[name][0])
    replace(db[name], 'clear', async () => { tables[name] = [] })
    replace(db[name], 'put', async (row) => { tables[name] = [row] })
    replace(db[name], 'bulkAdd', async (rows) => { tables[name].push(...rows) })
  }
  try {
    const encoded = await encodeBackup()
    await restoreBackup(JSON.stringify(encoded))
    assert.equal(tables.profile[0].trainingFitness.run.value, 240)
    assert.deepEqual(tables.profile[0].fitnessHistory, profile.fitnessHistory)
    assert.deepEqual(tables.sessions[0].endurancePrescription, session.endurancePrescription)
    assert.deepEqual(tables.sessions[0].originalPrescription, session.originalPrescription)
    assert.deepEqual(tables.sessions[0].workoutResult, session.workoutResult)
    assert.equal(tables.sessions[0].prescriptionEdited, true)
  } finally { undo.reverse().forEach((restore) => restore()) }
})

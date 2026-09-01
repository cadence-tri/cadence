import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildPlanSkeleton } from '../src/services/planning/planScheduler.js'
import { validateSkeleton, validateGeneratedPlan, mergeGeneratedWithSkeleton } from '../src/services/planning/planValidator.js'
import { normalizeProfileLoose } from '../src/services/backupService.js'
import { normalizeStrengthFrequency, requestedStrengthSessions, strengthFocuses, strengthWeekPolicy, strengthPlacementAllowed, placeStrengthWeek, strengthLoadPlan, strengthPrescription } from '../src/services/planning/strengthPlanning.js'
import { parseMarkdown } from '../src/services/markdownImporter.js'
import { parseImportDate, toISODateString, addDays } from '../src/services/dateUtils.js'
import { canonicalEnduranceSets } from '../src/services/planning/endurancePlanning.js'

const profile = (extra = {}) => ({ name: 'Test', sport: 'running', runningDistance: 'halfMarathon', triathlonDistance: 'olympic', trainingDaysPerWeek: 6, longSessionDays: [1], excludeGymSessions: false, strengthSessionsPerWeek: 2, onboardingPriorStructuredPlan: true, onboardingConsistencyRating: 'Very consistent', onboardingAlreadyRuns: true, onboardingTriPriorExperience: true, ...extra })
const today = new Date('2026-08-31T12:00:00')
const build = (p = profile(), extra = {}) => buildPlanSkeleton({ profile: p, today, ...extra })
const gyms = (week) => week.sessions.filter((s) => s.discipline === 'gym')
const fixtureWeek = { weekLabel: 'Week 1', weekNumber: 1, phase: 'buildUp', partial: false, calendarStart: '2026-08-31', calendarEnd: '2026-09-06', trainingDates: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'] }

test('frequency normalization preserves legacy behavior and exclusion/bodyweight semantics', () => {
  for (const value of [undefined, null, '', true, 'bad', -5]) assert.equal(normalizeStrengthFrequency(value), 1)
  assert.equal(normalizeStrengthFrequency('3'), 3)
  assert.equal(normalizeStrengthFrequency(99), 4)
  assert.equal(normalizeProfileLoose({}).strengthSessionsPerWeek, 1)
  assert.equal(normalizeProfileLoose({ strengthSessionsPerWeek: 3 }).strengthSessionsPerWeek, 3)
  assert.equal(requestedStrengthSessions(profile({ excludeGymSessions: true })), 0)
  assert.equal(requestedStrengthSessions(profile({ excludeGymSessions: true, bodyweightOnlyStrength: true })), 2)
})

test('all four requested splits fit generous calendars and end with required core', () => {
  const endurance = fixtureWeek.trainingDates.map((date) => ({ date, discipline: 'run', role: 'easy' }))
  for (let count = 1; count <= 4; count++) {
    const { sessions, strengthPlan } = placeStrengthWeek({ profile: profile({ strengthSessionsPerWeek: count }), week: fixtureWeek, endurance })
    assert.equal(strengthPlan.scheduledSessions, count)
    assert.deepEqual(sessions.map((s) => s.strengthPrescription.focus).sort(), [...strengthFocuses(count)].sort())
    assert.ok(sessions.every((s) => s.strengthPrescription.coreFinisherRequired))
    assert.equal(new Set(sessions.map((s) => s.skeletonId)).size, count)
  }
})

test('recovery keeps frequency when feasible but reduces sets, duration and effort', () => {
  const p = profile()
  const endurance = fixtureWeek.trainingDates.map((date) => ({ date, discipline: 'run', role: 'easy' }))
  const normal = placeStrengthWeek({ profile: p, week: fixtureWeek, endurance })
  const deload = placeStrengthWeek({ profile: p, week: { ...fixtureWeek, phase: 'recovery' }, endurance })
  assert.equal(deload.sessions.length, normal.sessions.length)
  assert.ok(deload.sessions.every((s) => s.targetDurationMin === 25
    && s.strengthPrescription.workSetsMin === 2 && s.strengthPrescription.workSetsMax === 2
    && s.strengthPrescription.coreSets === 2 && s.strengthPrescription.maxEffort === 6))
  for (const checkIn of [{ recovery: 'fatigued' }, { recovery: 'veryFatigued' }, { previousBlockLoad: 'tooHard' }, { painLevel: 'mild' }]) {
    assert.equal(strengthWeekPolicy(p, fixtureWeek, checkIn).mode, 'deload')
  }
  assert.equal(strengthWeekPolicy(p, fixtureWeek, { painLevel: 'significant' }).targetSessions, 0)
})

test('taper is one light full-body session and race protection suppresses close sessions', () => {
  const p = profile({ competitionDate: '2026-09-20', strengthSessionsPerWeek: 4 })
  const early = placeStrengthWeek({ profile: p, week: { ...fixtureWeek, phase: 'taper' }, endurance: [] })
  assert.equal(early.sessions.length, 1)
  assert.equal(early.sessions[0].strengthPrescription.focus, 'fullBody')
  assert.equal(early.sessions[0].strengthPrescription.workSetsMin, 2)
  assert.equal(early.sessions[0].strengthPrescription.workSetsMax, 2)
  assert.equal(early.sessions[0].strengthPrescription.coreSets, 2)
  assert.equal(early.sessions[0].strengthPrescription.exerciseSlots.includes('singleLegOrCarry'), false)
  for (let offset = -6; offset <= 7; offset++) {
    const date = toISODateString(addDays(parseImportDate(p.competitionDate), offset))
    assert.equal(strengthPlacementAllowed({ date, focus: 'upperBody', endurance: [], strength: [], profile: p }), false)
  }
})

test('placement protects key endurance, daily capacity, and lower-body spacing across weeks', () => {
  const p = profile()
  const allowed = (extra) => strengthPlacementAllowed({ date: '2026-09-06', focus: 'lowerBody', profile: p, endurance: [], strength: [], ...extra })
  assert.equal(allowed({ endurance: [{ date: '2026-09-07', discipline: 'run', role: 'quality' }] }), false)
  assert.equal(allowed({ endurance: [{ date: '2026-09-06', discipline: 'run', role: 'long' }] }), false)
  assert.equal(allowed({ endurance: [{ date: '2026-09-06', discipline: 'swim' }, { date: '2026-09-06', discipline: 'run' }] }), false)
  assert.equal(allowed({ strength: [{ date: '2026-09-05', strengthPrescription: { focus: 'fullBody' } }] }), false)
  assert.equal(allowed({ strength: [{ date: '2026-09-04', strengthPrescription: { focus: 'lowerBody' } }] }), true)
  assert.equal(allowed({ strength: [{ date: '2026-09-05' }] }), false) // legacy gym: conservative
})

test('unavailable frequency is explained and a smaller split becomes full body', () => {
  const week = { ...fixtureWeek, trainingDates: ['2026-09-01'] }
  const result = placeStrengthWeek({ profile: profile(), week, endurance: [] })
  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].strengthPrescription.focus, 'fullBody')
  assert.match(result.strengthPlan.messages.join(' '), /only 1/)
  assert.equal(strengthWeekPolicy(profile({ strengthSessionsPerWeek: 4 }), { ...fixtureWeek, partial: true, calendarStart: '2026-09-04' }).targetSessions, 2)
})

test('scheduler matrix keeps volume sums, rest days, frequency and placement valid', () => {
  for (const sport of ['running', 'triathlon']) for (const count of [1, 2, 3, 4]) for (const days of [2, 4, 6]) {
    const p = profile({ sport, strengthSessionsPerWeek: count, trainingDaysPerWeek: days })
    const skeleton = build(p)
    assert.deepEqual(validateSkeleton(skeleton, p).errors, [], `${sport}/${count}/${days}`)
    for (const week of skeleton.weeks) {
      assert.ok(gyms(week).length <= count)
      if (gyms(week).length < count) assert.ok(week.strengthPlan.messages.length > 0)
      assert.ok(gyms(week).every((s) => week.trainingDates.includes(s.date)))
    }
  }
})

test('default running profile gets two gym sessions and long work honors higher-time days', () => {
  const p = profile({ longSessionDays: [7] }) // Saturday, not final Sunday
  const skeleton = build(p)
  for (const week of skeleton.weeks) {
    assert.equal(gyms(week).length, 2)
    assert.equal(parseImportDate(week.sessions.find((s) => s.role === 'long').date).getDay(), 6)
  }
  const excluded = build(profile({ excludeGymSessions: true }))
  assert.ok(excluded.weeks.every((week) => gyms(week).length === 0))
  const bodyweight = build(profile({ excludeGymSessions: true, bodyweightOnlyStrength: true }))
  assert.ok(bodyweight.weeks.flatMap(gyms).every((s) => s.strengthPrescription.equipment === 'bodyweight'))
})

const generated = (skeleton) => skeleton.weeks.flatMap((week) => week.sessions).map((s) => ({
  ...s, date: s.date, skeletonRole: s.role, title: 'Workout', totalDistance: s.discipline === 'swim' ? s.targetDistanceKm * 1000 : s.targetDistanceKm,
  sets: s.strengthPrescription ? s.strengthPrescription.exerciseSlots.map(slot => ({ slot, exercise: slot, setsCount: slot === 'core' ? s.strengthPrescription.coreSets : s.strengthPrescription.workSetsMin, isCore: slot === 'core' })) : s.endurancePrescription ? canonicalEnduranceSets(s.endurancePrescription) : [],
}))

const gymEvidence = ({ date, weightKg, reps = 8, effort = 6, completed = true, mode = 'normal' }) => ({
  date, discipline: 'gym', perceivedEffort: effort, workoutResult: { context: 'normal' },
  strengthPrescription: { mode }, sets: [{ slot: 'upperPush', exercise: 'Dumbbell bench press',
    weightKg, reps, isCompleted: completed, isSkipped: false }],
})

test('strength load progression requires logged controlled evidence and never invents a baseline', () => {
  const prescription = strengthPrescription(profile(), 'upperBody', 'normal')
  const checkIn = { recovery: 'normal', previousBlockLoad: 'aboutRight', painLevel: 'none' }
  const empty = strengthLoadPlan({ prescription, checkIn })[0]
  assert.equal(empty.action, 'establish')
  assert.equal(empty.suggestedWeightKg, null)

  const one = strengthLoadPlan({ prescription, checkIn, history: [gymEvidence({ date: '2026-08-01', weightKg: 20 })] })[0]
  assert.equal(one.action, 'hold')
  assert.equal(one.suggestedWeightKg, 20)
  const missedLater = strengthLoadPlan({ prescription, checkIn, history: [
    gymEvidence({ date: '2026-08-01', weightKg: 20 }),
    gymEvidence({ date: '2026-08-08', weightKg: null, completed: false }),
  ] })[0]
  assert.equal(missedLater.action, 'hold')
  assert.equal(missedLater.suggestedWeightKg, 20)

  const two = [gymEvidence({ date: '2026-08-01', weightKg: 20 }), gymEvidence({ date: '2026-08-08', weightKg: 20 })]
  const reps = strengthLoadPlan({ prescription, checkIn, history: two })[0]
  assert.equal(reps.action, 'addRep')
  assert.equal(reps.targetReps, 9)
  assert.equal(reps.suggestedWeightKg, 20)

  const top = two.map((session) => ({ ...session, sets: session.sets.map(set => ({ ...set, reps: 10 })) }))
  const load = strengthLoadPlan({ prescription, checkIn, history: top })[0]
  assert.equal(load.action, 'increaseLoad')
  assert.ok(load.suggestedWeightKg > 20)
  assert.equal(load.targetReps, 8)
})

test('strength progression holds without effort evidence and deload only reduces established load', () => {
  const checkIn = { recovery: 'normal', previousBlockLoad: 'aboutRight', painLevel: 'none' }
  const history = [gymEvidence({ date: '2026-08-01', weightKg: 40, effort: null }), gymEvidence({ date: '2026-08-08', weightKg: 40, effort: null })]
  assert.equal(strengthLoadPlan({ prescription: strengthPrescription(profile(), 'upperBody', 'normal'), history, checkIn })[0].action, 'hold')
  const recovery = strengthLoadPlan({ prescription: strengthPrescription(profile(), 'upperBody', 'deload'), history, checkIn })[0]
  assert.equal(recovery.action, 'reduce')
  assert.equal(recovery.suggestedWeightKg, 36)
})

test('logged deload loads never ratchet down the normal baseline or repetition stage', () => {
  const checkIn = { recovery: 'normal', previousBlockLoad: 'aboutRight', painLevel: 'none' }
  const normalPrescription = strengthPrescription(profile(), 'lowerBody', 'normal')
  const deloadPrescription = strengthPrescription(profile(), 'lowerBody', 'deload')
  const normal55 = gymEvidence({ date: '2026-09-02', weightKg: 55, reps: 9 })
  normal55.sets[0].slot = 'squat'
  const deload495 = gymEvidence({ date: '2026-09-30', weightKg: 49.5, reps: 8, mode: 'deload' })
  deload495.sets[0].slot = 'squat'

  const resumed = strengthLoadPlan({ prescription: normalPrescription, history: [normal55, deload495], checkIn })[0]
  assert.equal(resumed.fromWeightKg, 55)
  assert.equal(resumed.suggestedWeightKg, 55)
  assert.equal(resumed.targetReps, 9)

  const nextDeload = strengthLoadPlan({ prescription: deloadPrescription, history: [normal55, deload495], checkIn })[0]
  assert.equal(nextDeload.fromWeightKg, 55)
  assert.equal(nextDeload.suggestedWeightKg, 49.5)
  assert.equal(nextDeload.targetReps, 8)
})

test('two controlled normal top-range completions increase load despite intervening deload logs', () => {
  const checkIn = { recovery: 'normal', previousBlockLoad: 'aboutRight', painLevel: 'none' }
  const prescription = strengthPrescription(profile(), 'lowerBody', 'normal')
  const history = [
    gymEvidence({ date: '2026-09-02', weightKg: 55, reps: 10 }),
    gymEvidence({ date: '2026-09-09', weightKg: 49.5, reps: 8, mode: 'deload' }),
    gymEvidence({ date: '2026-09-16', weightKg: 55, reps: 10 }),
  ]
  history.forEach(session => { session.sets[0].slot = 'squat' })
  const next = strengthLoadPlan({ prescription, history, checkIn })[0]
  assert.equal(next.action, 'increaseLoad')
  assert.equal(next.fromWeightKg, 55)
  assert.equal(next.suggestedWeightKg, 58)
  assert.equal(next.targetReps, 8)
})

test('legacy normal sessions that copied a ratcheted app suggestion do not contaminate baseline', () => {
  const checkIn = { recovery: 'normal', previousBlockLoad: 'aboutRight', painLevel: 'none' }
  const prescription = strengthPrescription(profile(), 'lowerBody', 'normal')
  const history = [
    gymEvidence({ date: '2026-09-02', weightKg: 55, reps: 8 }),
    gymEvidence({ date: '2026-09-30', weightKg: 49.5, reps: 8, mode: 'deload' }),
    gymEvidence({ date: '2026-10-08', weightKg: 49.5, reps: 9 }),
    gymEvidence({ date: '2026-10-15', weightKg: 49.5, reps: 10 }),
    gymEvidence({ date: '2026-10-28', weightKg: 44.5, reps: 8, mode: 'deload' }),
    gymEvidence({ date: '2026-11-05', weightKg: 44.5, reps: 9 }),
  ]
  history.forEach((session, index) => {
    session.sets[0].slot = 'squat'
    if ([2, 3].includes(index)) session.sets[0].suggestedWeightKg = 49.5
    if (index === 5) session.sets[0].suggestedWeightKg = 44.5
  })
  const next = strengthLoadPlan({ prescription, history, checkIn })[0]
  assert.equal(next.fromWeightKg, 55)
  assert.equal(next.suggestedWeightKg, 55)
  assert.equal(next.targetReps, 8)

  // A lower load chosen independently of the suggestion is still respected.
  history.at(-1).sets[0].suggestedWeightKg = 55
  const athleteReduced = strengthLoadPlan({ prescription, history, checkIn })[0]
  assert.equal(athleteReduced.fromWeightKg, 44.5)
})

test('AI reply contract and parser preserve focus/core; reject changed prescription or excessive deload sets', () => {
  const skeleton = build(profile(), { checkIn: { recovery: 'fatigued' } })
  const reply = generated(skeleton)
  const markdown = '```session\n' + JSON.stringify(reply) + '\n```'
  const parsed = parseMarkdown(markdown, [], []).decodedSessions
  assert.deepEqual(validateGeneratedPlan({ skeleton, sessions: parsed }).errors, [])
  const index = parsed.findIndex((s) => s.discipline === 'gym')
  assert.equal(parsed[index].sets.at(-1).isCore, true)
  assert.equal(mergeGeneratedWithSkeleton({ skeleton, sessions: parsed })[index].strengthPrescription.mode, 'deload')
  for (const mutate of [
    (s) => { s.strengthPrescription.focus = 'bad' },
    (s) => { s.sets.at(-1).isCore = false },
    (s) => { s.sets[0].slot = 'wrongFocus' },
    (s) => { s.sets[0].setsCount = 4 },
    (s) => { delete s.strengthPrescription },
  ]) {
    const invalid = structuredClone(parsed)
    mutate(invalid[index])
    assert.ok(validateGeneratedPlan({ skeleton, sessions: invalid }).errors.length)
  }
  assert.ok(validateGeneratedPlan({ skeleton, sessions: parsed.filter((_, i) => i !== index) }).errors.length)
})

test('frequency controls, prompt and backup preserve the strength contract', async () => {
  for (const path of ['src/components/ProfileSheet.jsx', 'src/screens/LoginScreen.jsx', 'src/components/PlanGenerationWizardSheet.jsx']) {
    const source = await readFile(new URL('../' + path, import.meta.url), 'utf8')
    assert.match(source, /StrengthFrequencyField/)
    assert.match(source, /strengthSessionsPerWeek/)
  }
  const prompt = await readFile(new URL('../src/services/planPromptBuilder.js', import.meta.url), 'utf8')
  assert.match(prompt, /echo its strengthPrescription object EXACTLY/)
  assert.doesNotMatch(prompt, /on my existing gym pattern/)
  const backup = await readFile(new URL('../src/services/backupService.js', import.meta.url), 'utf8')
  assert.match(backup, /strengthPrescription: s\.strengthPrescription/)
  assert.match(backup, /strengthPrescription: dto\.strengthPrescription/)
})

test('calendar-day strength spacing survives DST changes', () => {
  const allowed = strengthPlacementAllowed({ date: '2026-10-24', focus: 'fullBody', endurance: [],
    strength: [{ date: '2026-10-26', strengthPrescription: { focus: 'lowerBody' } }], profile: profile() })
  assert.equal(allowed, true)
})

test('backup encode/restore round-trip preserves frequency, prescription, core and effort', async () => {
  const { db } = await import('../src/db/db.js')
  const { encodeBackup, restoreBackup } = await import('../src/services/backupService.js')
  // In-memory table stubs: never open or alter a real athlete's IndexedDB.
  const tables = { profile: [profile()], sessions: [{ ...build().weeks[0].sessions.find((s) => s.discipline === 'gym'),
    importedAt: today.toISOString(), perceivedEffort: 0, sets: [{ exercise: 'Core', isCore: true, setsCount: 1 }] }], weekPhases: [], raceProjections: [] }
  const undo = []
  const replace = (object, key, value) => { const old = object[key]; object[key] = value; undo.push(() => { object[key] = old }) }
  replace(db, 'transaction', async (...args) => args.at(-1)())
  for (const [name] of Object.entries(tables)) {
    replace(db[name], 'toArray', async () => structuredClone(tables[name]))
    replace(db[name], 'get', async () => tables[name][0])
    replace(db[name], 'clear', async () => { tables[name] = [] })
    replace(db[name], 'put', async (row) => { tables[name] = [row] })
    replace(db[name], 'bulkAdd', async (rows) => { tables[name].push(...rows) })
  }
  try {
    const encoded = await encodeBackup()
    await restoreBackup(JSON.stringify(encoded))
    assert.equal(tables.profile[0].strengthSessionsPerWeek, 2)
    assert.deepEqual(tables.sessions[0].strengthPrescription, encoded.sessions[0].strengthPrescription)
    assert.equal(tables.sessions[0].sets[0].isCore, true)
    assert.equal(tables.sessions[0].perceivedEffort, 0)
  } finally { undo.reverse().forEach((restore) => restore()) }
})

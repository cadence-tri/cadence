import test from 'node:test'
import assert from 'node:assert/strict'
import { simulateSeason, marathonProfile, coachFixture } from '../scripts/simulate-season.mjs'
import { buildPlanSkeleton } from '../src/services/planning/planScheduler.js'
import { validateSkeleton, validateGeneratedPlan, mergeGeneratedWithSkeleton } from '../src/services/planning/planValidator.js'
import { packCoachContext, unpackCoachContext, coachContext, buildCompactCoachPrompt, expandCoachReply } from '../src/services/planning/coachProtocol.js'
import { parseMarkdown } from '../src/services/markdownImporter.js'
import { completedLoadWeeks, marathonCategory } from '../src/services/planning/seasonPlanning.js'
import { fitnessFingerprint } from '../src/services/planning/fitness.js'
import { asDate, toISODateString } from '../src/services/dateUtils.js'
import { readPendingCoach, savePendingCoach, clearPendingCoach } from '../src/services/planning/pendingCoach.js'
const today = new Date('2026-08-31T12:00:00')
const normal = { recovery: 'normal', previousBlockLoad: 'aboutRight', painLevel: 'none', assessment: 'offer' }
const build = (profile = marathonProfile(), extra = {}) => buildPlanSkeleton({ profile, today, checkIn: normal, ...extra })
const all = s => s.weeks.flatMap(w => w.sessions)

test('calendar fixtures are local dates while explicit timestamps remain real instants', () => {
  assert.equal(toISODateString(asDate('2026-08-31')), '2026-08-31')
  assert.equal(asDate('2026-08-31T00:00:00.000Z').getTime(), Date.parse('2026-08-31T00:00:00.000Z'))
})

test('pending compact plans survive reopening but reject changed profiles and corrupt storage', () => {
  const profile = marathonProfile(), skeleton = build(profile), values = new Map()
  const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }
  const plan = { skeleton, prompt: buildCompactCoachPrompt({ profile, skeleton }) }
  assert.equal(savePendingCoach(plan, storage), true)
  assert.deepEqual(readPendingCoach(profile, storage), plan)
  assert.equal(savePendingCoach({ ...plan, prompt: plan.prompt.replace('cadence-coach-v5', 'cadence-coach-v4') }, storage), true)
  assert.equal(readPendingCoach(profile, storage), null)
  assert.equal(savePendingCoach(plan, storage), true)
  assert.equal(readPendingCoach({ ...profile, goalOverallTime: '3:10:00' }, storage), null)
  clearPendingCoach(storage)
  assert.equal(readPendingCoach(profile, storage), null)
  assert.equal(readPendingCoach(profile, { getItem: () => '{' }), null)
})

test('lossless context codec preserves nested data, false/zero/null, keys and marker strings', () => {
  const value = { notes: 'Do not discard this note', weird: { $ref: 'literal', empty: [],
    zero: 0, no: false, nullable: null, escaped: ['@D0', '#R0', '!important', ['#P', 'D0', 0, 'test']] } }
  const packed = packCoachContext(value)
  assert.deepEqual(unpackCoachContext(packed), value)
})

test('focused Coach context keeps evidence and gym history but removes database and endurance duplication', () => {
  const profile = marathonProfile({ onboardingInjury: 'Previous knee discomfort; avoid painful movements.', onboardingAdditionalInfo: 'Keep my exact note.' })
  const skeleton = build(profile)
  const run = {
    id: 99, importedAt: '2026-09-01T10:00:00Z', importKey: 'private-key', schedulerSessionId: 'scheduler-key',
    date: '2026-08-30', discipline: 'run', title: 'Assessment', phase: 'buildUp', isCompleted: true,
    athleteFeedback: 'Comfortable and controlled.', perceivedEffort: 4, totalDistance: 8,
    workoutResult: { outcome: 'asPrescribed', feel: 'controlled', recovery: 'asPrescribed', actualValue: 250 },
    endurancePrescription: { family: 'run:development', purpose: 'assessment', repetitions: 4, workRepSeconds: 180,
      target: { unit: 'seconds/km', low: 245, high: 255 }, rationale: 'internal repeated rationale', steps: [{ stepId: 'original' }] },
    originalPrescription: [{ stepId: 'duplicate-original' }],
    sets: [{ stepId: 'completed-step', stepType: 'work', isCompleted: true, isSkipped: false, notes: 'Relax shoulders.' }],
  }
  const gym = { date: '2026-08-31', discipline: 'gym', title: 'Strength', isCompleted: true,
    strengthPrescription: { focus: 'upperBody', workSetsMin: 2, workSetsMax: 3 },
    sets: [{ exercise: 'Row', setsCount: 2, reps: 8, weightKg: 30, rest: '90 sec', isCompleted: true, isSkipped: false, isCore: false }] }
  const context = coachContext({ profile, skeleton, checkIn: normal, athleteNote: 'Exact current check-in note.', recentSessions: [run, gym] })
  assert.equal(context.athlete.onboardingAdditionalInfo, 'Keep my exact note.')
  assert.equal(context.athleteNote, 'Exact current check-in note.')
  assert.equal(context.previousSessions[0].athleteFeedback, 'Comfortable and controlled.')
  assert.equal(context.previousSessions[0].workoutResult.actualValue, 250)
  assert.equal(context.previousSessions[0].prescription.repetitions, 4)
  assert.deepEqual(context.previousSessions[0].stepCompletion, { total: 1, completed: 1, skipped: 0 })
  assert.equal(Object.hasOwn(context.previousSessions[0], 'priorCues'), false)
  for (const omitted of ['id', 'importedAt', 'importKey', 'schedulerSessionId', 'originalPrescription', 'sets', 'endurancePrescription']) {
    assert.equal(Object.hasOwn(context.previousSessions[0], omitted), false, omitted)
  }
  assert.equal(context.previousSessions[1].sets[0].exercise, 'Row')
  assert.equal(context.schedule.weeks[0].sessions[0].id, 'S1')
  assert.ok(context.schedule.weeks.flatMap(w => w.sessions).every(s => !Object.hasOwn(s, 'skeletonId')))
  assert.ok(buildCompactCoachPrompt({ profile, skeleton, checkIn: normal }).length < 40000)
})

test('focused payload keeps a completed two-week marathon block comfortably below the warning threshold', () => {
  const profile = marathonProfile(), first = build(profile)
  const parsed = parseMarkdown(JSON.stringify(coachFixture(first)), [], [], first)
  const history = mergeGeneratedWithSkeleton({ skeleton: first, sessions: parsed.newSessions }).map(session => ({
    ...session, isCompleted: true, perceivedEffort: session.discipline === 'gym' ? 6 : 4,
    athleteFeedback: 'Synthetic regression feedback retained for the next coach.',
    workoutResult: session.endurancePrescription?.feedbackRequired
      ? { outcome: 'asPrescribed', feel: 'controlled', recovery: 'asPrescribed', completedReps: session.endurancePrescription.repetitions }
      : null,
    sets: session.sets.map(step => ({ ...step, isCompleted: true, isSkipped: false, notes: step.notes ?? 'Prior technique cue retained.' })),
  }))
  const second = buildPlanSkeleton({ profile, today: new Date('2026-09-14T12:00:00'), checkIn: normal,
    recentSessions: history, planHistory: history, weekPhases: [] })
  const prompt = buildCompactCoachPrompt({ profile, skeleton: second, checkIn: normal, recentSessions: history })
  assert.ok(prompt.length < 30000, `focused prompt was ${prompt.length} characters`)
  const decoded = unpackCoachContext(JSON.parse(prompt.slice(prompt.indexOf('CONTEXT\n') + 8)))
  assert.equal(decoded.previousSessions.length, history.length)
  assert.ok(decoded.previousSessions.every(session => session.athleteFeedback.includes('retained')))
})

test('compact reply reconstructs identical locked sessions and preserves step cues', () => {
  const profile = marathonProfile(), skeleton = build(profile), reply = coachFixture(skeleton)
  const index = all(skeleton).findIndex(s => s.endurancePrescription)
  const step = all(skeleton)[index].endurancePrescription.steps[0]
  reply.sessions[index].cues = { [step.stepId]: 'Relax your shoulders.' }
  const parsed = parseMarkdown('```json\n' + JSON.stringify(reply) + '\n```', [], [], skeleton)
  assert.deepEqual(parsed.summary.failedItems, [])
  assert.deepEqual(validateGeneratedPlan({ skeleton, sessions: parsed.decodedSessions }).errors, [])
  const merged = mergeGeneratedWithSkeleton({ skeleton, sessions: parsed.newSessions })
  merged.forEach((s, i) => {
    assert.deepEqual(s.endurancePrescription, all(skeleton)[i].endurancePrescription)
    assert.equal(s.totalDistance, all(skeleton)[i].targetDistanceKm)
  })
  assert.equal(merged[index].sets[0].notes, 'Relax your shoulders.')
  reply.sessions.forEach(s => { s.title += ' renamed' })
  const again = parseMarkdown(JSON.stringify(reply), merged, [], skeleton)
  assert.equal(again.newSessions.length, 0)
  assert.equal(again.summary.skippedDuplicates, merged.length)
})

test('readable response manifest exposes every session and gym tasks lock slots/titles', () => {
  const profile = marathonProfile(), skeleton = build(profile), reply = coachFixture(skeleton)
  const prompt = buildCompactCoachPrompt({ profile, skeleton, checkIn: normal })
  const specs = all(skeleton)
  const gymIndex = all(skeleton).findIndex(session => session.strengthPrescription)
  const spec = all(skeleton)[gymIndex]
  assert.match(prompt, new RegExp(`S${gymIndex + 1} \\| GYM \\| ${spec.date} \\| focus=${spec.strengthPrescription.focus}`))
  assert.match(prompt, new RegExp(`SESSION TASKS — EXACT RESPONSE MANIFEST \\(${specs.length} total:`))
  assert.match(prompt, /Do not return only GYM lines/)
  assert.match(prompt, new RegExp(`EXPECTED IDS \\(${specs.length}\\): ${specs.map((_, index) => `S${index + 1}`).join(',')}`))
  const manifest = prompt.slice(prompt.indexOf('SESSION TASKS —'), prompt.indexOf('EXPECTED IDS'))
  assert.deepEqual([...manifest.matchAll(/^S(\d+) \|/gm)].map(match => Number(match[1])), specs.map((_, index) => index + 1))
  assert.ok(specs.filter(session => !session.strengthPrescription).every((session) => {
    const id = specs.indexOf(session) + 1
    return manifest.includes(`S${id} | ENDURANCE | ${session.date} | ${session.discipline}/${session.role}`)
  }))
  assert.match(prompt, /slots:/)
  assert.match(prompt, /load plan:/)
  reply.sessions[gymIndex].title = 'Wrong Deload and Focus Label'
  reply.sessions[gymIndex].sets.reverse()
  reply.sessions[gymIndex].sets[0].setsCount = 99
  reply.sessions[gymIndex].sets[1].setsCount = null
  const parsed = parseMarkdown(JSON.stringify(reply), [], [], skeleton)
  const gym = parsed.decodedSessions[gymIndex]
  assert.match(gym.title, new RegExp(spec.strengthPrescription.focus === 'upperBody' ? '^Upper-Body' : '^Lower-Body'))
  assert.deepEqual(gym.sets.map(set => set.slot), spec.strengthPrescription.exerciseSlots)
  assert.ok(gym.sets.every(set => set.setsCount === (set.slot === 'core'
    ? spec.strengthPrescription.coreSets : spec.strengthPrescription.workSetsMin)))
  assert.ok(parsed.summary.warnings.some(warning => /sets\/repetitions were adjusted/.test(warning)))
  assert.deepEqual(validateGeneratedPlan({ skeleton, sessions: parsed.decodedSessions }).errors, [])

  const wrongSlots = structuredClone(coachFixture(skeleton))
  wrongSlots.sessions[gymIndex].sets[0].slot = 'squat'
  assert.throws(() => expandCoachReply(JSON.stringify(wrongSlots), skeleton), /gym slots must be exactly/)
  const legacy = structuredClone(coachFixture(skeleton)); legacy.protocol = 'cadence-coach-v1'
  assert.throws(() => expandCoachReply(JSON.stringify(legacy), skeleton), /older Coach contract/)
})

test('compact imports reject missing, duplicate, stale, changed and malformed replies', () => {
  const skeleton = build(), original = coachFixture(skeleton)
  const gymOnly = { ...structuredClone(original), sessions: original.sessions.filter((_, index) => all(skeleton)[index].strengthPrescription) }
  assert.throws(() => expandCoachReply(JSON.stringify(gymOnly), skeleton), /missing sessions or adds sessions/)
  for (const mutate of [
    r => r.sessions.pop(), r => { r.sessions[1].id = r.sessions[0].id },
    r => { r.blockId = 'old-block' }, r => { r.sessions[0].totalDistance = 999 },
    r => { r.sessions[0].cues = { unknown: 'cue' } },
    r => { const s = r.sessions.find(s => s.sets); s.sets[0].reps = -2 },
  ]) {
    const reply = structuredClone(original); mutate(reply)
    assert.throws(() => expandCoachReply(JSON.stringify(reply), skeleton))
  }
  assert.throws(() => expandCoachReply(JSON.stringify(original).slice(0, -20), skeleton), /incomplete/)
  assert.throws(() => expandCoachReply(JSON.stringify(original), null), /original saved schedule/)
})

test('completion without structured feedback counts full workload, but incomplete weeks do not', () => {
  const profile = marathonProfile(), skeleton = build(profile)
  const parsed = parseMarkdown(JSON.stringify(coachFixture(skeleton)), [], [], skeleton)
  const history = mergeGeneratedWithSkeleton({ skeleton, sessions: parsed.newSessions }).map(s => ({ ...s, isCompleted: true, sets: s.sets.map(x => ({ ...x, isCompleted: true })) }))
  const weeks = completedLoadWeeks(history, 'run', '2026-09-14', '2026-08-31')
  assert.equal(weeks.length, 2)
  assert.equal(weeks[0].totalKm, skeleton.weeks[0].targets.runKm)
  const lastRun = history.filter(s => s.discipline === 'run').at(-1)
  lastRun.sets[0].isCompleted = false
  assert.equal(completedLoadWeeks(history, 'run', '2026-09-14', '2026-08-31').length, 1)
})

test('starting capacity and performance tier never come from goal alone', () => {
  assert.equal(marathonCategory(marathonProfile({ onboardingCurrentRacePace: '', trainingFitness: { run: { level: 'experienced' } } })), 'intermediate')
  const low = marathonProfile({ trainingFitness: { run: { level: 'regular', currentWeeklyKm: 15, longestRunKm: 6 } } })
  assert.ok(build(low).weeks[0].targets.runKm <= 16)
  const high = marathonProfile({ trainingFitness: { run: { level: 'experienced', currentWeeklyKm: 60, longestRunKm: 22 } } })
  assert.equal(build(high).weeks[0].targets.runKm, 60)
  assert.notEqual(fitnessFingerprint(high), fitnessFingerprint(low))
})

test('34-week marathon reaches adaptive peak and long-run targets without volume collapse', () => {
  const result = simulateSeason()
  assert.deepEqual(result.summary.errors, [])
  assert.equal(result.weeks.length, 34)
  assert.equal(result.summary.assessments.length, 3)
  assert.ok(result.summary.peakRunKm >= 75 && result.summary.peakRunKm <= 85)
  assert.ok(result.summary.longestRunKm >= 30 && result.summary.longestRunKm <= 35)
  assert.ok(result.summary.raceSpecific >= 4)
  let prior = null
  for (const week of result.weeks) {
    if (!['recovery', 'taper'].includes(week.phase)) {
      if (prior != null) { assert.ok(week.targets.runKm >= prior * 0.95); assert.ok(week.targets.runKm <= prior * 1.11 + 0.5) }
      prior = week.targets.runKm
    }
    const sessions = week.sessions
    assert.equal(new Set(sessions.map(s => s.date)).size, 6)
    assert.ok(sessions.every(s => s.isRace || s.discipline === 'gym' || s.targetDistanceKm > 0))
    for (const s of sessions.filter(s => s.distanceLed)) assert.equal(s.endurancePrescription.steps.reduce((n, x) => n + x.distanceM, 0), s.targetDistanceKm * 1000)
  }
  assert.deepEqual(result.weeks.at(-1).sessions.filter(s => s.date === '2027-04-25').map(s => s.role), ['race'])
  assert.ok(result.weeks.at(-1).targets.runKm < result.summary.peakRunKm * 0.4)
})

test('beginner and intermediate peak ranges differ and do not force performance mileage', () => {
  for (const [level, goal, range] of [['new', '4:30:00', [45,55]], ['regular', '3:45:00', [55,65]]]) {
    const result = simulateSeason({ profile: marathonProfile({ goalOverallTime: goal, trainingFitness: { run: { level } } }) })
    assert.deepEqual(result.summary.errors, [])
    assert.ok(result.summary.peakRunKm >= range[0] && result.summary.peakRunKm <= range[1])
    assert.equal(result.summary.assessments.length, 3)
  }
})

test('triathlon gives one checkpoint per discipline/phase, preserves technique and has an event', () => {
  const profile = marathonProfile({ sport: 'triathlon', onboardingTriPriorExperience: true, trainingFitness: { swim: { level: 'new' }, run: { level: 'regular' }, bike: { level: 'regular' } } })
  const result = simulateSeason({ profile })
  assert.deepEqual(result.summary.errors, [])
  assert.equal(result.summary.assessments.length, 9)
  assert.equal(new Set(result.summary.assessments.map(s => s.key)).size, 9)
  assert.equal(result.summary.races, 1)
  for (const w of result.weeks) {
    if (['recovery','taper'].includes(w.phase)) assert.ok(w.sessions.every(s => s.endurancePrescription?.purpose !== 'assessment'))
    const swims = w.sessions.filter(s => s.discipline === 'swim')
    if (swims.length > 1) assert.equal(swims.filter(s => s.endurancePrescription.purpose === 'technique').length, 1)
    assert.ok(swims.every(s => s.targetDistanceKm < 2))
  }
})

test('fatigue, missing feedback, insufficient availability and explicit duration caps do not force targets', () => {
  const noFeedback = simulateSeason({ feedback: null, maxBlocks: 3 })
  assert.deepEqual(noFeedback.summary.errors, [])
  assert.ok(noFeedback.weeks[2].targets.runKm >= noFeedback.weeks[0].targets.runKm)
  const fatigue = simulateSeason({ maxBlocks: 3, checkInForBlock: b => b === 1 ? { recovery: 'fatigued' } : {} })
  assert.deepEqual(fatigue.summary.errors, [])
  assert.ok(fatigue.weeks[2].targets.runKm <= fatigue.weeks[1].targets.runKm)
  assert.ok(fatigue.weeks[2].sessions.some(s => s.isOptional))
  const constrained = marathonProfile({ trainingDaysPerWeek: 2, trainingFitness: { run: { level: 'experienced', maxSessionMinutes: 45 } } })
  const s = build(constrained)
  assert.deepEqual(validateSkeleton(s, constrained).errors, [])
  assert.ok(all(s).filter(s => s.discipline === 'run').every(s => s.targetDurationMin <= 45))
})

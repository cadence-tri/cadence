import test from 'node:test'
import assert from 'node:assert/strict'
import { disciplineKm, completedLoadWeeks } from '../src/services/planning/seasonPlanning.js'
import { strengthPrescription, strengthExerciseSelection, strengthLoadPlan } from '../src/services/planning/strengthPlanning.js'
import { evidenceFingerprint, evidenceFor } from '../src/services/planning/fitness.js'
import { RUN_RACE_DISTANCE_STAGES } from '../src/services/planning/endurancePlanning.js'
import { durationMinutes } from '../src/db/session.js'

const run = () => ({ date: '2026-09-07', discipline: 'run', title: 'Easy', totalDistance: 2,
  prescriptionEdited: true, endurancePrescription: { family: 'run:development' },
  sets: [{ distanceM: 5000, setsCount: 1, isCompleted: true }] })
test('completed 2km → 5km edit becomes weekly workload, never pace evidence', () => {
  const s = run()
  assert.equal(disciplineKm(s, 'run'), 5)
  assert.equal(completedLoadWeeks([s], 'run', '2026-09-21', '2026-09-07')[0].totalKm, 5)
  assert.equal(evidenceFor([s], 'run', new Date('2026-09-21')).length, 0)
  s.sets[0].isCompleted = false
  assert.equal(completedLoadWeeks([s], 'run', '2026-09-21', '2026-09-07').length, 0)
})
test('reported whole distance wins; smaller edits and extra completed steps count', () => {
  const s = run()
  s.sets[0].distanceM = 1000
  s.sets.push({ distanceM: 500, setsCount: 2, athleteAdded: true, isCompleted: true })
  assert.equal(disciplineKm(s, 'run'), 2)
  s.workoutResult = { actualDistanceKm: 3 }
  assert.equal(disciplineKm(s, 'run'), 3)
})
test('edited time segments retain prescribed pace estimates and brick edits use leg distances', () => {
  const s = run()
  s.sets.push({ duration: '5m 30s', target: { high: 330 }, isCompleted: true })
  assert.equal(disciplineKm(s, 'run'), 6)
  assert.equal(durationMinutes({ duration: '5m 30s' }), 5.5)
  s.discipline = 'brick'
  s.sets = [{ discipline: 'run', distanceM: 5000, isCompleted: true }, { discipline: 'bike', distanceM: 20000, isCompleted: true }]
  assert.equal(disciplineKm(s, 'run'), 5)
  assert.equal(disciplineKm(s, 'bike'), 20)
})
test('editing completed workload invalidates a pending plan fingerprint', () => {
  const s = run(), today = new Date('2026-09-21')
  const before = evidenceFingerprint([s], today)
  s.sets[0].distanceM = 6000
  assert.notEqual(evidenceFingerprint([s], today), before)
})
test('each gym focus rotates four exercises across six choices', () => {
  for (const equipment of ['gym', 'bodyweight']) for (const focus of ['upperBody', 'lowerBody', 'fullBody']) {
    const p = strengthPrescription({ excludeGymSessions: equipment === 'bodyweight', bodyweightOnlyStrength: true }, focus, 'normal')
    const a = Object.values(strengthExerciseSelection(p, [], 0))
    const b = Object.values(strengthExerciseSelection(p, [], 1))
    assert.equal(a.length, 4)
    assert.equal(new Set([...a, ...b]).size, 6)
  }
})
test('completed added exercise enters bounded pool, retains only its own load', () => {
  const prescription = strengthPrescription({}, 'lowerBody', 'normal')
  const history = [{ discipline: 'gym', date: '2026-09-07', strengthPrescription: prescription,
    perceivedEffort: 6, sets: [{ exercise: 'Walking lunge', slot: 'singleLeg', athleteAdded: true, isCompleted: true, weightKg: 12.5, reps: 8 }] }]
  const selectedExercises = strengthExerciseSelection(prescription, history, 1)
  assert.equal(selectedExercises.singleLeg, 'Walking lunge')
  assert.equal(strengthLoadPlan({ prescription, history, selectedExercises }).find(x => x.slot === 'singleLeg').fromWeightKg, 12.5)
  const other = strengthExerciseSelection(prescription, history, 0)
  assert.equal(strengthLoadPlan({ prescription, history, selectedExercises: other }).find(x => x.slot === 'singleLeg').fromWeightKg, null)
  history[0].sets[0].isCompleted = false
  assert.notEqual(strengthExerciseSelection(prescription, history, 1).singleLeg, 'Walking lunge')
})
test('race-specific stages reach 2km reps while changing one workload dimension at a time', () => {
  assert.equal(RUN_RACE_DISTANCE_STAGES.at(-1)[1], 2000)
  RUN_RACE_DISTANCE_STAGES.slice(1).forEach((stage, i) => assert.equal(stage.filter((n, j) => n !== RUN_RACE_DISTANCE_STAGES[i][j]).length, 1))
})

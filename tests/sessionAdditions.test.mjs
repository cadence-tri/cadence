import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDecimal, appendAthleteStep } from '../src/services/sessionAdditions.js'
import { strengthLoadPlan } from '../src/services/planning/strengthPlanning.js'
import { focusedPreviousSession } from '../src/services/planning/coachProtocol.js'
test('decimal weights support both separators without truncation', () => {
  for (const v of ['62.5', '62,5', ' 62,5 ']) assert.equal(parseDecimal(v), 62.5)
  assert.equal(parseDecimal('1,25'), 1.25)
  assert.equal(parseDecimal('0'), 0)
  assert.equal(parseDecimal(''), null)
  for (const v of ['-5', '62,5.2', 'Infinity', 'NaN', '1e3', 'abc']) assert.ok(Number.isNaN(parseDecimal(v)))
})
test('added endurance work reaches coach and invalidates original progression feedback', () => {
  const session = { discipline: 'run', sets: [{ exercise: 'Run', isCompleted: true }], endurancePrescription: { family: 'easy' }, workoutResult: { outcome: 'completed' } }
  const patch = appendAthleteStep(session, { exercise: ' Extra strides ', distanceM: 100, setsCount: 4, isCompleted: true })
  assert.equal(session.sets.length, 1)
  assert.equal(patch.sets.length, 2)
  assert.equal(patch.workoutResult, null)
  assert.equal(patch.prescriptionEdited, true)
  const context = focusedPreviousSession({ ...session, ...patch })
  assert.equal(context.addedSteps[0].exercise, 'Extra strides')
  assert.equal(context.addedSteps[0].distanceM, 100)
})
test('only completed added lunges establish matching future load', () => {
  const session = { discipline: 'gym', date: '2026-09-10', strengthPrescription: { mode: 'normal' }, sets: [] }
  const patch = appendAthleteStep(session, { exercise: 'Lunges', slot: 'singleLeg', reps: 8, setsCount: 3, weightKg: 12.5, isCompleted: true })
  const args = { prescription: { mode: 'normal', exerciseSlots: ['singleLegOrCarry'] }, history: [{ ...session, ...patch }] }
  assert.equal(strengthLoadPlan(args)[0].preferredExercise, 'Lunges')
  assert.equal(strengthLoadPlan(args)[0].suggestedWeightKg, 12.5)
  patch.sets[0].isCompleted = false
  assert.equal(strengthLoadPlan(args)[0].preferredExercise, null)
})
test('empty sessions accept additions and incomplete additions clear completion', () => {
  const patch = appendAthleteStep({ sets: [], isCompleted: true }, { exercise: 'Lunges' })
  assert.equal(patch.isCompleted, false)
  assert.equal(patch.sets[0].athleteAdded, true)
  assert.throws(() => appendAthleteStep({}, { exercise: ' ' }))
})

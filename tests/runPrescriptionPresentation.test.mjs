import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatRunDuration,
  formatRunQuantity,
  formatRunTarget,
  runStepPresentation,
  runWorkoutOverview,
} from '../src/components/runPrescriptionPresentation.js'

const target = (pace, effort) => `${pace}; controlled effort ${effort}/10 (slow down if needed)`
const step = (stepType, seconds, pace, effort = '2–4', extra = {}) => ({
  stepType,
  durationSeconds: seconds,
  duration: seconds == null ? null : `${Math.floor(seconds / 60)}m ${seconds % 60}s`,
  paceOrPower: target(pace, effort),
  setsCount: 1,
  ...extra,
})

test('run durations and repeat quantities use athlete-facing formatting', () => {
  assert.equal(formatRunDuration({ durationSeconds: 180 }), '3 min')
  assert.equal(formatRunDuration({ durationSeconds: 90 }), '1:30')
  assert.equal(formatRunDuration({ duration: '4m 0s' }), '4 min')
  assert.equal(formatRunQuantity({ distanceM: 1500, setsCount: 1 }), '1.5 km')
  assert.equal(formatRunQuantity({ durationSeconds: 60, setsCount: 3 }), '3 × 1 min')
})

test('run target formatting keeps pace and RPE but removes repeated safety prose', () => {
  assert.deepEqual(formatRunTarget(target('3:55/km–4:04/km', '4–6')), {
    target: '3:55–4:04/km',
    rpe: 'RPE 4–6',
  })
  assert.deepEqual(formatRunTarget(target('Effort-led', '2–4')), {
    target: 'Effort-led',
    rpe: 'RPE 2–4',
  })
})

test('run steps receive concise athlete-facing labels without changing the steps', () => {
  const sets = [
    step('warmup', 180, '4:37/km–5:17/km'),
    step('work', 180, '3:55/km–4:04/km', '4–6'),
    step('recovery', 90, '4:37/km–5:17/km'),
    step('work', 180, '3:55/km–4:04/km', '4–6'),
    step('easy', 180, '4:37/km–5:17/km'),
    step('cooldown', 90, '4:37/km–5:17/km'),
  ]
  const original = structuredClone(sets)
  const views = runStepPresentation(sets)

  assert.deepEqual(views.map((view) => view.label), [
    'Warm-up', 'Rep 1 of 2', 'Recovery', 'Rep 2 of 2', 'Easy running', 'Cool-down',
  ])
  assert.equal(views[1].quantity, '3 min')
  assert.equal(views[1].target, '3:55–4:04/km')
  assert.equal(views[1].rpe, 'RPE 4–6')
  assert.deepEqual(sets, original)
})

test('workout overview summarizes the recipe while individual rows remain available', () => {
  const sets = [
    step('warmup', 180, '4:37/km–5:17/km'),
    step('work', 180, '3:55/km–4:04/km', '4–6'),
    step('recovery', 90, '4:37/km–5:17/km'),
    step('work', 180, '3:55/km–4:04/km', '4–6'),
    step('easy', 180, '4:37/km–5:17/km'),
    step('cooldown', 90, '4:37/km–5:17/km'),
  ]

  assert.deepEqual(runWorkoutOverview(sets), [
    { label: 'Warm-up', value: '3 min', detail: null },
    { label: 'Main set', value: '2 × 3 min', detail: '3:55–4:04/km · RPE 4–6' },
    { label: 'Recovery', value: '1:30 easy between reps', detail: null },
    { label: 'Easy running', value: '3 min', detail: null },
    { label: 'Cool-down', value: '1:30', detail: null },
  ])

  assert.deepEqual(runWorkoutOverview([
    step('work', null, 'Effort-led', '4–6', { distanceM: 3000 }),
  ]), [
    { label: 'Main set', value: '3 km', detail: 'Effort-led · RPE 4–6' },
  ])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bikeStepPresentation,
  bikeWorkoutOverview,
  swimStepPresentation,
  swimWorkoutOverview,
  gymStepPresentation,
  gymWorkoutSummary,
  brickStepPresentation,
  brickWorkoutOverview,
} from '../src/components/otherPrescriptionPresentation.js'

const target = (value, effort) => `${value}; controlled effort ${effort}/10 (slow down if needed)`
const timed = (stepType, durationSeconds, paceOrPower, exercise, extra = {}) => ({
  stepType,
  durationSeconds,
  duration: `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`,
  paceOrPower,
  exercise,
  setsCount: 1,
  ...extra,
})

test('bike presentation uses cycling labels, compact watts and a recipe summary', () => {
  const sets = [
    timed('warmup', 600, target('130 W–156 W', '2–4'), 'Easy warm-up'),
    timed('work', 300, target('204 W–223 W', '4–6'), 'threshold repetition 1'),
    timed('recovery', 150, target('130 W–156 W', '2–4'), 'Easy recovery'),
    timed('work', 300, target('204 W–223 W', '4–6'), 'threshold repetition 2'),
    timed('cooldown', 300, target('130 W–156 W', '2–4'), 'Easy cool-down'),
  ]
  const original = structuredClone(sets)
  const views = bikeStepPresentation(sets)
  assert.deepEqual(views.map((view) => view.label), ['Warm-up', 'Rep 1 of 2', 'Recovery spin', 'Rep 2 of 2', 'Cool-down'])
  assert.equal(views[1].target, '204–223 W')
  assert.equal(views[1].rpe, 'RPE 4–6')
  assert.deepEqual(bikeWorkoutOverview(sets), [
    { label: 'Warm-up', value: '10 min', detail: null },
    { label: 'Main set', value: '2 × 5 min', detail: '204–223 W · RPE 4–6' },
    { label: 'Recovery', value: '2:30 easy between reps', detail: null },
    { label: 'Cool-down', value: '5 min', detail: null },
  ])
  assert.deepEqual(sets, original)
})

test('swim presentation preserves drill coaching while extracting repeated structure', () => {
  const sets = [
    { stepType: 'warmup', exercise: 'Easy full-stroke swim', distanceM: 250, setsCount: 1,
      paceOrPower: target('2:37/100m–3:00/100m', '2–4'), notes: 'Start relaxed.' },
    { stepType: 'drill', exercise: 'Six-kick switch → easy freestyle', distanceM: 50, setsCount: 3,
      paceOrPower: target('Effort-led', '2–4'), rest: '20–30s after each 50m',
      notes: 'Each repetition is 25m drill + 25m easy full-stroke transfer. Kick six small beats and rotate smoothly.' },
    { stepType: 'drill', exercise: 'Single-arm freestyle → full stroke', distanceM: 50, setsCount: 2,
      paceOrPower: target('Effort-led', '2–4'), rest: '20–30s after each 50m',
      notes: 'Each repetition is 25m drill + 25m easy full-stroke transfer. Change arms each repetition.' },
    { stepType: 'work', exercise: 'Controlled full-stroke swim', distanceM: 50, setsCount: 3,
      paceOrPower: target('2:37/100m–3:00/100m', '2–4'), rest: '30s between repetitions', notes: 'Preserve form.' },
    { stepType: 'easy', exercise: 'Easy full-stroke swim; preserve form', distanceM: 925, setsCount: 1,
      paceOrPower: target('2:37/100m–3:00/100m', '2–4') },
    { stepType: 'cooldown', exercise: 'Easy cool-down swim', distanceM: 175, setsCount: 1,
      paceOrPower: target('2:37/100m–3:00/100m', '2–4'), notes: 'Finish relaxed.' },
  ]
  const original = structuredClone(sets)
  const views = swimStepPresentation(sets)
  assert.equal(views[1].quantity, '3 × 50 m')
  assert.deepEqual(views[1].details, ['25 m drill + 25 m easy', 'Easy technique', 'RPE 2–4', '20–30 sec rest'])
  assert.equal(views[1].note, 'Kick six small beats and rotate smoothly.')
  assert.equal(views[3].target, '2:37–3:00/100 m')
  assert.deepEqual(swimWorkoutOverview(sets), [
    { label: 'Warm-up', value: '250 m', detail: null },
    { label: 'Technique', value: '5 × 50 m', detail: '2 drills' },
    { label: 'Main set', value: '3 × 50 m', detail: '2:37–3:00/100 m · RPE 2–4 · 30 sec rest' },
    { label: 'Easy swim', value: '925 m', detail: null },
    { label: 'Cool-down', value: '175 m', detail: null },
  ])
  assert.deepEqual(sets, original)
})

test('gym presentation separates exercise, scheme, rest and immutable session constraints', () => {
  const session = {
    sets: [
      { exercise: 'Back squat', setsCount: 3, reps: 8, rest: '90 sec' },
      { exercise: 'Dead bug', setsCount: 3, duration: '30 sec/side', rest: '45 sec' },
    ],
    strengthPrescription: {
      durationMinutes: 45, exerciseSlots: ['squat', 'core'], workSetsMin: 3, coreSets: 3,
      maxEffort: 7, coreFinisherRequired: true,
    },
  }
  assert.deepEqual(gymStepPresentation(session.sets), [
    { label: 'Back squat', quantity: '3 × 8 reps', details: ['90 sec'] },
    { label: 'Dead bug', quantity: '3 × 30 sec/side', details: ['45 sec'] },
  ])
  assert.deepEqual(gymWorkoutSummary(session), {
    metrics: ['45 min', '2 exercises', '3 sets each', 'RPE ≤ 7'],
    note: 'Core finisher included',
  })
})

test('brick presentation applies the matching bike and run formats without changing leg data', () => {
  const sets = [
    timed('work', 3600, target('130 W–156 W', '2–4'), 'Easy bike leg', { discipline: 'bike' }),
    timed('work', 1200, target('5:15/km–6:00/km', '2–4'), 'Easy run leg', { discipline: 'run' }),
  ]
  const views = brickStepPresentation(sets)
  assert.deepEqual(views.map((view) => view.label), ['Bike leg', 'Run leg'])
  assert.equal(views[0].target, '130–156 W')
  assert.equal(views[1].target, '5:15–6:00/km')
  assert.deepEqual(brickWorkoutOverview(sets), [
    { label: 'Bike leg', value: '60 min', detail: '130–156 W · RPE 2–4' },
    { label: 'Run leg', value: '20 min', detail: '5:15–6:00/km · RPE 2–4' },
  ])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chartUpperBound, formatAxisTick, formatVolumeLabel, weeklyBuckets } from '../src/services/statsChart.js'
import { completedBrickLegDistanceKm } from '../src/db/session.js'

test('weekly chart reserves label headroom and formats compact single-line values', () => {
  assert.equal(chartUpperBound(1.8), 2)
  assert.equal(chartUpperBound(17), 20)
  assert.equal(chartUpperBound(67), 80)
  assert.equal(chartUpperBound(0.3), 0.4)
  assert.equal(formatVolumeLabel(1.799999999, 'km'), '1.8 km')
  assert.equal(formatVolumeLabel(67.2, 'km'), '67 km')
})

test('axis ticks never expose floating-point rendering artifacts', () => {
  assert.equal(formatAxisTick(0.549999999999997), '0.55')
  assert.equal(formatAxisTick(5.49999999999997), '5.5')
  assert.equal(formatAxisTick(19.549999999999997), '19.6')
  assert.equal(formatAxisTick(99999.99999999997), '100,000')
  assert.equal(formatAxisTick(Number.NaN), '—')
})

test('weekly chart normalizes floating-point sums before rendering', () => {
  const sessions = [
    { date: '2026-08-31', value: 0.1 },
    { date: '2026-09-01', value: 0.2 },
    { date: '2026-09-07', value: 1.5 },
  ]
  assert.deepEqual(weeklyBuckets(sessions, session => session.value).map(point => point.value), [0.3, 1.5])
})

test('gym exercise progression remains visible when the selected view has no logged weights', async () => {
  const source = await readFile(new URL('../src/screens/StatsScreen.jsx', import.meta.url), 'utf8')
  assert.match(source, /No exercise weights logged in this view/)
  assert.doesNotMatch(source, /if \(exerciseNames\.length === 0\) return null/)
  assert.match(source, /<GymProgressionSection sessions=\{sessions\} \/>/)
})

test('completed brick legs contribute to their Run and Bike Stats totals without crediting skipped legs', async () => {
  const brick = {
    discipline: 'brick',
    endurancePrescription: { legDistancesKm: { bike: 42.5, run: 7 } },
    sets: [
      { discipline: 'bike', isCompleted: true, isSkipped: false },
      { discipline: 'run', isCompleted: false, isSkipped: true },
    ],
  }
  assert.equal(completedBrickLegDistanceKm(brick, 'bike'), 42.5)
  assert.equal(completedBrickLegDistanceKm(brick, 'run'), 0)
  assert.equal(completedBrickLegDistanceKm(brick, 'swim'), 0)

  const legacy = { discipline: 'brick', isCompleted: true, brickTargets: { bikeKm: 30, runKm: 5 } }
  assert.equal(completedBrickLegDistanceKm(legacy, 'bike'), 30)
  assert.equal(completedBrickLegDistanceKm(legacy, 'run'), 5)

  const source = await readFile(new URL('../src/screens/StatsScreen.jsx', import.meta.url), 'utf8')
  assert.match(source, /completedBrickLegDistanceKm\(s, discipline\)/)
})

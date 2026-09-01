import test from 'node:test'
import assert from 'node:assert/strict'
import { chartUpperBound, formatAxisTick, formatVolumeLabel, weeklyBuckets } from '../src/services/statsChart.js'

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

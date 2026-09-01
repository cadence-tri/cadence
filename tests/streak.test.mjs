import test from 'node:test'
import assert from 'node:assert/strict'
import { isCompletedActivity, weekStreak } from '../src/db/session.js'

const completed = (date, extra = {}) => ({ date, discipline: 'run', isCompleted: true, ...extra })
const incomplete = (date) => ({ date, discipline: 'run', isCompleted: false })

test('weekly streak needs one completed activity rather than a fully completed schedule', () => {
  const sessions = [
    completed('2026-09-01'), incomplete('2026-09-02'),
    completed('2026-08-25'), incomplete('2026-08-27'),
    completed('2026-08-18'), incomplete('2026-08-20'),
  ]
  assert.equal(weekStreak(sessions, new Date('2026-09-03T12:00:00')), 3)
})

test('historical streak is retained during the current-week grace period and stops at a blank past week', () => {
  const past = [completed('2026-08-25'), completed('2026-08-18'), completed('2026-08-11')]
  assert.equal(weekStreak(past, new Date('2026-09-01T12:00:00')), 3)
  assert.equal(weekStreak([completed('2026-09-01'), completed('2026-08-18')], new Date('2026-09-03T12:00:00')), 1)
})

test('rest days, incomplete activities and fully skipped workouts do not extend the streak', () => {
  const fullySkipped = { date: '2026-09-01', discipline: 'run', sets: [{ isCompleted: false, isSkipped: true }] }
  const partiallyDone = { date: '2026-09-01', discipline: 'run', sets: [{ isCompleted: true }, { isCompleted: false }] }
  const completedSets = { date: '2026-09-01', discipline: 'swim', sets: [{ isCompleted: true }, { isCompleted: true }] }
  assert.equal(isCompletedActivity({ ...completed('2026-09-01'), discipline: 'rest' }), false)
  assert.equal(isCompletedActivity(fullySkipped), false)
  assert.equal(isCompletedActivity(partiallyDone), false)
  assert.equal(isCompletedActivity(completedSets), true)
  assert.equal(weekStreak([fullySkipped], new Date('2026-09-03T12:00:00')), 0)
})

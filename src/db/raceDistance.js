// Ported from Models/RaceDistance.swift. `PLAN_SCHEMA.md` §7 keys its
// weekly-volume tables off these exact values — treat any change here as
// a schema change (update both together).
export const RUNNING_DISTANCES = ['fiveK', 'tenK', 'halfMarathon', 'marathon']

export const RUNNING_META = {
  fiveK: { displayName: '5K', distanceKm: 5, minTrainingDaysPerWeek: 3, article: 'a 5K' },
  tenK: { displayName: '10K', distanceKm: 10, minTrainingDaysPerWeek: 3, article: 'a 10K' },
  halfMarathon: {
    displayName: 'Half Marathon',
    distanceKm: 21.1,
    minTrainingDaysPerWeek: 4,
    article: 'a half marathon',
  },
  marathon: { displayName: 'Marathon', distanceKm: 42.2, minTrainingDaysPerWeek: 5, article: 'a marathon' },
}

export const TRIATHLON_DISTANCES = ['sprint', 'olympic', 'halfIronman', 'ironman']

export const TRIATHLON_META = {
  sprint: {
    displayName: 'Sprint',
    legs: { swim: 0.75, bike: 20, run: 5 },
    minTrainingDaysPerWeek: 4,
    article: 'a sprint triathlon',
  },
  olympic: {
    displayName: 'Olympic',
    legs: { swim: 1.5, bike: 40, run: 10 },
    minTrainingDaysPerWeek: 5,
    article: 'an Olympic triathlon',
  },
  halfIronman: {
    displayName: 'Half Ironman (70.3)',
    legs: { swim: 1.9, bike: 90, run: 21.1 },
    minTrainingDaysPerWeek: 6,
    article: 'a half Ironman',
  },
  ironman: {
    displayName: 'Ironman (140.6)',
    legs: { swim: 3.8, bike: 180, run: 42.2 },
    minTrainingDaysPerWeek: 7,
    article: 'an Ironman',
  },
}

export const WEEKDAYS_MON_FIRST = [
  { value: 2, short: 'Mo', label: 'Monday' },
  { value: 3, short: 'Tu', label: 'Tuesday' },
  { value: 4, short: 'We', label: 'Wednesday' },
  { value: 5, short: 'Th', label: 'Thursday' },
  { value: 6, short: 'Fr', label: 'Friday' },
  { value: 7, short: 'Sa', label: 'Saturday' },
  { value: 1, short: 'Su', label: 'Sunday' },
]

/** JS `Date.getDay()` is 0=Sun...6=Sat; profile storage follows the native
 * app's `Weekday.rawValue` (1=Sun...7=Sat) so both codebases' stored data
 * reads the same way. This converts a JS day-of-week to that convention. */
export function jsDayToWeekdayValue(jsDay) {
  return jsDay === 0 ? 1 : jsDay + 1
}

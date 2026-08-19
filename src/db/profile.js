import { PROFILE_ID } from './db'

/** Default shape for a freshly created profile — mirrors
 * `AthleteProfile`'s Swift init defaults. `longSessionDays` is stored as a
 * plain array of weekday values (1=Sun...7=Sat, matching the native app's
 * `Weekday.rawValue`) rather than a comma-string — Dexie stores arrays
 * natively, so the string-encoding workaround SwiftData needed doesn't
 * apply here. */
export function newProfileDefaults(overrides = {}) {
  return {
    id: PROFILE_ID,
    name: '',
    sport: 'triathlon', // 'running' | 'triathlon'
    imageData: null, // base64 data URL string, or null
    createdAt: new Date().toISOString(),
    competitionName: '',
    competitionDate: null,
    runningDistance: 'marathon',
    triathlonDistance: 'olympic',
    goalOverallTime: '',
    goalSwimTime: '',
    goalBikeTime: '',
    goalRunTime: '',
    trainingDaysPerWeek: 5,
    longSessionDays: [],
    trainingBlockStartDate: null,
    ...overrides,
  }
}

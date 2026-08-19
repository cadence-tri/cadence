import Dexie from 'dexie'

// Dexie schema — the direct analog to the native app's SwiftData @Model
// classes (see HANDOFF_PWA.md "Data model to port"). Field names are kept
// close to the Swift originals so the two codebases stay easy to compare.
//
// Tables:
//  - profile: exactly one row ever exists (id fixed to 1) — no accounts.
//  - sessions: one row per TrainingSession, `sets` stored as a plain
//    array of SessionSet-shaped objects (Dexie handles nested
//    arrays/objects natively, no join table needed).
//  - weekPhases: one row per week that's ever had an explicit phase set.
export const db = new Dexie('cadence')

db.version(1).stores({
  profile: 'id',
  sessions: '++id, date, discipline, importKey, importedAt',
  weekPhases: '++id, &weekStart',
})

export const PROFILE_ID = 1

export default db

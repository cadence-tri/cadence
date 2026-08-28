import { db, PROFILE_ID } from '../db/db.js'
import { asDate, startOfWeekMon, startOfDay } from './dateUtils.js'
import { newProfileDefaults } from '../db/profile.js'
import { deterministicPhaseForWeek } from './planning/planScheduler.js'

// The file written by "Export backup" / read by "Import backup" — and,
// v1/v2 session/week-phase data is compatible with the native iOS backup
// shape, so native exports remain importable here. PWA format v3 adds the
// full profile as a backward-compatible superset; older native clients
// should not be assumed to understand a v3 PWA export until updated.
export const CURRENT_FORMAT_VERSION = 3

export class BackupError extends Error {}

export function normalizePerceivedEffort(raw) {
  if (raw == null || String(raw).trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? Math.min(10, Math.max(0, Math.round(value))) : null
}

/** Serializes the complete athlete profile, every session, and week-phase label into one backup object. */
export async function encodeBackup() {
  const [profile, sessions, weekPhases, raceProjections] = await Promise.all([db.profile.get(PROFILE_ID), db.sessions.toArray(), db.weekPhases.toArray(), db.raceProjections?.toArray() ?? []])
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sessionCount: sessions.length,
    profile: profile ? { ...profile, id: PROFILE_ID } : null,
    sessions: sessions.map((s) => ({
      date: asDate(s.date).toISOString(),
      discipline: s.discipline,
      title: s.title,
      notes: s.notes ?? '',
      sets: s.sets ?? [],
      isCompleted: !!s.isCompleted,
      athleteFeedback: s.athleteFeedback ?? '',
      perceivedEffort: s.perceivedEffort ?? null,
      importedAt: asDate(s.importedAt)?.toISOString() ?? new Date().toISOString(),
      weekLabel: s.weekLabel ?? null,
      isOptional: !!s.isOptional,
      totalDistance: s.totalDistance ?? null,
    })),
    weekPhases: weekPhases.map((wp) => ({
      weekStart: asDate(wp.weekStart).toISOString(),
      phase: wp.phase,
    })),
    raceProjections: raceProjections.map(({ id, ...projection }) => projection),
  }
}


export function normalizeProfileLoose(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const defaults = newProfileDefaults()
  const profile = { ...defaults, ...raw, id: PROFILE_ID }
  profile.sport = profile.sport === 'running' ? 'running' : 'triathlon'
  profile.trainingDaysPerWeek = Math.min(7, Math.max(1, Math.trunc(Number(profile.trainingDaysPerWeek) || defaults.trainingDaysPerWeek)))
  profile.longSessionDays = Array.isArray(profile.longSessionDays)
    ? [...new Set(profile.longSessionDays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))]
    : []
  profile.excludeGymSessions = !!profile.excludeGymSessions
  profile.bodyweightOnlyStrength = !!profile.bodyweightOnlyStrength
  profile.strengthPreferenceConfigured = !!profile.strengthPreferenceConfigured
  return profile
}

function normalizeDisciplineLoose(raw) {
  const known = ['swim', 'bike', 'run', 'brick', 'gym', 'rest', 'other']
  const tag = String(raw ?? '').trim().toLowerCase()
  return known.includes(tag) ? tag : 'other'
}

function normalizePhaseLoose(raw) {
  const known = ['buildUp', 'endurance', 'peak', 'taper', 'recovery', 'maintenance']
  return known.includes(raw) ? raw : 'maintenance'
}

/**
 * Rebuilds one scheduler-owned phase row for every calendar week represented
 * by imported sessions. This is deliberately profile-driven: legacy backups
 * may contain model-authored phase labels that predate the deterministic
 * scheduler and therefore must not become a second source of truth.
 */
export function deterministicWeekPhasesForImportedSessions(profile, sessions) {
  if (!profile || !Array.isArray(sessions) || sessions.length === 0) return []

  const earliestSession = sessions.reduce((earliest, session) => {
    const date = asDate(session.date)
    if (!date) return earliest
    return !earliest || date < earliest ? date : earliest
  }, null)
  if (!earliestSession) return []

  const origin = profile.trainingBlockStartDate ?? earliestSession
  const phasesByWeek = new Map()
  for (const session of sessions) {
    const sessionDate = asDate(session.date)
    if (!sessionDate) continue
    const weekStart = startOfWeekMon(sessionDate)
    const weekKey = weekStart.toISOString()
    phasesByWeek.set(weekKey, {
      weekStart: weekKey,
      phase: deterministicPhaseForWeek(profile, weekStart, origin),
    })
  }
  return [...phasesByWeek.values()]
}

/** Restores a backup, REPLACING the entire current log. Destructive by
 * design — the caller must have already confirmed with the athlete.
 * Accepts both a PWA-exported backup and a native-app-exported backup
 * (same JSON shape). */
export async function restoreBackup(fileText) {
  let file
  try {
    file = JSON.parse(fileText)
  } catch {
    throw new BackupError("This file doesn't look like a Cadence backup.")
  }
  if (!file || !Array.isArray(file.sessions)) {
    throw new BackupError("This file doesn't look like a Cadence backup.")
  }
  if (file.formatVersion && file.formatVersion > CURRENT_FORMAT_VERSION) {
    throw new BackupError(
      `This backup was made with a newer version of the app (format ${file.formatVersion}) and can't be restored here.`
    )
  }

  const sessionsToInsert = file.sessions.map((dto) => {
    const date = asDate(dto.date) ?? new Date()
    const discipline = normalizeDisciplineLoose(dto.discipline)
    return {
      date: date.toISOString(),
      discipline,
      title: dto.title ?? discipline,
      notes: dto.notes ?? '',
      sets: Array.isArray(dto.sets) ? dto.sets : [],
      isCompleted: !!dto.isCompleted,
      athleteFeedback: dto.athleteFeedback ?? '',
      perceivedEffort: normalizePerceivedEffort(dto.perceivedEffort),
      importedAt: asDate(dto.importedAt)?.toISOString() ?? new Date().toISOString(),
      weekLabel: dto.weekLabel ?? null,
      isOptional: !!dto.isOptional,
      totalDistance: dto.totalDistance ?? null,
      importKey: `${date.toISOString().slice(0, 10)}|${discipline}|${dto.title ?? ''}`,
    }
  })

  const profileToRestore = normalizeProfileLoose(file.profile)

  // v1/v2 backups do not contain a profile. In that case the restore keeps
  // Cadence's current singleton profile, so phase normalization must use that
  // same profile too. Reading it before the destructive transaction ensures
  // legacy backup handling cannot affect the normal v3 restore path.
  const existingProfile = profileToRestore ? null : normalizeProfileLoose(await db.profile.get(PROFILE_ID))
  const phaseProfile = profileToRestore ?? existingProfile

  let weekPhasesToInsert = (Array.isArray(file.weekPhases) ? file.weekPhases : []).map((dto) => ({
    weekStart: (asDate(dto.weekStart) ?? new Date()).toISOString(),
    phase: normalizePhaseLoose(dto.phase),
  }))

  if (phaseProfile && sessionsToInsert.length) {
    // Backups created before the deterministic scheduler may contain phase
    // labels authored by an external model. v3 uses the restored profile;
    // v1/v2 uses the current profile that remains in Cadence after restore.
    // This keeps Road to Race and the imported log on the same scheduler-owned
    // macrocycle without changing behavior for current-format backups.
    weekPhasesToInsert = deterministicWeekPhasesForImportedSessions(phaseProfile, sessionsToInsert)
  }
  const raceProjectionsToInsert = (Array.isArray(file.raceProjections) ? file.raceProjections : [])
    .filter((p) => p?.raceKey && p?.date && Number.isFinite(p?.projectedSeconds))
    .map(({ id, ...projection }) => projection)

  await db.transaction('rw', db.profile, db.sessions, db.weekPhases, db.raceProjections, async () => {
    await db.sessions.clear()
    await db.weekPhases.clear()
    await db.raceProjections.clear()
    if (profileToRestore) await db.profile.put(profileToRestore)
    if (sessionsToInsert.length) await db.sessions.bulkAdd(sessionsToInsert)
    if (weekPhasesToInsert.length) await db.weekPhases.bulkAdd(weekPhasesToInsert)
    if (raceProjectionsToInsert.length) await db.raceProjections.bulkAdd(raceProjectionsToInsert)
  })

  return sessionsToInsert.length
}

/** Deletes every session from the start of the current week onward (plus
 * matching week-phase labels), leaving past weeks (the Training Log)
 * untouched. */
export async function deleteUpcoming() {
  const today = startOfDay(new Date())
  const weekStart = startOfWeekMon(today)

  return db.transaction('rw', db.sessions, db.weekPhases, async () => {
    const sessions = await db.sessions.toArray()
    const toDelete = sessions.filter((s) => asDate(s.date) >= weekStart)
    await db.sessions.bulkDelete(toDelete.map((s) => s.id))

    const phases = await db.weekPhases.toArray()
    const phasesToDelete = phases.filter((p) => asDate(p.weekStart) >= weekStart)
    await db.weekPhases.bulkDelete(phasesToDelete.map((p) => p.id))

    return toDelete.length
  })
}

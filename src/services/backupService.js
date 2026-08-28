import { db, PROFILE_ID } from '../db/db.js'
import { asDate, startOfWeekMon, startOfDay } from './dateUtils.js'
import { newProfileDefaults } from '../db/profile.js'

// The file written by "Export backup" / read by "Import backup" — and,
// v1/v2 session/week-phase data is compatible with the native iOS backup
// shape, so native exports remain importable here. PWA format v3 adds the
// full profile as a backward-compatible superset; older native clients
// should not be assumed to understand a v3 PWA export until updated.
export const CURRENT_FORMAT_VERSION = 3

export class BackupError extends Error {}

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
      importedAt: asDate(dto.importedAt)?.toISOString() ?? new Date().toISOString(),
      weekLabel: dto.weekLabel ?? null,
      isOptional: !!dto.isOptional,
      totalDistance: dto.totalDistance ?? null,
      importKey: `${date.toISOString().slice(0, 10)}|${discipline}|${dto.title ?? ''}`,
    }
  })

  const profileToRestore = normalizeProfileLoose(file.profile)

  const weekPhasesToInsert = (Array.isArray(file.weekPhases) ? file.weekPhases : []).map((dto) => ({
    weekStart: (asDate(dto.weekStart) ?? new Date()).toISOString(),
    phase: normalizePhaseLoose(dto.phase),
  }))
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

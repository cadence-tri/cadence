import { db } from '../db/db'
import { asDate, startOfWeekMon, startOfDay } from './dateUtils'

// The file written by "Export backup" / read by "Import backup" — and,
// since the shape is identical, also what a *native iOS app* backup
// export produces (SessionBackupDTO/BackupFile in BackupService.swift use
// the same field names and ISO-8601 dates). That means "import my
// training history from the Swift app" is not a separate feature: it's
// this exact Import Backup flow, pointed at a file exported from the
// native app's Profile → Backup & Restore screen instead of one exported
// from here.
export const CURRENT_FORMAT_VERSION = 2

export class BackupError extends Error {}

/** Serializes every session and week-phase label into one backup object. */
export async function encodeBackup() {
  const [sessions, weekPhases] = await Promise.all([db.sessions.toArray(), db.weekPhases.toArray()])
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sessionCount: sessions.length,
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
  }
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

  const weekPhasesToInsert = (Array.isArray(file.weekPhases) ? file.weekPhases : []).map((dto) => ({
    weekStart: (asDate(dto.weekStart) ?? new Date()).toISOString(),
    phase: normalizePhaseLoose(dto.phase),
  }))

  await db.transaction('rw', db.sessions, db.weekPhases, async () => {
    await db.sessions.clear()
    await db.weekPhases.clear()
    if (sessionsToInsert.length) await db.sessions.bulkAdd(sessionsToInsert)
    if (weekPhasesToInsert.length) await db.weekPhases.bulkAdd(weekPhasesToInsert)
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

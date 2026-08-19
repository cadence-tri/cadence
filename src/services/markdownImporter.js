import { db } from '../db/db'
import { normalizeDiscipline } from '../db/discipline'
import { parsePhase } from '../db/phase'
import { newSet, makeImportKey } from '../db/session'
import { parseImportDate, startOfWeekMon, toISODateString } from './dateUtils'

/** Extracts every ```session ... ``` fenced block from markdown text. */
export function extractSessionBlocks(markdown) {
  const regex = /```session\s*([\s\S]*?)```/g
  const blocks = []
  let match
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[1])
  }
  return blocks
}

const OPTION_LABEL_PATTERN = /\boption\s+[a-z0-9]\b/i

/** Detects optional sessions from title/notes text when the JSON predates
 * the explicit `isOptional` field. */
export function inferOptional(title, notes) {
  const haystack = `${title ?? ''} ${notes ?? ''}`
  if (/optional/i.test(haystack)) return true
  return OPTION_LABEL_PATTERN.test(haystack)
}

function toNumberOrNull(v) {
  if (v == null) return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const n = Number(String(v).trim())
  return isNaN(n) ? null : n
}

function toIntOrNull(v) {
  const n = toNumberOrNull(v)
  return n == null ? null : Math.trunc(n)
}

function toStringOrNull(v) {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return null
}

/** Tolerant decode of one raw JSON set object into a SessionSet-shaped
 * object — a value of the "wrong" type just becomes null instead of
 * failing the whole item, matching native's flexible* decode helpers. */
function decodeSet(raw) {
  if (raw == null || typeof raw !== 'object') return null
  return newSet({
    exercise: toStringOrNull(raw.exercise),
    reps: toIntOrNull(raw.reps),
    setsCount: toIntOrNull(raw.setsCount),
    weightKg: toNumberOrNull(raw.weightKg),
    distanceM: toNumberOrNull(raw.distanceM),
    duration: toStringOrNull(raw.duration),
    paceOrPower: toStringOrNull(raw.paceOrPower),
    rest: toStringOrNull(raw.rest),
    notes: toStringOrNull(raw.notes),
    isCompleted: raw.isCompleted === true,
  })
}

/** Parses markdown text against the existing log in memory (no DB access)
 * — pure and unit-testable. Returns the sessions/weekPhases to insert plus
 * an ImportSummary-shaped object. */
export function parseMarkdown(markdown, existingSessions, existingWeekPhases) {
  const blocks = extractSessionBlocks(markdown)
  const summary = { imported: 0, skippedDuplicates: 0, failedItems: [], warnings: [] }
  if (blocks.length === 0) {
    summary.failedItems.push(
      'No ```session blocks found in this text. Make sure the plan was generated with the structured schema.'
    )
    return { newSessions: [], newWeekPhases: [], summary }
  }

  const existingKeys = new Set(existingSessions.map((s) => s.importKey))
  const labelledWeekStarts = new Set(
    existingWeekPhases.map((wp) => toISODateString(startOfWeekMon(new Date(wp.weekStart))))
  )

  const newSessions = []
  const newWeekPhases = []

  for (const block of blocks) {
    let rawJSON
    try {
      rawJSON = JSON.parse(block)
    } catch {
      summary.failedItems.push(`Block is not valid JSON: ${block.slice(0, 60)}…`)
      continue
    }

    const rawItems = Array.isArray(rawJSON) ? rawJSON : [rawJSON]

    for (const rawItem of rawItems) {
      if (rawItem == null || typeof rawItem !== 'object') {
        summary.failedItems.push('Block did not contain a session object.')
        continue
      }

      const title = typeof rawItem.title === 'string' ? rawItem.title : null
      const dateRaw = typeof rawItem.date === 'string' ? rawItem.date : null
      const disciplineRaw = typeof rawItem.discipline === 'string' ? rawItem.discipline : null

      if (!title || !dateRaw || !disciplineRaw) {
        summary.failedItems.push(
          `Could not parse session "${title ?? 'unknown'}" — missing or malformed required field (date/discipline/title).`
        )
        continue
      }

      const date = parseImportDate(dateRaw)
      if (!date) {
        summary.failedItems.push(`Session "${title}" has an unreadable date: ${dateRaw}`)
        continue
      }

      const discipline = normalizeDiscipline(disciplineRaw)
      if (!discipline) {
        summary.warnings.push(`Unrecognized discipline "${disciplineRaw}" on "${title}" — imported under Other.`)
      }

      const notes = toStringOrNull(rawItem.notes) ?? ''
      const sets = Array.isArray(rawItem.sets) ? rawItem.sets.map(decodeSet).filter(Boolean) : []
      const isOptional =
        typeof rawItem.isOptional === 'boolean' ? rawItem.isOptional : inferOptional(title, notes)
      const totalDistance = toNumberOrNull(rawItem.totalDistance)
      const weekLabel = toStringOrNull(rawItem.weekLabel)

      const session = {
        date: date.toISOString(),
        discipline: discipline ?? 'other',
        title,
        notes,
        sets,
        isCompleted: false,
        athleteFeedback: '',
        importedAt: new Date().toISOString(),
        weekLabel,
        isOptional,
        totalDistance,
        importKey: makeImportKey(date, discipline ?? 'other', title),
      }

      // Week-phase, first-write-wins.
      if (rawItem.phase) {
        const weekStart = startOfWeekMon(date)
        const weekKey = toISODateString(weekStart)
        if (!labelledWeekStarts.has(weekKey)) {
          const phase = parsePhase(rawItem.phase)
          if (phase) {
            newWeekPhases.push({ weekStart: weekStart.toISOString(), phase })
            labelledWeekStarts.add(weekKey)
          } else {
            summary.warnings.push(`Unrecognized phase "${rawItem.phase}" on "${title}" — week left as Maintenance.`)
          }
        }
      }

      if (existingKeys.has(session.importKey)) {
        summary.skippedDuplicates += 1
        continue
      }

      newSessions.push(session)
      existingKeys.add(session.importKey)
      summary.imported += 1
    }
  }

  return { newSessions, newWeekPhases, summary }
}

/** Imports markdown text into the live database — reads the current log,
 * parses, then writes the result in one transaction. */
export async function importMarkdown(markdown) {
  const [existingSessions, existingWeekPhases] = await Promise.all([
    db.sessions.toArray(),
    db.weekPhases.toArray(),
  ])
  const { newSessions, newWeekPhases, summary } = parseMarkdown(markdown, existingSessions, existingWeekPhases)

  await db.transaction('rw', db.sessions, db.weekPhases, async () => {
    if (newSessions.length) await db.sessions.bulkAdd(newSessions)
    if (newWeekPhases.length) await db.weekPhases.bulkAdd(newWeekPhases)
  })

  return summary
}

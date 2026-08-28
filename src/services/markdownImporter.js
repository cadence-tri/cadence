import { db } from '../db/db.js'
import { normalizeDiscipline } from '../db/discipline.js'
import { parsePhase } from '../db/phase.js'
import { newSet, makeImportKey } from '../db/session.js'
import { parseImportDate, startOfWeekMon, toISODateString } from './dateUtils.js'
import { validateGeneratedPlan, mergeGeneratedWithSkeleton } from './planning/planValidator.js'

/** Extracts every ```session ... ``` fenced block from markdown text. Falls
 * back to scanning for bare (unfenced) JSON when no fences are found — see
 * `extractBareJsonSessionBlocks`'s doc comment for why that fallback
 * exists. */
export function extractSessionBlocks(markdown) {
  const regex = /```session\s*([\s\S]*?)```/g
  const blocks = []
  let match
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[1])
  }
  if (blocks.length > 0) return blocks
  return extractBareJsonSessionBlocks(markdown)
}

/** Finds the index of the bracket that closes the one at `start` (`[`/`{`
 * at `text[start]`), respecting string literals so brackets inside a
 * quoted value don't throw off the depth count. Returns -1 if unbalanced. */
function findMatchingBracket(text, start) {
  const open = text[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Whether parsed JSON is plausibly session data — an array of (or a
 * single) object(s) each carrying the three required string fields a real
 * session always has. Used to tell an actual session block apart from
 * unrelated bracketed text that happens to be valid JSON. */
function looksLikeSessionData(parsed) {
  const items = Array.isArray(parsed) ? parsed : [parsed]
  if (items.length === 0) return false
  return items.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof item.date === 'string' &&
      typeof item.discipline === 'string' &&
      typeof item.title === 'string'
  )
}

/** Some chat clients strip code-fence markup when their reply is copied
 * out (observed specifically copying from a logged-out ChatGPT session in
 * Safari, though the exact cause is client-side rendering/copy behavior
 * we don't control) — the fences render as UI chrome around a syntax-
 * highlighted block rather than literal selectable text, so a manual
 * copy grabs the JSON but not the ```session markers around it. Rather
 * than depend on those markers surviving every chat UI's copy behavior,
 * this scans the raw text for balanced [...]/{...} groups and keeps any
 * that parse as valid JSON shaped like session data, wherever they land
 * in the pasted text. */
function extractBareJsonSessionBlocks(text) {
  const blocks = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '[' || ch === '{') {
      const end = findMatchingBracket(text, i)
      if (end === -1) {
        i++
        continue
      }
      const candidate = text.slice(i, end + 1)
      try {
        const parsed = JSON.parse(candidate)
        if (looksLikeSessionData(parsed)) blocks.push(candidate)
      } catch {
        // Not valid JSON — just some other bracketed text, ignore it.
      }
      i = end + 1
      continue
    }
    i++
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
      "No training sessions found in this text. Make sure you pasted your coach's entire reply, including the JSON — it's fine if the ```session code-block formatting got stripped along the way (e.g. by some chat apps' copy behavior), the important part is that the JSON with each session's date/discipline/title is included somewhere in the pasted text."
    )
    return { newSessions: [], newWeekPhases: [], summary }
  }

  const existingKeys = new Set(existingSessions.map((s) => s.importKey))
  const labelledWeekStarts = new Set(
    existingWeekPhases.map((wp) => toISODateString(startOfWeekMon(new Date(wp.weekStart))))
  )

  const newSessions = []
  const decodedSessions = []
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
      const skeletonId = toStringOrNull(rawItem.skeletonId)
      const skeletonRole = toStringOrNull(rawItem.skeletonRole)
      const brickTargets = rawItem.brickTargets && typeof rawItem.brickTargets === 'object' ? rawItem.brickTargets : null

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
        ...(skeletonId ? { skeletonId } : {}),
        ...(skeletonRole ? { skeletonRole } : {}),
        ...(brickTargets ? { brickTargets } : {}),
      }

      decodedSessions.push(session)

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

  return { newSessions, decodedSessions, newWeekPhases, summary }
}

/** Imports markdown text into the live database — reads the current log,
 * parses, then writes the result in one transaction. */
export async function importMarkdown(markdown, options = {}) {
  const [existingSessions, existingWeekPhases] = await Promise.all([
    db.sessions.toArray(),
    db.weekPhases.toArray(),
  ])
  let { newSessions, decodedSessions, newWeekPhases, summary } = parseMarkdown(markdown, existingSessions, existingWeekPhases)

  if (options.skeleton) {
    const validation = validateGeneratedPlan({ skeleton: options.skeleton, sessions: decodedSessions })
    if (validation.errors.length) {
      const error = new Error(`Cadence found problems in the generated plan:\n${validation.errors.map((x) => `• ${x}`).join('\n')}`)
      error.validation = validation
      throw error
    }
    newSessions = mergeGeneratedWithSkeleton({ skeleton: options.skeleton, sessions: newSessions }).map((session) => {
      const { skeletonId: _validatedSkeletonId, skeletonRole: _validatedSkeletonRole, brickTargets: _validatedBrickTargets, ...storedSession } = session
      return {
        ...storedSession,
        importKey: makeImportKey(storedSession.date, storedSession.discipline, storedSession.title),
      }
    })
    const phases = new Map()
    for (const week of options.skeleton.weeks ?? []) {
      phases.set(week.weekStart, { weekStart: new Date(`${week.weekStart}T00:00:00`).toISOString(), phase: week.phase })
    }
    newWeekPhases = [...phases.values()].filter((wp) => !existingWeekPhases.some((existing) => toISODateString(startOfWeekMon(new Date(existing.weekStart))) === wp.weekStart.slice(0, 10)))
    summary.validation = validation
  }

  await db.transaction('rw', db.sessions, db.weekPhases, async () => {
    if (newSessions.length) await db.sessions.bulkAdd(newSessions)
    if (newWeekPhases.length) await db.weekPhases.bulkAdd(newWeekPhases)
  })

  return summary
}

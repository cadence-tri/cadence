import { asDate, startOfDay, addDays } from './dateUtils'

/** The last date covered by whatever is currently imported. `null` if
 * nothing has ever been imported. */
export function currentBlockEnd(sessions) {
  if (sessions.length === 0) return null
  return sessions.reduce((max, s) => {
    const d = startOfDay(asDate(s.date))
    return !max || d > max ? d : max
  }, null)
}

/** True once we're within `leadDays` of the current block's last date, or
 * past it. Date-based, not completion-based (see native's doc comment on
 * `needsNextBlockPrompt`). */
export function needsNextBlockPrompt(sessions, leadDays = 2, today = new Date()) {
  const blockEnd = currentBlockEnd(sessions)
  if (!blockEnd) return false
  const days = Math.round((blockEnd - startOfDay(today)) / 86400000)
  return days <= leadDays
}

/** The most recently completed 14-day block, for sending back to the LLM
 * as check-in context. */
export function mostRecentBlock(sessions) {
  const end = currentBlockEnd(sessions)
  if (!end) return []
  const start = addDays(end, -13)
  return sessions
    .filter((s) => {
      const d = asDate(s.date)
      return d >= start && d <= end
    })
    .sort((a, b) => asDate(a.date) - asDate(b.date))
}

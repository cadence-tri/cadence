import { format } from 'date-fns'
import { countsTowardStats, completionFraction, isFullyCompleted } from '../db/session'

/** "Tuesday, Jul 14 — 2/3 done" row shown above a day's sessions. */
export default function DayHeaderRow({ date, sessions }) {
  const counted = sessions.filter(countsTowardStats)
  const totalFraction = counted.reduce((sum, s) => sum + completionFraction(s), 0)
  const fullyDone = counted.filter(isFullyCompleted).length
  const allDone = counted.length > 0 && totalFraction >= counted.length

  return (
    <div className="flex items-center justify-between pt-1.5">
      <span className="text-sm font-semibold text-main-text">{format(date, 'EEEE, MMM d')}</span>
      <span className={`text-xs ${allDone ? 'text-green-600' : 'text-minor-text'}`}>
        {fullyDone}/{counted.length} done
      </span>
    </div>
  )
}

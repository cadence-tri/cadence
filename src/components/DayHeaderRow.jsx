import { format } from 'date-fns'
import { countsTowardStats, completionFraction, isFullyCompleted } from '../db/session'
import { isToday } from '../services/dateUtils'

/** "Tuesday, Jul 14 — 2/3 done" row shown above a day's sessions. */
export default function DayHeaderRow({ date, sessions }) {
  const counted = sessions.filter(countsTowardStats)
  const totalFraction = counted.reduce((sum, s) => sum + completionFraction(s), 0)
  const fullyDone = counted.filter(isFullyCompleted).length
  const allDone = counted.length > 0 && totalFraction >= counted.length

  return (
    <div className="flex items-center justify-between pt-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold text-main-text truncate">{format(date, 'EEEE, MMM d')}</span>
        {isToday(date) && (
          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Today
          </span>
        )}
      </div>
      <span className={`text-xs ${allDone ? 'text-green-600' : 'text-minor-text'}`}>
        {fullyDone}/{counted.length} done
      </span>
    </div>
  )
}

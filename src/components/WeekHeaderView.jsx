import { phaseDisplayName, phaseColor } from '../db/phase'
import { formatWeekHeaderLabel } from '../services/dateUtils'

/** Section header shown once per week in "Upcoming" — date range plus the
 * scheduler-owned phase badge. The phase is intentionally read-only: the
 * deterministic plan generator is authoritative for macrocycle structure. */
export default function WeekHeaderView({ weekStart, phase }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm font-bold text-main-text">{formatWeekHeaderLabel(weekStart)}</span>
      <span
        className="px-2 py-1 rounded-full text-xs font-semibold"
        style={{ color: phaseColor(phase), backgroundColor: `color-mix(in srgb, ${phaseColor(phase)} 15%, transparent)` }}
      >
        {phaseDisplayName(phase)}
      </span>
    </div>
  )
}

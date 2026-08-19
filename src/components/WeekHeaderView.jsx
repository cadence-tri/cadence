import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { PHASES, phaseDisplayName, phaseColor } from '../db/phase'
import { formatWeekHeaderLabel } from '../services/dateUtils'

/** Section header shown once per week in "Upcoming" — date range plus an
 * editable phase badge. Ported from DailyView.swift's `WeekHeaderView`. */
export default function WeekHeaderView({ weekStart, phase, onPhaseChange }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center justify-between py-1 relative">
      <span className="text-sm font-bold text-main-text">{formatWeekHeaderLabel(weekStart)}</span>
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold"
          style={{ color: phaseColor(phase), backgroundColor: `color-mix(in srgb, ${phaseColor(phase)} 15%, transparent)` }}
        >
          {phaseDisplayName(phase)}
          <ChevronDown size={11} strokeWidth={3} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-20 bg-background rounded-xl shadow-lg py-1 min-w-[160px]">
              {PHASES.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    onPhaseChange(p)
                    setOpen(false)
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-panel ${
                    p === phase ? 'font-semibold text-accent' : 'text-main-text'
                  }`}
                >
                  {phaseDisplayName(p)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

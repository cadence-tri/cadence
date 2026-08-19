import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import Sheet from './Sheet'
import { toISODateString } from '../services/dateUtils'

/** Jump-to-week sheet — a native date input (bounded to the selectable
 * range) plus a "This Week" shortcut. Simpler than the native app's
 * graphical calendar, same result: pick any day, land on its week. */
export default function WeekPickerSheet({ initialDate, earliestSelectableDate, latestSelectableDate, onSelectDate, onSelectThisWeek, onClose }) {
  const [picked, setPicked] = useState(toISODateString(initialDate))

  return (
    <Sheet title="Jump to Week" onClose={onClose}>
      <div className="p-4 flex flex-col gap-5">
        <button
          onClick={() => {
            onSelectThisWeek()
            onClose()
          }}
          className="w-full py-2.5 rounded-xl bg-accent/12 text-accent font-semibold text-sm flex items-center justify-center gap-2"
        >
          <CalendarClock size={16} /> This Week
        </button>

        <div>
          <label className="text-xs text-minor-text block mb-1.5">Jump to a week</label>
          <input
            type="date"
            value={picked}
            min={toISODateString(earliestSelectableDate)}
            max={toISODateString(latestSelectableDate)}
            onChange={(e) => {
              setPicked(e.target.value)
              const [y, m, d] = e.target.value.split('-').map(Number)
              onSelectDate(new Date(y, m - 1, d))
              onClose()
            }}
            className="w-full p-3 rounded-xl bg-panel text-main-text border-none outline-none"
          />
        </div>
      </div>
    </Sheet>
  )
}

import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { addDays, isSameDay, isToday, formatWeekRange } from '../services/dateUtils'
import { disciplineColor } from '../db/discipline'
import { countsTowardStats, isFullyCompleted } from '../db/session'
import { disciplineDisplayName } from '../db/discipline'
import DayHeaderRow from './DayHeaderRow'
import SessionRow from './SessionRow'

export const OVERVIEW_CARD_MIN_HEIGHT = 168

function daySlices(weekStart, sessions) {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(weekStart, offset)
    const daySessions = sessions
      .filter((s) => isSameDay(new Date(s.date), date))
      .sort((a, b) => a.discipline.localeCompare(b.discipline))
    return { date, sessions: daySessions }
  })
}

function DayColumn({ day, selected, onSelect }) {
  const grayedOut = day.sessions.length === 0 || day.sessions.every((s) => s.discipline === 'rest' || s.isOptional)
  const today = isToday(day.date)

  return (
    <button onClick={onSelect} className="flex-1 flex flex-col items-center gap-1.5 py-1">
      <span className={`text-[11px] font-semibold ${grayedOut ? 'text-minor-text/60' : 'text-minor-text'}`}>
        {day.date.toLocaleDateString(undefined, { weekday: 'narrow' })}
      </span>
      <span
        className={`w-[26px] h-[26px] flex items-center justify-center rounded-full text-sm ${
          today || selected ? 'font-bold' : ''
        } ${
          selected
            ? 'bg-accent text-white'
            : today
              ? 'bg-accent/15 text-main-text'
              : grayedOut
                ? 'text-minor-text/60'
                : 'text-main-text'
        }`}
      >
        {day.date.getDate()}
      </span>
      <div className="flex gap-0.5 h-1.5 items-center">
        {day.sessions.length === 0 ? (
          <span className="w-1.5 h-1.5 rounded-full bg-minor-text/25" />
        ) : (
          day.sessions.slice(0, 4).map((s, i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor:
                  s.isOptional || s.discipline === 'rest' ? 'var(--color-minor-text)' : disciplineColor(s.discipline),
                opacity: s.isOptional || s.discipline === 'rest' ? 0.35 : 1,
              }}
            />
          ))
        )}
      </div>
    </button>
  )
}

/** "Week at a glance" card — date range, summary line, and a 7-day dot
 * row. Ported from WeekGlanceCard.swift. */
export default function WeekGlanceCard({
  weekStart,
  sessions,
  selectedDate,
  onSelectDate,
  onPrevWeek,
  onNextWeek,
  canGoPrev = true,
  canGoNext = true,
  onTapLabel,
}) {
  const days = daySlices(weekStart, sessions)
  const weekSessions = days.flatMap((d) => d.sessions)
  const isBrowsable = !!(onPrevWeek || onNextWeek)

  const summaryLine = (() => {
    if (weekSessions.length === 0) {
      return isBrowsable ? 'No sessions logged this week.' : 'No sessions scheduled this week.'
    }
    const counted = weekSessions.filter(countsTowardStats)
    const done = counted.filter(isFullyCompleted).length
    const disciplines = [...new Set(weekSessions.filter((s) => s.discipline !== 'rest').map((s) => disciplineDisplayName(s.discipline)))]
    if (disciplines.length === 0) return `Rest week — ${done}/${counted.length} done.`
    return `${done}/${counted.length} done · ${disciplines.sort().join(', ')}`
  })()

  return (
    <div className="p-4 bg-panel rounded-2xl" style={{ minHeight: OVERVIEW_CARD_MIN_HEIGHT }}>
      <div className="flex items-center justify-between mb-3">
        {isBrowsable && (
          <button onClick={onPrevWeek} disabled={!canGoPrev} className="w-6 h-6 flex items-center justify-center">
            <ChevronLeft size={16} className={canGoPrev ? 'text-main-text' : 'text-minor-text/30'} strokeWidth={2.5} />
          </button>
        )}
        <button
          onClick={onTapLabel}
          disabled={!onTapLabel}
          className={`flex-1 flex items-center justify-center gap-1 ${isBrowsable ? '' : 'justify-start'}`}
        >
          <span className="text-sm font-bold text-main-text">{formatWeekRange(weekStart)}</span>
          {onTapLabel && <ChevronDown size={12} className="text-minor-text" strokeWidth={2.5} />}
        </button>
        {isBrowsable && (
          <button onClick={onNextWeek} disabled={!canGoNext} className="w-6 h-6 flex items-center justify-center">
            <ChevronRight
              size={16}
              className={canGoNext ? 'text-main-text' : 'text-minor-text/30'}
              strokeWidth={2.5}
            />
          </button>
        )}
      </div>
      <div className="text-xs text-minor-text mb-3">{summaryLine}</div>
      <div className="flex">
        {days.map((day) => (
          <DayColumn
            key={day.date.toISOString()}
            day={day}
            selected={isSameDay(day.date, selectedDate)}
            onSelect={() => onSelectDate(day.date)}
          />
        ))}
      </div>
    </div>
  )
}

/** Detail card for the selected day — same header/row presentation used
 * across Overview and Training Log. */
export function SelectedDayCard({ date, sessions, onTapSession, onToggleSession }) {
  return (
    <div className="p-4 bg-panel rounded-2xl">
      <DayHeaderRow date={date} sessions={sessions} />
      {sessions.length === 0 ? (
        <div className="text-sm text-minor-text py-2">Nothing scheduled.</div>
      ) : (
        <div className="divide-y divide-minor-text/15">
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} onTap={onTapSession} onToggle={onToggleSession} />
          ))}
        </div>
      )}
    </div>
  )
}

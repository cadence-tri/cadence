import { useState, useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import ProfileHeaderBar from '../components/ProfileHeaderBar'
import WeekGlanceCard, { SelectedDayCard } from '../components/WeekGlanceCard'
import WeekHeaderView from '../components/WeekHeaderView'
import DayHeaderRow from '../components/DayHeaderRow'
import SessionRow from '../components/SessionRow'
import WeekPickerSheet from '../components/WeekPickerSheet'
import OverviewScreen from './OverviewScreen'
import { weekStreak } from '../db/session'
import { startOfDay, startOfWeekMon, addWeeks, addDays, isSameDay, asDate } from '../services/dateUtils'

const FILTERS = ['Overview', 'Upcoming', 'Training Log']

export default function DailyScreen({ profile, onOpenSession, onOpenProfile, onOpenWizard }) {
  const [filter, setFilter] = useState('Overview')
  const [showingWeekPicker, setShowingWeekPicker] = useState(false)

  const allSessions = useLiveQuery(() => db.sessions.orderBy('date').toArray(), [], [])
  const weekPhases = useLiveQuery(() => db.weekPhases.toArray(), [], [])

  const yesterday = addDays(startOfDay(new Date()), -1)
  const [trainingLogWeekStart, setTrainingLogWeekStart] = useState(startOfWeekMon(yesterday))
  const [trainingLogSelectedDate, setTrainingLogSelectedDate] = useState(yesterday)

  const currentWeekStartISO = startOfWeekMon(new Date())

  const earliestSessionWeekStart = useMemo(() => {
    if (!allSessions.length) return null
    const earliest = allSessions.reduce((min, s) => (asDate(s.date) < min ? asDate(s.date) : min), asDate(allSessions[0].date))
    return startOfWeekMon(earliest)
  }, [allSessions])

  const canGoPrev = earliestSessionWeekStart ? trainingLogWeekStart > earliestSessionWeekStart : false
  const canGoNext = trainingLogWeekStart < currentWeekStartISO

  const stepWeek = (delta) => {
    const dayOffset = Math.round((trainingLogSelectedDate - trainingLogWeekStart) / 86400000)
    const newStart = addWeeks(trainingLogWeekStart, delta)
    setTrainingLogWeekStart(newStart)
    setTrainingLogSelectedDate(addDays(newStart, dayOffset))
  }

  const trainingLogSelectedDaySessions = allSessions
    .filter((s) => isSameDay(new Date(s.date), trainingLogSelectedDate))
    .sort((a, b) => a.discipline.localeCompare(b.discipline))

  const toggleSession = async (updated) => {
    await db.sessions.update(updated.id, updated)
  }

  const deleteSession = async (id) => {
    await db.sessions.delete(id)
  }

  const setPhase = async (weekStart, phase) => {
    const existing = weekPhases.find((wp) => isSameDay(asDate(wp.weekStart), weekStart))
    if (existing) {
      await db.weekPhases.update(existing.id, { phase })
    } else {
      await db.weekPhases.add({ weekStart: weekStart.toISOString(), phase })
    }
  }

  const phaseForWeek = (weekStart) => {
    const row = weekPhases.find((wp) => isSameDay(asDate(wp.weekStart), weekStart))
    return row?.phase ?? 'maintenance'
  }

  // Group "Upcoming" sessions (today forward) by week, then by day.
  const groupedByWeek = useMemo(() => {
    if (filter !== 'Upcoming') return []
    const today = startOfDay(new Date())
    const upcoming = allSessions.filter((s) => asDate(s.date) >= today)
    const weekBuckets = new Map()
    for (const s of upcoming) {
      const weekStart = startOfWeekMon(asDate(s.date))
      const key = weekStart.getTime()
      if (!weekBuckets.has(key)) weekBuckets.set(key, { weekStart, sessions: [] })
      weekBuckets.get(key).sessions.push(s)
    }
    return [...weekBuckets.values()]
      .sort((a, b) => a.weekStart - b.weekStart)
      .map(({ weekStart, sessions }) => {
        const dayBuckets = new Map()
        for (const s of sessions) {
          const day = startOfDay(asDate(s.date))
          const key = day.getTime()
          if (!dayBuckets.has(key)) dayBuckets.set(key, { date: day, sessions: [] })
          dayBuckets.get(key).sessions.push(s)
        }
        const days = [...dayBuckets.values()]
          .sort((a, b) => a.date - b.date)
          .map((d) => ({ ...d, sessions: d.sessions.sort((a, b) => a.discipline.localeCompare(b.discipline)) }))
        return { weekStart, days }
      })
  }, [filter, allSessions])

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-2 pb-1 shrink-0">
        <ProfileHeaderBar profile={profile} weekStreak={weekStreak(allSessions)} onTap={onOpenProfile} />
      </div>

      <div className="px-4 py-3 shrink-0">
        <div className="grid grid-cols-3 gap-1 bg-panel rounded-xl p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`py-1.5 rounded-lg text-xs font-semibold ${
                filter === f ? 'bg-accent text-white' : 'text-main-text'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filter === 'Overview' && (
          <OverviewScreen
            profile={profile}
            allSessions={allSessions}
            weekPhases={weekPhases}
            onOpenSession={onOpenSession}
            onOpenProfile={onOpenProfile}
            onOpenWizard={onOpenWizard}
          />
        )}

        {filter === 'Training Log' && (
          <div className="flex flex-col gap-4 p-4 pb-8">
            <WeekGlanceCard
              weekStart={trainingLogWeekStart}
              sessions={allSessions}
              selectedDate={trainingLogSelectedDate}
              onSelectDate={setTrainingLogSelectedDate}
              onPrevWeek={() => stepWeek(-1)}
              onNextWeek={() => stepWeek(1)}
              canGoPrev={canGoPrev}
              canGoNext={canGoNext}
              onTapLabel={() => setShowingWeekPicker(true)}
            />
            <SelectedDayCard
              date={trainingLogSelectedDate}
              sessions={trainingLogSelectedDaySessions}
              onTapSession={onOpenSession}
              onToggleSession={toggleSession}
            />
          </div>
        )}

        {filter === 'Upcoming' && (
          <div className="pb-8">
            {groupedByWeek.length === 0 ? (
              <div className="text-center text-sm text-minor-text py-16 px-6">
                No sessions. Import a training plan to see your schedule here.
              </div>
            ) : (
              groupedByWeek.map((week) => (
                <div key={week.weekStart.toISOString()} className="px-4 mb-2">
                  <WeekHeaderView
                    weekStart={week.weekStart}
                    phase={phaseForWeek(week.weekStart)}
                    onPhaseChange={(p) => setPhase(week.weekStart, p)}
                  />
                  {week.days.map((day) => (
                    <div key={day.date.toISOString()}>
                      <DayHeaderRow date={day.date} sessions={day.sessions} />
                      {day.sessions.map((s) => (
                        <div key={s.id} className="flex items-center gap-1 bg-panel rounded-xl px-3 my-1">
                          <div className="flex-1">
                            <SessionRow session={s} onTap={onOpenSession} onToggle={toggleSession} />
                          </div>
                          <button
                            onClick={() => deleteSession(s.id)}
                            className="text-minor-text hover:text-red-500 p-2 shrink-0"
                            aria-label="Delete session"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {showingWeekPicker && (
        <WeekPickerSheet
          initialDate={trainingLogSelectedDate}
          earliestSelectableDate={earliestSessionWeekStart ?? addWeeks(startOfDay(new Date()), -52)}
          latestSelectableDate={startOfDay(new Date())}
          onSelectDate={(d) => {
            const day = startOfDay(d)
            setTrainingLogWeekStart(startOfWeekMon(day))
            setTrainingLogSelectedDate(day)
          }}
          onSelectThisWeek={() => {
            setTrainingLogWeekStart(currentWeekStartISO)
            setTrainingLogSelectedDate(startOfDay(new Date()))
          }}
          onClose={() => setShowingWeekPicker(false)}
        />
      )}
    </div>
  )
}

import { useState } from 'react'
import { Wand2, TriangleAlert, ChevronRight } from 'lucide-react'
import WeekGlanceCard, { SelectedDayCard } from '../components/WeekGlanceCard'
import RoadToRaceCard from '../components/RoadToRaceCard'
import { startOfDay, startOfWeekMon, isSameDay } from '../services/dateUtils'
import { needsRecoveryWeekWarning } from '../db/weekPhase'
import { needsNextBlockPrompt } from '../services/planBlockTrigger'
import { db } from '../db/db'

function NoPlanBanner({ onClick }) {
  return (
    <button onClick={onClick} className="w-full p-4 rounded-2xl bg-accent/12 flex items-start gap-2.5 text-left">
      <Wand2 size={18} className="text-accent shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="text-sm font-bold text-main-text">No training plan yet</div>
        <div className="text-xs text-minor-text">Tap to set up your first 2-week block and get started.</div>
      </div>
      <ChevronRight size={14} className="text-minor-text shrink-0 mt-1" />
    </button>
  )
}

function NextBlockPromptBanner({ onClick }) {
  return (
    <button onClick={onClick} className="w-full p-4 rounded-2xl bg-accent/12 flex items-start gap-2.5 text-left">
      <Wand2 size={18} className="text-accent shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="text-sm font-bold text-main-text">Your current block is wrapping up</div>
        <div className="text-xs text-minor-text">Tap to check in and generate the next 2 weeks.</div>
      </div>
      <ChevronRight size={14} className="text-minor-text shrink-0 mt-1" />
    </button>
  )
}

function RecoveryWeekWarningBanner() {
  return (
    <div className="w-full p-4 rounded-2xl bg-accent/12 flex items-start gap-2.5">
      <TriangleAlert size={18} className="text-accent shrink-0 mt-0.5" />
      <p className="text-sm text-main-text">
        No Maintenance, Recovery, or Taper week in the last 14 weeks. Consider scheduling one or two easier weeks
        soon.
      </p>
    </div>
  )
}

export default function OverviewScreen({ profile, allSessions, weekPhases, onOpenSession, onOpenProfile, onOpenWizard }) {
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()))
  const currentWeekStart = startOfWeekMon(new Date())

  const selectedDaySessions = allSessions
    .filter((s) => isSameDay(new Date(s.date), selectedDate))
    .sort((a, b) => a.discipline.localeCompare(b.discipline))

  const toggleSession = async (updated) => {
    await db.sessions.update(updated.id, updated)
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-8">
      {allSessions.length === 0 ? (
        <NoPlanBanner onClick={onOpenWizard} />
      ) : (
        needsNextBlockPrompt(allSessions) && <NextBlockPromptBanner onClick={onOpenWizard} />
      )}
      {needsRecoveryWeekWarning(weekPhases, allSessions) && <RecoveryWeekWarningBanner />}
      <WeekGlanceCard weekStart={currentWeekStart} sessions={allSessions} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      <SelectedDayCard
        date={selectedDate}
        sessions={selectedDaySessions}
        onTapSession={onOpenSession}
        onToggleSession={toggleSession}
      />
      <RoadToRaceCard profile={profile} sessions={allSessions} weekPhases={weekPhases} onOpenProfile={onOpenProfile} />
    </div>
  )
}

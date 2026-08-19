import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Calendar, ChartLine, UploadCloud } from 'lucide-react'
import { db, PROFILE_ID } from './db/db'
import SplashScreen from './screens/SplashScreen'
import LoginScreen from './screens/LoginScreen'
import DailyScreen from './screens/DailyScreen'
import StatsScreen from './screens/StatsScreen'
import ImportScreen from './screens/ImportScreen'
import SessionDetailSheet from './components/SessionDetailSheet'
import ManualEntrySheet from './components/ManualEntrySheet'
import ProfileSheet from './components/ProfileSheet'
import PlanGenerationWizardSheet from './components/PlanGenerationWizardSheet'

const TABS = [
  { id: 'daily', label: 'Daily', icon: Calendar },
  { id: 'stats', label: 'Stats', icon: ChartLine },
  { id: 'import', label: 'Import', icon: UploadCloud },
]

function MainTabView({ profile }) {
  const [tab, setTab] = useState('daily')
  const [selectedSession, setSelectedSession] = useState(null)
  const [showingProfile, setShowingProfile] = useState(false)
  const [showingManualEntry, setShowingManualEntry] = useState(false)
  const [showingWizard, setShowingWizard] = useState(false)

  const allSessions = useLiveQuery(() => db.sessions.orderBy('date').toArray(), [], [])
  const weekPhases = useLiveQuery(() => db.weekPhases.toArray(), [], [])

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'daily' && (
          <DailyScreen
            profile={profile}
            onOpenSession={setSelectedSession}
            onOpenProfile={() => setShowingProfile(true)}
            onOpenWizard={() => setShowingWizard(true)}
          />
        )}
        {tab === 'stats' && (
          <div className="h-full overflow-y-auto">
            <StatsScreen />
          </div>
        )}
        {tab === 'import' && (
          <div className="h-full overflow-y-auto">
            <ImportScreen
              profile={profile}
              onOpenManualEntry={() => setShowingManualEntry(true)}
              onOpenWizard={() => setShowingWizard(true)}
            />
          </div>
        )}
      </div>

      <nav className="shrink-0 border-t border-minor-text/15 bg-background flex pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5"
          >
            <Icon size={22} className={tab === id ? 'text-accent' : 'text-minor-text'} strokeWidth={tab === id ? 2.5 : 2} />
            <span className={`text-[10px] font-medium ${tab === id ? 'text-accent' : 'text-minor-text'}`}>{label}</span>
          </button>
        ))}
      </nav>

      {selectedSession && <SessionDetailSheet session={selectedSession} onClose={() => setSelectedSession(null)} />}
      {showingProfile && <ProfileSheet profile={profile} allSessions={allSessions} onClose={() => setShowingProfile(false)} />}
      {showingManualEntry && <ManualEntrySheet onClose={() => setShowingManualEntry(false)} />}
      {showingWizard && (
        <PlanGenerationWizardSheet
          profile={profile}
          allSessions={allSessions}
          weekPhases={weekPhases}
          onClose={() => setShowingWizard(false)}
        />
      )}
    </div>
  )
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true)
  // useLiveQuery returns `undefined` while the first query is still in
  // flight — but a fresh install's query also legitimately resolves to
  // "no profile yet". Wrapping the result disambiguates those two states:
  // `result === undefined` means "still loading", `result.profile === null`
  // means "loaded, no profile exists" (show LoginScreen).
  const result = useLiveQuery(async () => ({ profile: (await db.profile.get(PROFILE_ID)) ?? null }))

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 900)
    return () => clearTimeout(t)
  }, [])

  if (showSplash || result === undefined) return <SplashScreen />

  return (
    <div className="h-[100dvh] w-full max-w-lg mx-auto bg-background">
      {result.profile ? <MainTabView profile={result.profile} /> : <LoginScreen />}
    </div>
  )
}

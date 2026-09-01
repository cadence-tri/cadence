import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LabelList, LineChart, Line, Tooltip, Cell } from 'recharts'
import { ChevronDown } from 'lucide-react'
import { db } from '../db/db'
import { DISCIPLINES, disciplineDisplayName, disciplineColor } from '../db/discipline'
import { PHASES, phaseDisplayName, phaseColor } from '../db/phase'
import { phaseForDate } from '../db/weekPhase'
import { countsTowardStats, isFullyCompleted, derivedDistanceKm, durationMinutes } from '../db/session'
import { asDate } from '../services/dateUtils'
import { chartUpperBound, formatAxisTick, formatVolumeLabel, weeklyBuckets } from '../services/statsChart'
import { format } from 'date-fns'

function VolumeBarLabel({ x, y, width, value, unit }) {
  if (![x, y, width, value].every(Number.isFinite)) return null
  return (
    <text
      x={x + width / 2}
      y={Math.max(11, y - 6)}
      textAnchor="middle"
      fontSize={10}
      fill="var(--color-minor-text)"
    >
      {formatVolumeLabel(value, unit)}
    </text>
  )
}

function DisciplinePanel({ discipline, sessions }) {
  const distancePoints = weeklyBuckets(
    sessions.filter((s) => s.discipline === discipline && countsTowardStats(s) && isFullyCompleted(s)),
    (s) => derivedDistanceKm(s)
  )
  const hasDistance = distancePoints.some((p) => p.value > 0)
  const points = hasDistance
    ? distancePoints
    : weeklyBuckets(
        sessions.filter((s) => s.discipline === discipline && countsTowardStats(s)),
        (s) => s.sets?.filter((set) => set.isCompleted).reduce((sum, set) => sum + (durationMinutes(set) ?? 0), 0)
      )
  const unit = hasDistance ? 'km' : 'min'
  if (points.length === 0) return null

  return (
    <div className="p-4 bg-panel rounded-xl">
      <div className="text-sm font-semibold text-main-text mb-2">
        {disciplineDisplayName(discipline)} — weekly {hasDistance ? 'distance' : 'time'}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={points} margin={{ top: 20, right: 8, left: -20, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-minor-text)' }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, chartUpperBound]} tickCount={5} tickFormatter={formatAxisTick} tick={{ fontSize: 10, fill: 'var(--color-minor-text)' }} axisLine={false} tickLine={false} />
          <Bar dataKey="value" fill={disciplineColor(discipline)} radius={[4, 4, 0, 0]}>
            <LabelList
              dataKey="value"
              content={(props) => <VolumeBarLabel {...props} unit={unit} />}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function GymWeeklyPanel({ sessions }) {
  const points = weeklyBuckets(
    sessions.filter((s) => s.discipline === 'gym' && isFullyCompleted(s)),
    () => 1
  )
  if (points.length === 0) return null
  return (
    <div className="p-4 bg-panel rounded-xl">
      <div className="text-sm font-semibold text-main-text mb-2">Gym — completed sessions per week</div>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={points} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-minor-text)' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={formatAxisTick} tick={{ fontSize: 10, fill: 'var(--color-minor-text)' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Bar dataKey="value" fill={disciplineColor('gym')} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function CompletionSection({ sessions }) {
  const data = DISCIPLINES.map((d) => {
    const matching = sessions.filter((s) => s.discipline === d && countsTowardStats(s))
    if (matching.length === 0) return null
    const completed = matching.filter(isFullyCompleted).length
    return {
      discipline: d,
      label: disciplineDisplayName(d),
      completed,
      total: matching.length,
      rate: completed / matching.length,
      fraction: `${completed}/${matching.length}`,
    }
  }).filter(Boolean)

  if (data.length === 0) return null

  return (
    <div className="p-4 bg-panel rounded-xl">
      <div className="text-sm font-semibold text-main-text mb-2">Completion rate</div>
      <ResponsiveContainer width="100%" height={data.length * 40 + 20}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
          <XAxis type="number" domain={[0, 1.2]} hide />
          <YAxis dataKey="label" type="category" tick={{ fontSize: 12, fill: 'var(--color-main-text)' }} axisLine={false} tickLine={false} width={50} />
          <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell key={d.discipline} fill={disciplineColor(d.discipline)} />
            ))}
            <LabelList dataKey="fraction" position="right" style={{ fontSize: 11, fill: 'var(--color-minor-text)' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function GymProgressionSection({ sessions }) {
  const exerciseNames = useMemo(() => {
    const names = new Set()
    for (const s of sessions) {
      if (s.discipline !== 'gym') continue
      for (const set of s.sets ?? []) {
        if (set.exercise && set.weightKg != null) names.add(set.exercise)
      }
    }
    return [...names].sort()
  }, [sessions])

  const [selected, setSelected] = useState('')
  const activeExercise = exerciseNames.includes(selected) ? selected : exerciseNames[0] ?? ''

  const points = useMemo(() => {
    if (!activeExercise) return []
    const pts = []
    for (const s of sessions) {
      if (s.discipline !== 'gym') continue
      const weights = (s.sets ?? [])
        .filter((set) => set.exercise === activeExercise)
        .map((set) => set.weightKg)
        .filter((w) => w != null)
      if (weights.length) {
        const maxWeight = Math.max(...weights)
        pts.push({ date: asDate(s.date), weightKg: maxWeight, label: format(asDate(s.date), 'd MMM') })
      }
    }
    return pts.sort((a, b) => a.date - b.date)
  }, [sessions, activeExercise])

  if (exerciseNames.length === 0) return null

  return (
    <div className="p-4 bg-panel rounded-xl">
      <div className="text-base font-bold text-main-text mb-3">Gym exercise progression</div>
      <select
        value={activeExercise}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full p-2.5 rounded-lg bg-background text-main-text mb-3 outline-none"
      >
        {exerciseNames.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      {points.length === 0 ? (
        <p className="text-xs text-minor-text">No weighted sets logged yet for this exercise.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={points} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-minor-text)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={formatAxisTick} tick={{ fontSize: 10, fill: 'var(--color-minor-text)' }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Line type="monotone" dataKey="weightKg" stroke={disciplineColor('gym')} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export default function StatsScreen() {
  const allSessions = useLiveQuery(() => db.sessions.orderBy('date').toArray(), [], [])
  const weekPhases = useLiveQuery(() => db.weekPhases.toArray(), [], [])
  const [phaseFilter, setPhaseFilter] = useState(null)
  const [showFilterMenu, setShowFilterMenu] = useState(false)

  const sessions = useMemo(() => {
    if (!phaseFilter) return allSessions
    return allSessions.filter((s) => phaseForDate(weekPhases, asDate(s.date)) === phaseFilter)
  }, [allSessions, weekPhases, phaseFilter])

  if (allSessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-2">
        <p className="text-main-text font-semibold">No data yet</p>
        <p className="text-sm text-minor-text">Import a plan and start flagging sessions to see stats.</p>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-5 pb-10">
      <div className="relative self-start">
        <button
          onClick={() => setShowFilterMenu((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-panel text-sm font-semibold"
          style={{ color: phaseFilter ? phaseColor(phaseFilter) : 'var(--color-main-text)' }}
        >
          {phaseFilter ? phaseDisplayName(phaseFilter) : 'All Phases'}
          <ChevronDown size={12} />
        </button>
        {showFilterMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowFilterMenu(false)} />
            <div className="absolute left-0 top-full mt-1 z-20 bg-background rounded-xl shadow-lg py-1 min-w-[160px]">
              <button
                onClick={() => {
                  setPhaseFilter(null)
                  setShowFilterMenu(false)
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-panel ${!phaseFilter ? 'font-semibold text-accent' : 'text-main-text'}`}
              >
                All Phases
              </button>
              {PHASES.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPhaseFilter(p)
                    setShowFilterMenu(false)
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-panel ${p === phaseFilter ? 'font-semibold text-accent' : 'text-main-text'}`}
                >
                  {phaseDisplayName(p)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-minor-text">No sessions in this phase yet.</p>
      ) : (
        <>
          <CompletionSection sessions={sessions} />
          <div>
            <div className="text-base font-bold text-main-text mb-3">Weekly volume</div>
            <div className="flex flex-col gap-3">
              <DisciplinePanel discipline="swim" sessions={sessions} />
              <DisciplinePanel discipline="bike" sessions={sessions} />
              <DisciplinePanel discipline="run" sessions={sessions} />
              <GymWeeklyPanel sessions={sessions} />
            </div>
          </div>
          <GymProgressionSection sessions={sessions} />
        </>
      )}
    </div>
  )
}

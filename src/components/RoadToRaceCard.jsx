import { useMemo } from 'react'
import { startOfWeekMon, asDate } from '../services/dateUtils'
import { phaseDisplayName } from '../db/phase'
import { phaseForDate } from '../db/weekPhase'
import { OVERVIEW_CARD_MIN_HEIGHT } from './WeekGlanceCard'

const HEIGHTS = [0.12, 0.3, 0.22, 0.42, 0.34, 0.55, 0.46, 0.68, 0.6, 0.82, 0.74, 0.95]

function RoadToRaceGraph({ progress, initial }) {
  const width = 300
  const height = 90
  const n = HEIGHTS.length
  const points = HEIGHTS.map((h, i) => [
    (width * i) / (n - 1),
    height * (1 - h),
  ])

  const fullPath = points.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ')

  const progressIndex = (n - 1) * progress
  const progressPoints = points.filter((_, i) => i <= progressIndex)
  const progressPath = progressPoints.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ')

  // Marker position — interpolate along the polyline at `progress`.
  const scaled = progress * (n - 1)
  const lowerIndex = Math.max(0, Math.min(n - 2, Math.floor(scaled)))
  const t = scaled - lowerIndex
  const p0 = points[lowerIndex]
  const p1 = points[lowerIndex + 1]
  const markerX = p0[0] + (p1[0] - p0[0]) * t
  const markerY = p0[1] + (p1[1] - p0[1]) * t

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[90px]">
      <path d={fullPath} fill="none" stroke="var(--color-accent)" strokeOpacity={0.25} strokeWidth={2} strokeDasharray="5,5" strokeLinecap="round" />
      {progressPath && (
        <path d={progressPath} fill="none" stroke="var(--color-accent)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      )}
      <circle cx={markerX} cy={markerY} r={11} fill="var(--color-accent)" />
      <text x={markerX} y={markerY + 4} textAnchor="middle" fontSize={11} fontWeight="700" fill="white">
        {initial}
      </text>
    </svg>
  )
}

/** "Road to Race" progress card — ported from OverviewView.swift's
 * `RoadToRaceCard`. */
export default function RoadToRaceCard({ profile, sessions, weekPhases, onOpenProfile }) {
  const data = useMemo(() => {
    if (!profile.competitionDate) return null
    const today = new Date()
    const compDate = asDate(profile.competitionDate)
    const daysRemaining = Math.max(0, Math.round((compDate - today) / 86400000))

    const anchor = profile.trainingBlockStartDate
      ? startOfWeekMon(asDate(profile.trainingBlockStartDate))
      : sessions.length
        ? startOfWeekMon(sessions.reduce((min, s) => (asDate(s.date) < min ? asDate(s.date) : min), asDate(sessions[0].date)))
        : null

    const currentWeekStart = startOfWeekMon(today)
    const raceWeekStart = startOfWeekMon(compDate)

    const weeksBetweenMon = (start, end) => Math.round((end - start) / (7 * 86400000))

    const currentWeekNumber = anchor ? Math.max(1, weeksBetweenMon(anchor, currentWeekStart) + 1) : 1
    const totalWeeks = anchor
      ? Math.max(currentWeekNumber, weeksBetweenMon(anchor, raceWeekStart) + 1)
      : currentWeekNumber
    const progress = totalWeeks > 0 ? Math.min(1, Math.max(0, currentWeekNumber / totalWeeks)) : 0

    return { daysRemaining, currentWeekNumber, totalWeeks, progress }
  }, [profile.competitionDate, profile.trainingBlockStartDate, sessions])

  const displayName = profile.name?.trim() || 'Athlete'
  const initial = displayName.charAt(0).toUpperCase()

  if (!data) {
    return (
      <div className="p-4 bg-panel rounded-2xl flex items-center" style={{ minHeight: OVERVIEW_CARD_MIN_HEIGHT }}>
        <p className="text-sm text-main-text">
          {displayName}, are you ready to take on your next challenge?{' '}
          <button onClick={onOpenProfile} className="text-accent font-semibold underline">
            Add a competition
          </button>{' '}
          in your profile!
        </p>
      </div>
    )
  }

  const raceName = profile.competitionName?.trim() || 'Race'
  const phaseLabel = phaseDisplayName(phaseForDate(weekPhases, new Date()))

  return (
    <div className="p-4 bg-panel rounded-2xl flex flex-col gap-3" style={{ minHeight: OVERVIEW_CARD_MIN_HEIGHT }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-main-text">Road to Race</span>
        <span className="text-sm font-bold text-accent">{data.daysRemaining} days</span>
      </div>
      <span className="text-xs text-minor-text -mt-2">{raceName}</span>
      <RoadToRaceGraph progress={data.progress} initial={initial} />
      <span className="text-xs font-semibold text-minor-text">
        {phaseLabel} · Week {data.currentWeekNumber} of {data.totalWeeks}
      </span>
    </div>
  )
}

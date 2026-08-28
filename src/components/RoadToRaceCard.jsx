import { Component, useMemo } from 'react'
import { asDate, daysBetween, startOfDay, startOfWeekMon } from '../services/dateUtils'
import { phaseDisplayName } from '../db/phase'
import { phaseForDate } from '../db/weekPhase'
import { derivedDistanceKm, isFullyCompleted, totalDistanceKm } from '../db/session'
import { PHASE_WINDOWS_DAYS, runningPaceTargets, triathlonNumericTargets } from '../services/planning/planRules'
import { raceProjection, projectionDisplay } from '../services/raceProjection'

const DAY_MS = 86400000

const TRACK_PHASES = [
  { key: 'buildUp', label: 'Build-Up' },
  { key: 'endurance', label: 'Endurance' },
  { key: 'peak', label: 'Peak' },
  { key: 'taper', label: 'Taper' },
]

const PHASE_DESCRIPTIONS = {
  buildUp: 'Building consistent aerobic volume and durable training habits.',
  endurance: 'Extending aerobic durability and race-specific endurance.',
  peak: 'Highest-quality race-specific work with controlled overall load.',
  taper: 'Reducing fatigue while preserving race readiness and sharpness.',
  recovery: 'Absorbing the recent training load with lower volume and intensity.',
  maintenance: 'Maintaining fitness while keeping training load steady.',
}

function ProgressRing({ progress }) {
  const pct = Math.round(progress * 100)
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const dash = circumference * progress

  return (
    <div className="relative w-[112px] h-[112px] shrink-0">
      <svg viewBox="0 0 112 112" className="w-full h-full -rotate-90" aria-hidden="true">
        <circle cx="56" cy="56" r={radius} fill="none" stroke="var(--color-minor-text)" strokeOpacity="0.22" strokeWidth="10" />
        <circle
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[24px] font-bold text-main-text">{pct}%</span>
      </div>
    </div>
  )
}

function MetricBox({ value, label, detail }) {
  return (
    <div className="min-w-0 rounded-2xl bg-background/70 px-3 py-3.5">
      <div className="text-[20px] leading-tight font-bold text-main-text break-words">{value || '—'}</div>
      <div className="mt-1 text-[11px] leading-tight font-semibold text-minor-text">{label}</div>
      {detail && <div className="mt-1 text-[10px] leading-tight text-minor-text/80">{detail}</div>}
    </div>
  )
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function startPct(startMs, endMs, valueMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0
  return clamp01((valueMs - startMs) / (endMs - startMs)) * 100
}

function raceBasePhase(profile, pointInTime) {
  if (!profile?.competitionDate) return 'buildUp'
  const raceDate = startOfDay(asDate(profile.competitionDate))
  const weekStart = startOfWeekMon(pointInTime)
  const daysOut = Math.round((raceDate - weekStart) / DAY_MS)
  const taperDays = profile.sport === 'running' && profile.runningDistance === 'marathon'
    ? PHASE_WINDOWS_DAYS.taperMarathon
    : PHASE_WINDOWS_DAYS.taperDefault

  if (daysOut <= taperDays) return 'taper'
  if (daysOut <= PHASE_WINDOWS_DAYS.peak) return 'peak'
  if (daysOut <= PHASE_WINDOWS_DAYS.endurance) return 'endurance'
  return 'buildUp'
}

function buildTrackLayout(profile, planStart, raceDate) {
  const safePlanStart = asDate(planStart)
  const safeRaceDate = asDate(raceDate)
  if (!safePlanStart || !safeRaceDate) {
    return {
      segments: [{ key: 'buildUp', label: 'Build-Up', startPct: 0, endPct: 100, labelPct: 50 }],
      boundaries: [],
    }
  }

  const start = startOfWeekMon(safePlanStart)
  const end = startOfDay(safeRaceDate)
  const startMs = start.getTime()
  const endMs = end.getTime()

  if (!(endMs > startMs)) {
    return {
      segments: [{ key: 'buildUp', label: 'Build-Up', startPct: 0, endPct: 100, labelPct: 50 }],
      boundaries: [],
    }
  }

  const taperDays = profile.sport === 'running' && profile.runningDistance === 'marathon'
    ? PHASE_WINDOWS_DAYS.taperMarathon
    : PHASE_WINDOWS_DAYS.taperDefault

  const transitions = [
    { key: 'endurance', at: startOfWeekMon(new Date(endMs - PHASE_WINDOWS_DAYS.endurance * DAY_MS)) },
    { key: 'peak', at: startOfWeekMon(new Date(endMs - PHASE_WINDOWS_DAYS.peak * DAY_MS)) },
    { key: 'taper', at: startOfWeekMon(new Date(endMs - taperDays * DAY_MS)) },
  ]
    .filter(({ at }) => at.getTime() > startMs && at.getTime() < endMs)
    .sort((a, b) => a.at - b.at)

  const segments = []
  let cursor = start
  let currentKey = raceBasePhase(profile, cursor)

  for (const transition of transitions) {
    const boundary = transition.at
    if (boundary > cursor) {
      const segStartMs = cursor.getTime()
      const segEndMs = boundary.getTime()
      segments.push({
        key: currentKey,
        label: TRACK_PHASES.find((phase) => phase.key === currentKey)?.label ?? phaseDisplayName(currentKey),
        startPct: startPct(startMs, endMs, segStartMs),
        endPct: startPct(startMs, endMs, segEndMs),
        labelPct: startPct(startMs, endMs, segStartMs + ((segEndMs - segStartMs) / 2)),
      })
    }
    cursor = boundary
    currentKey = transition.key
  }

  if (end > cursor) {
    const segStartMs = cursor.getTime()
    segments.push({
      key: currentKey,
      label: TRACK_PHASES.find((phase) => phase.key === currentKey)?.label ?? phaseDisplayName(currentKey),
      startPct: startPct(startMs, endMs, segStartMs),
      endPct: 100,
      labelPct: startPct(startMs, endMs, segStartMs + ((endMs - segStartMs) / 2)),
    })
  }

  return {
    segments,
    boundaries: segments.slice(0, -1).map((segment) => segment.endPct),
  }
}

function PhaseTrack({ progress, planStart, raceDate, profile }) {
  const markerPct = clamp01(progress) * 100
  const layout = buildTrackLayout(profile, planStart, raceDate)

  return (
    <div className="mt-4">
      <div className="relative h-5">
        <div className="absolute left-0 right-0 top-[8px] h-1 rounded-full bg-minor-text/25" />
        {layout.boundaries.map((boundary) => (
          <div
            key={boundary}
            className="absolute top-[2px] h-3 w-px bg-minor-text/18"
            style={{ left: `calc(${boundary}% - 0.5px)` }}
          />
        ))}
        <div
          className="absolute left-0 top-[8px] h-1 rounded-full bg-accent"
          style={{ width: `${markerPct}%` }}
        />
        <div
          className="absolute top-0 w-4 h-4 rounded-full border-[4px] border-accent bg-panel -translate-x-1/2"
          style={{ left: `${markerPct}%` }}
        />
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-minor-text">
        <span>Plan start</span>
        <span>Race</span>
      </div>
    </div>
  )
}

function formatKm(value) {
  if (!Number.isFinite(value)) return null
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded} km`
}

function formatSwimPace(value) {
  return value?.replace('/100m', ' /100m') ?? null
}

function RoadToRaceCardContent({ profile, sessions, weekPhases, onOpenProfile }) {
  const projection = useMemo(() => raceProjection(profile, sessions), [profile, sessions])
  const projectionText = useMemo(() => projectionDisplay(projection), [projection])

  const data = useMemo(() => {
    const today = startOfDay(new Date())
    const hasCompetition = !!profile.competitionDate
    const competitionDate = hasCompetition ? startOfDay(asDate(profile.competitionDate)) : null

    const anchor = profile.trainingBlockStartDate
      ? startOfWeekMon(asDate(profile.trainingBlockStartDate))
      : sessions.length
        ? startOfWeekMon(sessions.reduce((min, s) => (asDate(s.date) < min ? asDate(s.date) : min), asDate(sessions[0].date)))
        : null

    let daysRemaining = null
    let currentWeekNumber = null
    let totalWeeks = null
    let progress = 0

    if (hasCompetition && competitionDate) {
      daysRemaining = Math.max(0, daysBetween(today, competitionDate))
      const currentWeekStart = startOfWeekMon(today)
      const raceWeekStart = startOfWeekMon(competitionDate)
      const weeksBetweenMon = (start, end) => Math.round((end - start) / (7 * 86400000))
      // A profile can have a target race before its first plan has been
      // generated. In that state there is no real training-block anchor yet:
      // show Week 1 of the prospective plan and 0% progress rather than
      // treating the missing anchor as a one-week, already-complete plan.
      const displayAnchor = anchor ?? currentWeekStart
      currentWeekNumber = anchor ? Math.max(1, weeksBetweenMon(anchor, currentWeekStart) + 1) : 1
      totalWeeks = Math.max(currentWeekNumber, weeksBetweenMon(displayAnchor, raceWeekStart) + 1)

      if (anchor) {
        const planStart = startOfDay(anchor)
        const totalPlanDays = Math.max(1, daysBetween(planStart, competitionDate))
        const elapsedPlanDays = Math.max(0, daysBetween(planStart, today))
        progress = Math.min(1, elapsedPlanDays / totalPlanDays)
      }
    }

    const weekStart = startOfWeekMon(today)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)
    const currentWeekSessions = sessions.filter((session) => {
      const date = asDate(session.date)
      return date >= weekStart && date < weekEnd
    })

    const runningWeekKm = currentWeekSessions
      .filter((session) => session.discipline === 'run')
      .reduce((sum, session) => sum + (totalDistanceKm(session) ?? 0), 0)

    const longestCompletedRunKm = sessions
      .filter((session) => session.discipline === 'run' && isFullyCompleted(session))
      .reduce((max, session) => Math.max(max, derivedDistanceKm(session) ?? 0), 0)

    const currentWeekStart = startOfWeekMon(today)
    const explicitCurrentPhase = weekPhases.find((row) => {
      const rowDate = asDate(row.weekStart)
      return rowDate && startOfWeekMon(rowDate).getTime() === currentWeekStart.getTime()
    })?.phase

    // phaseForDate intentionally defaults to Maintenance for generic lookups,
    // but that is the wrong UX for a brand-new race profile. Until the first
    // generated block persists a week phase, the athlete starts in Build-Up
    // (or, for an unusually close race, the scheduler's race-driven phase).
    const currentPhase = explicitCurrentPhase
      ?? (hasCompetition ? raceBasePhase(profile, today) : phaseForDate(weekPhases, today))

    return {
      hasCompetition,
      competitionDate,
      daysRemaining,
      currentWeekNumber,
      totalWeeks,
      progress,
      phase: currentPhase,
      planStart: anchor ?? today,
      runningWeekKm,
      longestCompletedRunKm,
      runningTargets: runningPaceTargets(profile),
      triTargets: triathlonNumericTargets(profile),
    }
  }, [profile, sessions, weekPhases])

  const raceName = profile.competitionName?.trim() || 'Race'
  const phaseLabel = phaseDisplayName(data.phase)

  const runningMetrics = [
    {
      value: formatKm(data.runningWeekKm),
      label: 'Weekly volume',
      detail: 'scheduled this week',
    },
    {
      value: formatKm(data.longestCompletedRunKm),
      label: 'Longest run to date',
      detail: 'completed sessions',
    },
    {
      value: data.runningTargets.thresholdPace,
      label: 'Expected threshold pace',
      detail: 'goal-derived',
    },
  ]

  const triMetrics = [
    {
      value: data.triTargets.run?.thresholdPace,
      label: 'Run threshold pace',
      detail: 'goal-derived',
    },
    {
      value: data.triTargets.ftpWatts ? `${data.triTargets.ftpWatts} W` : data.triTargets.bikeSpeedKph ? `${data.triTargets.bikeSpeedKph} km/h` : null,
      label: data.triTargets.ftpWatts ? 'Bike FTP' : 'Bike goal speed',
      detail: data.triTargets.ftpWatts ? 'athlete-provided' : 'goal-derived',
    },
    {
      value: formatSwimPace(data.triTargets.swimPacePer100m),
      label: 'Swim goal pace',
      detail: 'per 100 m',
    },
  ]

  const metrics = profile.sport === 'triathlon' ? triMetrics : runningMetrics

  return (
    <section>
      <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-minor-text">Road to Race</div>
      <div className="rounded-[28px] bg-panel p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[23px] leading-tight font-bold text-main-text truncate">
              {data.hasCompetition ? raceName : 'Your training journey'}
            </h2>
            {data.hasCompetition && (
              <p className="mt-1 text-sm text-minor-text">
                Phase: {phaseLabel} · Week {data.currentWeekNumber} of {data.totalWeeks}
              </p>
            )}
          </div>
          {data.hasCompetition && (
            <div className="shrink-0 text-right">
              <div className="text-[28px] leading-none font-bold text-accent">{data.daysRemaining}</div>
              <div className="mt-1 text-xs font-semibold text-minor-text">days</div>
            </div>
          )}
        </div>

        {data.hasCompetition && (
          <div className="mt-5 flex items-center gap-5">
            <ProgressRing progress={data.progress} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase tracking-wide text-minor-text">Projected finish time</div>
              {projection.status === 'ready' ? (
                <>
                  <div className="mt-1 text-[27px] leading-tight font-bold text-main-text">{projectionText?.value}</div>
                  <p className="mt-1 text-xs leading-relaxed text-minor-text">
                    Estimated range {projectionText?.range} · {projection.confidence} confidence
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-1 text-[22px] leading-tight font-bold text-main-text">Building estimate</div>
                  <p className="mt-1 text-xs leading-relaxed text-minor-text">{projection.reason}</p>
                </>
              )}
            </div>
          </div>
        )}

        <div className="my-5 h-px bg-minor-text/20" />

        <div className="grid grid-cols-3 gap-2.5">
          {metrics.map((metric) => (
            <MetricBox key={metric.label} {...metric} />
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-minor-text/20">
          {data.hasCompetition ? (
            <>
              <div className="text-base font-bold text-main-text">Current phase: {phaseLabel}</div>
              <p className="mt-1 text-xs leading-relaxed text-minor-text">{PHASE_DESCRIPTIONS[data.phase]}</p>
              <PhaseTrack
                progress={data.progress}
                planStart={data.planStart}
                raceDate={data.competitionDate}
                profile={profile}
              />
            </>
          ) : (
            <p className="text-sm leading-relaxed text-main-text">
              Ready to work toward a specific event?{' '}
              <button onClick={onOpenProfile} className="font-semibold text-accent underline underline-offset-2">
                Add a competition
              </button>{' '}
              in your profile to unlock race countdown and plan progress.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

class RoadToRaceErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    // Keep a Road to Race rendering regression from taking down the entire
    // application. The console entry still makes the underlying error visible
    // during development.
    console.error('Road to Race failed to render', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <section>
          <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-minor-text">Road to Race</div>
          <div className="rounded-[28px] bg-panel p-5">
            <div className="text-base font-bold text-main-text">Road to Race is temporarily unavailable</div>
            <p className="mt-1 text-xs leading-relaxed text-minor-text">
              Your training plan and logs are unaffected. Reload the app to retry this card.
            </p>
          </div>
        </section>
      )
    }
    return this.props.children
  }
}

export default function RoadToRaceCard(props) {
  return (
    <RoadToRaceErrorBoundary>
      <RoadToRaceCardContent {...props} />
    </RoadToRaceErrorBoundary>
  )
}

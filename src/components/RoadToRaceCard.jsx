import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { asDate, daysBetween, startOfDay, startOfWeekMon } from '../services/dateUtils'
import { phaseDisplayName } from '../db/phase'
import { phaseForDate } from '../db/weekPhase'
import { derivedDistanceKm, isFullyCompleted, totalDistanceKm } from '../db/session'
import { runningPaceTargets, triathlonNumericTargets } from '../services/planning/planRules'
import { raceProjection, projectionDisplay } from '../services/raceProjection'
import db from '../db/db'

const PHASE_STEPS = ['Build-Up', 'Endurance', 'Peak', 'Taper', 'Race']

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

function PhaseTrack({ phase }) {
  const phasePosition = {
    buildUp: 0,
    endurance: 1,
    peak: 2,
    taper: 3,
    recovery: 1,
    maintenance: 0,
  }[phase] ?? 0

  const markerPct = (phasePosition / (PHASE_STEPS.length - 1)) * 100

  return (
    <div className="mt-4">
      <div className="relative h-4">
        <div className="absolute left-1 right-1 top-[6px] h-1 rounded-full bg-minor-text/25" />
        <div
          className="absolute left-1 top-[6px] h-1 rounded-full bg-accent"
          style={{ width: `calc(${markerPct}% - ${markerPct === 0 ? 0 : 4}px)` }}
        />
        <div
          className="absolute top-0 w-4 h-4 rounded-full border-[4px] border-accent bg-panel -translate-x-1/2"
          style={{ left: `calc(4px + (100% - 8px) * ${markerPct / 100})` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1">
        {PHASE_STEPS.map((step, index) => (
          <span
            key={step}
            className={`text-[10px] font-semibold ${index === phasePosition ? 'text-main-text' : 'text-minor-text'}`}
          >
            {step}
          </span>
        ))}
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

export default function RoadToRaceCard({ profile, sessions, weekPhases, onOpenProfile }) {
  const raceKey = useMemo(() => [
    profile.sport,
    profile.sport === 'triathlon' ? profile.triathlonDistance : profile.runningDistance,
    profile.competitionDate ?? '',
    profile.competitionName?.trim() ?? '',
  ].join('|'), [profile])

  const projection = useMemo(() => raceProjection(profile, sessions), [profile, sessions])
  const projectionText = useMemo(() => projectionDisplay(projection), [projection])
  const projectionHistory = useLiveQuery(
    () => db.raceProjections?.where('raceKey').equals(raceKey).sortBy('date') ?? [],
    [raceKey],
    [],
  )

  useEffect(() => {
    if (projection.status !== 'ready' || !db.raceProjections) return
    const date = new Date().toLocaleDateString('en-CA')
    db.raceProjections.put({
      raceKey,
      date,
      projectedSeconds: Math.round(projection.seconds),
      lowerSeconds: Math.round(projection.lowerSeconds),
      upperSeconds: Math.round(projection.upperSeconds),
      confidence: projection.confidence,
    }).catch(() => {})
  }, [raceKey, projection.status, projection.seconds, projection.lowerSeconds, projection.upperSeconds, projection.confidence])

  const projectionTrend = useMemo(() => {
    if (projection.status !== 'ready' || !projectionHistory.length) return null
    const cutoff = Date.now() - 28 * 86400000
    const baseline = projectionHistory.find((entry) => asDate(entry.date).getTime() >= cutoff) ?? projectionHistory[0]
    if (!baseline || !Number.isFinite(baseline.projectedSeconds)) return null
    const deltaSeconds = baseline.projectedSeconds - projection.seconds
    if (Math.abs(deltaSeconds) < 60) return 'Stable over the last 4 weeks'
    const minutes = Math.max(1, Math.round(Math.abs(deltaSeconds) / 60))
    return deltaSeconds > 0 ? `↑ ${minutes} min faster over 4 weeks` : `↓ ${minutes} min slower over 4 weeks`
  }, [projection, projectionHistory])

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
      currentWeekNumber = anchor ? Math.max(1, weeksBetweenMon(anchor, currentWeekStart) + 1) : 1
      totalWeeks = anchor ? Math.max(currentWeekNumber, weeksBetweenMon(anchor, raceWeekStart) + 1) : currentWeekNumber
      progress = totalWeeks > 0 ? Math.min(1, Math.max(0, currentWeekNumber / totalWeeks)) : 0
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

    return {
      hasCompetition,
      daysRemaining,
      currentWeekNumber,
      totalWeeks,
      progress,
      phase: phaseForDate(weekPhases, today),
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
                  {projectionTrend && <p className="mt-1 text-xs font-semibold text-positive">{projectionTrend}</p>}
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
              <PhaseTrack phase={data.phase} />
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

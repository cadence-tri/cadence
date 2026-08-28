import { asDate, startOfDay } from './dateUtils.js'
import { derivedDistanceKm, isFullyCompleted, durationMinutes } from '../db/session.js'
import { RUNNING_META, TRIATHLON_META } from '../db/raceDistance.js'

const DAY_MS = 86400000

function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!xs.length) return null
  const i = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[i] : (xs[i - 1] + xs[i]) / 2
}

function parsePaceSeconds(raw, unit = 'km') {
  if (!raw) return null
  const text = String(raw).toLowerCase().replace(/[’′']/g, ':').replace(/[”″"]/g, '')
  const unitPattern = unit === '100m' ? '(?:\\/\\s*100\\s*m|per\\s*100\\s*m)' : '(?:\\/\\s*km|per\\s*km)'
  const match = text.match(new RegExp('(\\d{1,2})\\s*[:.]\\s*(\\d{2})\\s*' + unitPattern, 'i'))
  if (!match) return null
  const seconds = Number(match[1]) * 60 + Number(match[2])
  return seconds > 0 ? seconds : null
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const rounded = Math.round(seconds / 60) * 60
  const h = Math.floor(rounded / 3600)
  const m = Math.floor((rounded % 3600) / 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`
  return `${m} min`
}

function riegel(sourceSeconds, sourceKm, targetKm, exponent = 1.06) {
  return sourceSeconds * Math.pow(targetKm / sourceKm, exponent)
}

function completedSessions(sessions, discipline) {
  return sessions.filter((s) => s.discipline === discipline && isFullyCompleted(s))
}

function runThresholdEvidence(profile, sessions) {
  const profileThreshold = parsePaceSeconds(profile.onboardingThresholdDetails, 'km')
  const samples = []
  for (const session of completedSessions(sessions, 'run').filter((s) => s.role === 'quality' || /threshold|tempo|interval|race/i.test(`${s.title ?? ''} ${s.intensity ?? ''}`))) {
    for (const set of session.sets ?? []) {
      if (!set.isCompleted) continue
      const pace = parsePaceSeconds(set.paceOrPower, 'km')
      const distanceKm = Number(set.distanceM) / 1000 * (set.setsCount ?? 1)
      const duration = durationMinutes(set) * (set.setsCount ?? 1)
      if (pace && (distanceKm >= 0.8 || duration >= 5)) samples.push(pace)
    }
  }
  const workoutThreshold = samples.length ? median(samples.sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(samples.length * 0.5)))) : null
  return {
    pace: workoutThreshold ?? profileThreshold,
    source: workoutThreshold ? 'completed workouts' : profileThreshold ? 'athlete threshold' : null,
    sampleCount: samples.length,
  }
}

function completedRunReadiness(sessions, targetKm, today = new Date()) {
  const runs = completedSessions(sessions, 'run')
  const longest = runs.reduce((max, s) => Math.max(max, derivedDistanceKm(s) ?? 0), 0)
  const cutoff = startOfDay(today).getTime() - 28 * DAY_MS
  const recentKm = runs
    .filter((s) => {
      const date = asDate(s.date)
      return date && date.getTime() >= cutoff
    })
    .reduce((sum, s) => sum + (derivedDistanceKm(s) ?? 0), 0)
  const weeklyAvg = recentKm / 4
  const longRatio = Math.min(1, longest / Math.max(1, targetKm * (targetKm >= 30 ? 0.7 : 0.8)))
  const volumeReference = targetKm >= 40 ? 45 : targetKm >= 20 ? 30 : targetKm >= 10 ? 20 : 12
  const volumeRatio = Math.min(1, weeklyAvg / volumeReference)
  const readiness = 0.6 * longRatio + 0.4 * volumeRatio
  return { longest, weeklyAvg, readiness }
}

function runningProjection(profile, sessions, targetKm, offBikePenalty = 0) {
  const evidence = runThresholdEvidence(profile, sessions)
  if (!evidence.pace) return { status: 'building', reason: 'Complete sustained run work to establish current fitness.' }

  // Threshold pace is treated as approximately one-hour race pace, then
  // converted to the target distance with Riegel. This avoids using the goal
  // time itself as evidence.
  const thresholdDistanceKm = 3600 / evidence.pace
  let seconds = riegel(3600, thresholdDistanceKm, targetKm)
  const readiness = completedRunReadiness(sessions, targetKm)
  const readinessPenalty = Math.max(0, 1 - readiness.readiness) * (targetKm >= 40 ? 0.16 : targetKm >= 20 ? 0.10 : 0.06)
  seconds *= 1 + readinessPenalty + offBikePenalty

  let confidence = 'Low'
  if (evidence.sampleCount >= 3 && readiness.readiness >= 0.7) confidence = 'High'
  else if (evidence.sampleCount >= 1 || (evidence.source === 'athlete threshold' && readiness.readiness >= 0.45)) confidence = 'Medium'
  const spread = confidence === 'High' ? 0.035 : confidence === 'Medium' ? 0.065 : 0.10
  return {
    status: 'ready', seconds, lowerSeconds: seconds * (1 - spread), upperSeconds: seconds * (1 + spread),
    confidence, evidence: evidence.source, readiness,
  }
}

function swimProjection(profile, sessions, distanceKm) {
  const profilePace = parsePaceSeconds(profile.onboardingThresholdDetails, '100m')
  const samples = []
  for (const session of completedSessions(sessions, 'swim')) {
    for (const set of session.sets ?? []) {
      if (!set.isCompleted) continue
      const pace = parsePaceSeconds(set.paceOrPower, '100m')
      const distance = Number(set.distanceM) * (set.setsCount ?? 1)
      if (pace && distance >= 200) samples.push(pace)
    }
  }
  const pace = median(samples) ?? profilePace
  if (!pace) return { status: 'building' }
  const distanceFactor = distanceKm >= 3.8 ? 1.12 : distanceKm >= 1.9 ? 1.08 : distanceKm >= 1.5 ? 1.05 : 1.03
  return { status: 'ready', seconds: pace * (distanceKm * 10) * distanceFactor, sampleCount: samples.length }
}

function sessionDurationMinutes(session) {
  const completed = (session.sets ?? []).filter((s) => s.isCompleted)
  const setMinutes = completed.reduce((sum, set) => sum + (durationMinutes(set) ?? 0) * (set.setsCount ?? 1), 0)
  if (setMinutes > 0) return setMinutes
  const raw = String(session.totalDuration ?? session.duration ?? '')
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(?:min|')/i)
  return match ? Number(match[1]) : null
}

function bikeProjection(sessions, targetKm) {
  const rides = completedSessions(sessions, 'bike').map((s) => {
    const km = derivedDistanceKm(s) ?? 0
    const minutes = sessionDurationMinutes(s)
    return { km, speed: km > 0 && minutes > 0 ? km / (minutes / 60) : null }
  }).filter((r) => r.speed && r.km >= Math.min(20, targetKm * 0.25))
  if (!rides.length) return { status: 'building' }
  const speed = median(rides.map((r) => r.speed))
  const longest = Math.max(...rides.map((r) => r.km))
  const readiness = Math.min(1, longest / Math.max(1, targetKm * 0.7))
  const adjustedSpeed = speed * (1 - Math.max(0, 1 - readiness) * 0.12)
  return { status: 'ready', seconds: targetKm / adjustedSpeed * 3600, sampleCount: rides.length }
}

export function raceProjection(profile, sessions, today = new Date()) {
  if (!profile?.competitionDate) return { status: 'unavailable' }

  if (profile.sport === 'running') {
    const targetKm = RUNNING_META[profile.runningDistance]?.distanceKm
    if (!targetKm) return { status: 'building', reason: 'Choose a race distance to build an estimate.' }
    return runningProjection(profile, sessions, targetKm)
  }

  const meta = TRIATHLON_META[profile.triathlonDistance]
  if (!meta) return { status: 'building', reason: 'Choose a triathlon distance to build an estimate.' }
  const swim = swimProjection(profile, sessions, meta.legs.swim)
  const bike = bikeProjection(sessions, meta.legs.bike)
  const runPenalty = profile.triathlonDistance === 'ironman' ? 0.12 : profile.triathlonDistance === 'halfIronman' ? 0.08 : profile.triathlonDistance === 'olympic' ? 0.05 : 0.03
  const run = runningProjection(profile, sessions, meta.legs.run, runPenalty)
  const missing = [swim.status !== 'ready' ? 'swim' : null, bike.status !== 'ready' ? 'bike' : null, run.status !== 'ready' ? 'run' : null].filter(Boolean)
  if (missing.length) return { status: 'building', reason: `Need more completed ${missing.join(', ')} data for a full triathlon estimate.`, legs: { swim, bike, run } }

  const transitions = profile.triathlonDistance === 'ironman' ? 10 * 60 : profile.triathlonDistance === 'halfIronman' ? 7 * 60 : profile.triathlonDistance === 'olympic' ? 5 * 60 : 4 * 60
  const seconds = swim.seconds + bike.seconds + run.seconds + transitions
  const evidenceCount = (swim.sampleCount ?? 0) + (bike.sampleCount ?? 0) + (run.readiness ? 1 : 0)
  const confidence = evidenceCount >= 5 ? 'Medium' : 'Low'
  const spread = confidence === 'Medium' ? 0.08 : 0.12
  return { status: 'ready', seconds, lowerSeconds: seconds * (1 - spread), upperSeconds: seconds * (1 + spread), confidence, legs: { swim, bike, run } }
}

export function projectionDisplay(projection) {
  if (projection?.status !== 'ready') return null
  return {
    value: formatDuration(projection.seconds),
    range: `${formatDuration(projection.lowerSeconds)}–${formatDuration(projection.upperSeconds)}`,
  }
}

import { format } from 'date-fns'
import { asDate, startOfWeekMon } from './dateUtils.js'

const cleanFloat = (value) => Number(Number(value).toFixed(6))

export function weeklyBuckets(sessions, keyFn) {
  const buckets = new Map()
  for (const session of sessions) {
    const value = keyFn(session)
    if (!Number.isFinite(value) || value <= 0) continue
    const weekStart = startOfWeekMon(asDate(session.date))
    const key = weekStart.getTime()
    buckets.set(key, cleanFloat((buckets.get(key) ?? 0) + value))
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ weekStart: new Date(time), value, label: format(new Date(time), 'd MMM') }))
}

function niceStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return factor * magnitude
}

// Use four readable intervals while keeping label headroom. Returning a nice
// bound (2, 20, 80...) prevents Recharts from exposing binary floating-point
// artifacts such as 19.549999999999997 as axis labels.
export function chartUpperBound(dataMax) {
  if (!Number.isFinite(dataMax) || dataMax <= 0) return 1
  const step = niceStep(dataMax * 1.15 / 4)
  let upper = Math.ceil(dataMax / step) * step
  if (upper < dataMax * 1.08) upper += step
  return cleanFloat(upper)
}

export function formatAxisTick(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  const absolute = Math.abs(numeric)
  const maximumFractionDigits = absolute < 1 ? 2 : absolute < 100 ? 1 : 0
  return new Intl.NumberFormat(undefined, { maximumFractionDigits, useGrouping: true }).format(cleanFloat(numeric))
}

export function formatVolumeLabel(value, unit) {
  const numeric = value < 10 ? value.toFixed(1) : String(Math.round(value))
  return `${numeric} ${unit}`
}

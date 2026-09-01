const RANGE_SEPARATOR = '–'

function positiveRepeatCount(set) {
  return Number.isInteger(set?.setsCount) && set.setsCount > 1 ? set.setsCount : 1
}

export function formatRunDuration(set) {
  if (Number.isFinite(set?.durationSeconds) && set.durationSeconds > 0) {
    const seconds = Math.round(set.durationSeconds)
    if (seconds < 60) return `${seconds} sec`
    if (seconds % 60 === 0) return `${seconds / 60} min`
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }

  const legacy = String(set?.duration ?? '').trim()
  const match = legacy.match(/^(\d+)m\s*(\d+)s$/i)
  if (match) {
    const minutes = Number(match[1])
    const seconds = Number(match[2])
    if (seconds === 0) return `${minutes} min`
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }
  return legacy || null
}

function formatRunDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return null
  if (meters < 1000) return `${meters.toLocaleString()} m`
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(meters / 1000)} km`
}

export function formatRunQuantity(set) {
  const value = set?.distanceM != null && set?.durationSeconds == null
    ? formatRunDistance(set.distanceM)
    : formatRunDuration(set) ?? formatRunDistance(set?.distanceM)
  if (!value) return null
  const repeats = positiveRepeatCount(set)
  return repeats > 1 ? `${repeats} × ${value}` : value
}

function compactPaceRange(value) {
  return value.replace(
    /^(\d+:\d{2})\/km\s*[–-]\s*(\d+:\d{2})\/km$/,
    `$1${RANGE_SEPARATOR}$2/km`,
  )
}

export function formatRunTarget(value) {
  const text = String(value ?? '').trim()
  if (!text) return { target: null, rpe: null }

  const effort = text.match(/controlled effort\s+(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\/10/i)
  const target = compactPaceRange(text.split(';')[0].trim()) || null
  return {
    target,
    rpe: effort ? `RPE ${effort[1]}${RANGE_SEPARATOR}${effort[2]}` : null,
  }
}

function runStepLabel(set, workIndex, workCount) {
  switch (set?.stepType) {
    case 'warmup': return 'Warm-up'
    case 'cooldown': return 'Cool-down'
    case 'recovery': return 'Recovery'
    case 'easy': return 'Easy running'
    case 'work': return workCount > 1 ? `Rep ${workIndex} of ${workCount}` : 'Main effort'
    default: return set?.exercise || 'Run step'
  }
}

export function runStepPresentation(sets = []) {
  const workCount = sets.filter((set) => set.stepType === 'work').length
  let workIndex = 0
  return sets.map((set) => {
    if (set.stepType === 'work') workIndex += 1
    const target = formatRunTarget(set.paceOrPower)
    return {
      label: runStepLabel(set, workIndex, workCount),
      quantity: formatRunQuantity(set),
      ...target,
    }
  })
}

function matchingValue(items, getter) {
  if (!items.length) return null
  const first = getter(items[0])
  return items.every((item) => getter(item) === first) ? first : null
}

export function runWorkoutOverview(sets = []) {
  const presented = runStepPresentation(sets)
  const rows = sets.map((set, index) => ({ set, view: presented[index] }))
  const work = rows.filter(({ set }) => set.stepType === 'work')
  const recoveries = rows.filter(({ set }) => set.stepType === 'recovery')
  const entries = []

  const addSingles = (type, label) => {
    rows.filter(({ set }) => set.stepType === type).forEach(({ view }) => {
      entries.push({ label, value: view.quantity, detail: null })
    })
  }

  addSingles('warmup', 'Warm-up')

  if (work.length) {
    const quantity = matchingValue(work, ({ view }) => view.quantity)
    const target = matchingValue(work, ({ view }) => view.target)
    const rpe = matchingValue(work, ({ view }) => view.rpe)
    entries.push({
      label: 'Main set',
      value: quantity ? (work.length > 1 ? `${work.length} × ${quantity}` : quantity) : `${work.length} repetitions`,
      detail: [target, rpe].filter(Boolean).join(' · ') || null,
    })
  }

  if (recoveries.length) {
    const quantity = matchingValue(recoveries, ({ view }) => view.quantity)
    entries.push({
      label: 'Recovery',
      value: quantity ? `${quantity} easy${recoveries.length > 1 || work.length > 1 ? ' between reps' : ''}` : 'Easy between reps',
      detail: null,
    })
  }

  addSingles('easy', 'Easy running')
  addSingles('cooldown', 'Cool-down')
  return entries
}

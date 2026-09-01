import { formatRunQuantity, formatRunTarget } from './runPrescriptionPresentation.js'

const RANGE_SEPARATOR = '–'

function sameValue(items, getter) {
  if (!items.length) return null
  const first = getter(items[0])
  return items.every((item) => getter(item) === first) ? first : null
}

function compactBikePower(value) {
  return value?.replace(
    /^(\d+(?:\.\d+)?)\s*W\s*[–-]\s*(\d+(?:\.\d+)?)\s*W$/,
    `$1${RANGE_SEPARATOR}$2 W`,
  ) ?? null
}

export function formatBikeTarget(value) {
  const parsed = formatRunTarget(value)
  return { ...parsed, target: compactBikePower(parsed.target) }
}

function bikeLabel(set, workIndex, workCount) {
  switch (set?.stepType) {
    case 'warmup': return 'Warm-up'
    case 'cooldown': return 'Cool-down'
    case 'recovery': return 'Recovery spin'
    case 'easy': return 'Easy riding'
    case 'work':
      if (workCount > 1) return `Rep ${workIndex} of ${workCount}`
      return /easy/i.test(set.exercise ?? '') ? 'Easy riding' : 'Main effort'
    default: return set?.exercise || 'Bike step'
  }
}

export function bikeStepPresentation(sets = []) {
  const workCount = sets.filter((set) => set.stepType === 'work').length
  let workIndex = 0
  return sets.map((set) => {
    if (set.stepType === 'work') workIndex += 1
    return {
      label: bikeLabel(set, workIndex, workCount),
      quantity: formatRunQuantity(set),
      ...formatBikeTarget(set.paceOrPower),
    }
  })
}

function addSingleSteps(entries, rows, type, label) {
  rows.filter(({ set }) => set.stepType === type).forEach(({ view }) => {
    entries.push({ label, value: view.quantity, detail: null })
  })
}

export function bikeWorkoutOverview(sets = []) {
  const views = bikeStepPresentation(sets)
  const rows = sets.map((set, index) => ({ set, view: views[index] }))
  const work = rows.filter(({ set }) => set.stepType === 'work')
  const recovery = rows.filter(({ set }) => set.stepType === 'recovery')
  const entries = []

  addSingleSteps(entries, rows, 'warmup', 'Warm-up')
  if (work.length) {
    const quantity = sameValue(work, ({ view }) => view.quantity)
    const target = sameValue(work, ({ view }) => view.target)
    const rpe = sameValue(work, ({ view }) => view.rpe)
    const easy = work.length === 1 && /easy/i.test(work[0].set.exercise ?? '')
    entries.push({
      label: easy ? 'Easy riding' : 'Main set',
      value: quantity ? (work.length > 1 ? `${work.length} × ${quantity}` : quantity) : `${work.length} repetitions`,
      detail: [target, rpe].filter(Boolean).join(' · ') || null,
    })
  }
  if (recovery.length) {
    const quantity = sameValue(recovery, ({ view }) => view.quantity)
    entries.push({ label: 'Recovery', value: quantity ? `${quantity} easy between reps` : 'Easy between reps', detail: null })
  }
  addSingleSteps(entries, rows, 'easy', 'Easy riding')
  addSingleSteps(entries, rows, 'cooldown', 'Cool-down')
  return entries
}

function compactSwimPace(value) {
  return value?.replace(
    /^(\d+:\d{2})\/100m\s*[–-]\s*(\d+:\d{2})\/100m$/,
    `$1${RANGE_SEPARATOR}$2/100 m`,
  ) ?? null
}

export function formatSwimTarget(value, drill = false) {
  const parsed = formatRunTarget(value)
  return {
    target: drill ? 'Easy technique' : compactSwimPace(parsed.target),
    rpe: parsed.rpe,
  }
}

export function formatStepRest(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const range = text.match(/^(\d+)\s*[–-]\s*(\d+)s after each 50m$/i)
  if (range) return `${range[1]}${RANGE_SEPARATOR}${range[2]} sec rest`
  const between = text.match(/^(\d+)s between repetitions$/i)
  if (between) return `${between[1]} sec rest`
  return text
}

function swimLabel(set) {
  switch (set?.stepType) {
    case 'warmup': return 'Warm-up'
    case 'cooldown': return 'Cool-down'
    case 'recovery': return 'Recovery'
    case 'easy': return 'Easy swim'
    case 'work': return 'Main set'
    case 'drill': return set.exercise || 'Technique drill'
    default: return set?.exercise || 'Swim step'
  }
}

export function swimStepPresentation(sets = []) {
  return sets.map((set) => {
    const drill = set.stepType === 'drill'
    const target = formatSwimTarget(set.paceOrPower, drill)
    const rest = formatStepRest(set.rest)
    const structure = drill ? '25 m drill + 25 m easy' : null
    const note = drill
      ? String(set.notes ?? '').replace(/^Each repetition is 25m drill \+ 25m easy full-stroke transfer\.\s*/i, '') || null
      : set.notes ?? null
    return {
      label: swimLabel(set),
      quantity: formatRunQuantity(set),
      ...target,
      details: [structure, target.target, target.rpe, rest].filter(Boolean),
      note,
    }
  })
}

export function swimWorkoutOverview(sets = []) {
  const views = swimStepPresentation(sets)
  const rows = sets.map((set, index) => ({ set, view: views[index] }))
  const entries = []
  addSingleSteps(entries, rows, 'warmup', 'Warm-up')

  const drills = rows.filter(({ set }) => set.stepType === 'drill')
  if (drills.length) {
    const distance = sameValue(drills, ({ set }) => set.distanceM)
    const repetitions = drills.reduce((sum, { set }) => sum + (set.setsCount ?? 1), 0)
    const total = drills.reduce((sum, { set }) => sum + (set.distanceM ?? 0) * (set.setsCount ?? 1), 0)
    entries.push({
      label: 'Technique',
      value: distance ? `${repetitions} × ${distance} m` : `${total.toLocaleString()} m`,
      detail: `${drills.length} drill${drills.length === 1 ? '' : 's'}`,
    })
  }

  rows.filter(({ set }) => set.stepType === 'work').forEach(({ set, view }) => {
    entries.push({
      label: 'Main set',
      value: view.quantity,
      detail: [view.target, view.rpe, formatStepRest(set.rest)].filter(Boolean).join(' · ') || null,
    })
  })
  addSingleSteps(entries, rows, 'easy', 'Easy swim')
  addSingleSteps(entries, rows, 'cooldown', 'Cool-down')
  return entries
}

export function gymStepPresentation(sets = []) {
  return sets.map((set) => {
    const count = Number.isInteger(set.setsCount) && set.setsCount > 0 ? set.setsCount : null
    const work = set.reps != null ? `${set.reps} reps` : set.duration || null
    return {
      label: set.exercise || 'Exercise',
      quantity: count && work ? `${count} × ${work}` : work || (count ? `${count} sets` : null),
      details: [formatStepRest(set.rest)].filter(Boolean),
    }
  })
}

export function gymWorkoutSummary(session) {
  const p = session?.strengthPrescription
  if (!p) return null
  const exerciseCount = session.sets?.length || p.exerciseSlots?.length || 0
  const sameSets = p.workSetsMin === p.coreSets
  const setText = sameSets ? `${p.workSetsMin} sets each` : `${p.workSetsMin} work sets · ${p.coreSets} core sets`
  return {
    metrics: [
      `${p.durationMinutes} min`,
      `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`,
      setText,
      `RPE ≤ ${p.maxEffort}`,
    ],
    note: p.coreFinisherRequired ? 'Core finisher included' : null,
  }
}

export function brickStepPresentation(sets = []) {
  return sets.map((set) => {
    const bike = set.discipline === 'bike'
    const target = bike ? formatBikeTarget(set.paceOrPower) : formatRunTarget(set.paceOrPower)
    return {
      label: bike ? 'Bike leg' : set.discipline === 'run' ? 'Run leg' : set.exercise || 'Brick step',
      quantity: formatRunQuantity(set),
      ...target,
    }
  })
}

export function brickWorkoutOverview(sets = []) {
  const views = brickStepPresentation(sets)
  return views.map((view) => ({
    label: view.label,
    value: view.quantity,
    detail: [view.target, view.rpe].filter(Boolean).join(' · ') || null,
  }))
}

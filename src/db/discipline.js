import { Waves, Bike, Footprints, Flame, Dumbbell, BedDouble, Star } from 'lucide-react'

// Matches PLAN_SCHEMA.md §2 exactly — do not add/rename a case without
// updating the schema doc and the importer together.
export const DISCIPLINES = ['swim', 'bike', 'run', 'brick', 'gym', 'rest', 'other']

export const DISCIPLINE_META = {
  swim: { displayName: 'Swim', icon: Waves, chartColor: 'var(--color-disc-swim)' },
  bike: { displayName: 'Bike', icon: Bike, chartColor: 'var(--color-disc-bike)' },
  run: { displayName: 'Run', icon: Footprints, chartColor: 'var(--color-disc-run)' },
  brick: { displayName: 'Brick', icon: Flame, chartColor: 'var(--color-disc-brick)' },
  gym: { displayName: 'Gym', icon: Dumbbell, chartColor: 'var(--color-disc-gym)' },
  rest: { displayName: 'Rest', icon: BedDouble, chartColor: 'var(--color-disc-rest)' },
  other: { displayName: 'Other', icon: Star, chartColor: 'var(--color-disc-other)' },
}

export function normalizeDiscipline(raw) {
  const tag = String(raw ?? '').trim().toLowerCase()
  return DISCIPLINES.includes(tag) ? tag : null
}

export function disciplineDisplayName(d) {
  return DISCIPLINE_META[d]?.displayName ?? DISCIPLINE_META.other.displayName
}

export function disciplineIcon(d) {
  return DISCIPLINE_META[d]?.icon ?? DISCIPLINE_META.other.icon
}

export function disciplineColor(d) {
  return DISCIPLINE_META[d]?.chartColor ?? DISCIPLINE_META.other.chartColor
}

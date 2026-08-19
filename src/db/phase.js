// Matches PLAN_SCHEMA.md §3's six governed phase names exactly.
export const PHASES = ['buildUp', 'endurance', 'peak', 'taper', 'recovery', 'maintenance']

export const PHASE_META = {
  buildUp: { displayName: 'Build-Up', color: 'var(--color-phase-buildup)' },
  endurance: { displayName: 'Endurance', color: 'var(--color-phase-endurance)' },
  peak: { displayName: 'Peak', color: 'var(--color-phase-peak)' },
  taper: { displayName: 'Taper', color: 'var(--color-phase-taper)' },
  recovery: { displayName: 'Recovery', color: 'var(--color-phase-recovery)' },
  maintenance: { displayName: 'Maintenance', color: 'var(--color-phase-maintenance)' },
}

export function phaseDisplayName(p) {
  return PHASE_META[p]?.displayName ?? PHASE_META.maintenance.displayName
}

export function phaseColor(p) {
  return PHASE_META[p]?.color ?? PHASE_META.maintenance.color
}

/** Case/spacing/punctuation-insensitive match against the free-text
 * `phase` field a plan's session JSON can carry — "Build up", "BUILD-UP",
 * "build_up" all resolve to "buildUp". Returns null for anything
 * unrecognized (including missing/empty), same as native's
 * `TrainingPhase.parse`. */
export function parsePhase(raw) {
  if (!raw) return null
  const normalized = String(raw).toLowerCase().replace(/[^a-z]/g, '')
  if (!normalized) return null
  const match = {
    buildup: 'buildUp',
    endurance: 'endurance',
    peak: 'peak',
    taper: 'taper',
    recovery: 'recovery',
    maintenance: 'maintenance',
  }
  return match[normalized] ?? null
}

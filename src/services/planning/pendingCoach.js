import { fitnessFingerprint } from './fitness.js'
import { COACH_PROTOCOL } from './coachProtocol.js'
const key = 'cadence:pending-coach:v1'
const browserStore = () => typeof window === 'undefined' ? null : window.localStorage
export function readPendingCoach(profile, storage) {
  try {
    const saved = JSON.parse((storage ?? browserStore())?.getItem(key) ?? 'null')
    return saved?.skeleton?.version >= 5 && typeof saved.prompt === 'string' && saved.prompt.includes(`CONTRACT ${COACH_PROTOCOL};`)
      && saved.skeleton.endurancePlan?.fingerprint === fitnessFingerprint(profile) ? saved : null
  } catch { return null }
}
export function savePendingCoach(plan, storage) {
  try { const store = storage ?? browserStore(); if (!store) return false; store.setItem(key, JSON.stringify(plan)); return true } catch { return false }
}
export function clearPendingCoach(storage) {
  try { (storage ?? browserStore())?.removeItem(key) } catch { /* Private storage may be unavailable. */ }
}

import { newSet } from '../db/session.js'

// Keep drafts as strings; only convert at the save boundary.
export function parseDecimal(value) {
  const text = String(value ?? '').trim().replace(',', '.')
  if (!text) return null
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return NaN
  const number = Number(text)
  return Number.isFinite(number) ? number : NaN
}

export function appendAthleteStep(session, step) {
  if (!step.exercise?.trim()) throw new Error('Enter an exercise or step name.')
  const sets = [...(session.sets ?? []), newSet({ ...step, exercise: step.exercise.trim(), athleteAdded: true })]
  return { sets, isCompleted: sets.every(s => s.isCompleted && !s.isSkipped),
    ...(session.endurancePrescription ? { prescriptionEdited: true, workoutResult: null } : {}) }
}

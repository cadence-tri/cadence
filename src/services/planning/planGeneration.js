import { buildPlanSkeleton } from './planScheduler'
import { validateSkeleton } from './planValidator'
import { buildCheckInPrompt } from '../planPromptBuilder'

export function preparePlanGeneration({ profile, recentSessions, planHistory = recentSessions, weekPhases, checkIn, capacityWarningText, today = new Date() }) {
  const skeleton = buildPlanSkeleton({ profile, recentSessions, planHistory, weekPhases, checkIn, today })
  const validation = validateSkeleton(skeleton, profile)
  if (validation.errors.length) {
    const error = new Error(`Cadence could not build a safe schedule:\n${validation.errors.map((x) => `• ${x}`).join('\n')}`)
    error.validation = validation
    throw error
  }
  const prompt = buildCheckInPrompt({
    profile,
    recentSessions,
    weekPhases,
    athleteNote: checkIn?.note ?? '',
    capacityWarningText,
    skeleton,
    checkIn,
  })
  return { skeleton, prompt, validationContext: { skeletonVersion: skeleton.version } }
}

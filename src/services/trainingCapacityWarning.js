import { RUNNING_META, TRIATHLON_META } from '../db/raceDistance'

/** Returns null when `trainingDaysPerWeek` meets or exceeds the distance's
 * recommended minimum — i.e. nothing to warn about. Ported from
 * Services/TrainingCapacityWarning.swift. */
export function capacityWarningMessage({ sport, runningDistance, triathlonDistance, trainingDaysPerWeek }) {
  const meta = sport === 'running' ? RUNNING_META[runningDistance] : TRIATHLON_META[triathlonDistance]
  if (!meta) return null
  const minDays = meta.minTrainingDaysPerWeek
  if (trainingDaysPerWeek >= minDays) return null
  const daysText = trainingDaysPerWeek === 1 ? '1 day' : `${trainingDaysPerWeek} days`
  return `You're preparing for ${meta.article}, but you can only train ${daysText} a week. It's going to be tough, but we can still try. Do you want to continue, or change the number of training days per week?`
}

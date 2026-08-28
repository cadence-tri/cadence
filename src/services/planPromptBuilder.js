import schemaText from '../assets/PLAN_SCHEMA.md?raw'
import { RUNNING_META, TRIATHLON_META } from '../db/raceDistance'
import { setSummary } from '../db/session'
import { phaseDisplayName } from '../db/phase'
import { phaseForDate } from '../db/weekPhase'
import { disciplineDisplayName } from '../db/discipline'
import { addDays, asDate, startOfDay, weeksBetween } from './dateUtils'
import { format } from 'date-fns'

/** Snaps `date` forward to the Monday on or after it (start-of-day). Every
 * 2-week block is Monday-to-Sunday, per PLAN_SCHEMA.md. */
export function snappedToMonday(date) {
  const day = startOfDay(date)
  // getDay(): 0=Sun...6=Sat. Monday-first offset:
  const jsDay = day.getDay()
  const daysUntilMonday = (8 - jsDay) % 7 // 0 if already Monday
  return addDays(day, daysUntilMonday)
}

const abbrevDate = (d) => format(d, 'MMM d, yyyy')

/** Renders a block of sessions as compact, human-readable text so Claude
 * sees completion state and per-session feedback, not just what was
 * originally prescribed. */
export function serializeSessions(sessions) {
  const lines = []
  for (const session of sessions) {
    const d = asDate(session.date)
    lines.push(`${format(d, 'EEEE dd.MM')} — ${disciplineDisplayName(session.discipline)}: ${session.title}`)
    if (!session.sets || session.sets.length === 0) {
      lines.push(`  ${session.isCompleted ? '[done]' : '[not completed]'}`)
    } else {
      for (const set of session.sets) {
        const status = set.isCompleted ? '[done]' : set.isSkipped ? '[skipped]' : '[not completed]'
        lines.push(`  ${status} ${setSummary(set)}`)
      }
    }
    if (session.athleteFeedback) lines.push(`  feedback: ${session.athleteFeedback}`)
    if (session.notes) lines.push(`  notes: ${session.notes}`)
  }
  return lines.length ? lines.join('\n') : '(no prior sessions logged yet)'
}

export function targetLine(profile) {
  if (profile.sport === 'running') {
    const meta = RUNNING_META[profile.runningDistance]
    const goal = (profile.goalOverallTime ?? '').trim()
    const goalText = goal ? `goal finish time ${goal}` : "no goal time set — use §7's fallback pacing"
    return `Target race: ${meta.displayName} (${meta.distanceKm}km), ${goalText}.`
  }
  const meta = TRIATHLON_META[profile.triathlonDistance]
  const overall = (profile.goalOverallTime ?? '').trim()
  const swim = (profile.goalSwimTime ?? '').trim()
  const bike = (profile.goalBikeTime ?? '').trim()
  const run = (profile.goalRunTime ?? '').trim()
  const goalParts = []
  goalParts.push(overall ? `overall goal ${overall}` : "no overall goal set — use §7's fallback pacing")
  if (swim) goalParts.push(`swim split goal ${swim}`)
  if (bike) goalParts.push(`bike split goal ${bike}`)
  if (run) goalParts.push(`run split goal ${run}`)
  const legsText = `swim ${meta.legs.swim}km / bike ${meta.legs.bike}km / run ${meta.legs.run}km`
  return `Target race: ${meta.displayName} triathlon (${legsText}); ${goalParts.join(', ')}.`
}

export function availabilityLine(profile, capacityWarningText) {
  const base = `Can train ${profile.trainingDaysPerWeek} day(s) per week (a day can still carry two sessions, e.g. run + gym, swim + gym, or a brick).`
  if (!capacityWarningText) return base
  return (
    base +
    " Note: this is below the recommended minimum for this distance (the athlete was already warned and chose to continue) — compress volume into the available days per §7.5 rather than adding training days I don't have."
  )
}

export function longSessionDatesLine(profile, blockStart) {
  const longDays = profile.longSessionDays ?? []
  if (longDays.length === 0) {
    return 'No specific higher-time days marked — spread session structure evenly across the week per §7.5\'s default.'
  }
  const matchingDates = []
  for (let offset = 0; offset < 14; offset++) {
    const date = addDays(blockStart, offset)
    const jsDay = date.getDay()
    const weekdayValue = jsDay === 0 ? 1 : jsDay + 1 // matches WEEKDAYS_MON_FIRST convention
    if (longDays.includes(weekdayValue)) matchingDates.push(date)
  }
  const datesText = matchingDates.map((d) => format(d, 'EEEE dd.MM')).join(', ')
  return `Higher-time days in this block (schedule double sessions or the longest single sessions — long runs, long rides, bricks — on these, keep other days lighter/shorter per §7.5): ${datesText}.`
}

export function disciplineLine(profile) {
  if (profile.sport === 'running') {
    return 'Discipline scope: running only. Do not include any swim or bike sessions — running, gym/strength & conditioning, and rest days only, per §7.6.'
  }
  return 'Discipline scope: full triathlon (swim, bike, run). Include at least one brick session per week per §7.6, plus gym/strength & conditioning and rest days.'
}

/** Renders the athlete's onboarding answers (injury history, running/tri
 * background, gym preference, freeform notes) as prompt lines. Read from
 * the profile — not from wizard-local state — so this context survives
 * and keeps informing every future 2-week generation, not just the very
 * first one. Any unanswered question is simply omitted rather than
 * printed as a blank/placeholder line. */
export function athleteBackgroundLines(profile) {
  const lines = []

  if (profile.onboardingInjury?.trim()) {
    lines.push(`Injury history: ${profile.onboardingInjury.trim()}.`)
  } else if (profile.onboardingCompleted) {
    lines.push('Injury history: none reported.')
  }

  if (profile.onboardingAlreadyRuns === true) {
    const pace = profile.onboardingCurrentRacePace?.trim()
    lines.push(`Already running before starting this plan${pace ? `, current race pace: ${pace}` : ' (no current race pace given)'}.`)
  } else if (profile.onboardingAlreadyRuns === false) {
    lines.push('New to running — build up run volume/intensity conservatively rather than assuming an existing base.')
  }

  if (profile.sport === 'triathlon') {
    if (profile.onboardingTriPriorExperience === true) {
      lines.push(`Has completed triathlon(s) before: ${profile.onboardingTriExperienceDetails?.trim() || '(no further details given)'}.`)
    } else if (profile.onboardingTriPriorExperience === false) {
      const parts = []
      if (profile.onboardingSwimFitness?.trim()) parts.push(`swim — ${profile.onboardingSwimFitness.trim()}`)
      if (profile.onboardingBikeFitness?.trim()) parts.push(`bike — ${profile.onboardingBikeFitness.trim()}`)
      if (profile.onboardingRunFitness?.trim()) parts.push(`run — ${profile.onboardingRunFitness.trim()}`)
      lines.push(`This will be their first triathlon. Self-assessed current fitness: ${parts.length ? parts.join('; ') : 'not specified'}.`)
    }
  }

  // Physiology baseline
  const physiologyParts = []
  if (profile.onboardingAge?.trim()) physiologyParts.push(`age ${profile.onboardingAge.trim()}`)
  if (profile.onboardingWeightKg?.trim()) physiologyParts.push(`body weight ${profile.onboardingWeightKg.trim()}kg`)
  if (physiologyParts.length) lines.push(`Physiology: ${physiologyParts.join(', ')}.`)

  if (profile.onboardingKnowsHeartRate === true) {
    const resting = profile.onboardingRestingHR?.trim()
    const max = profile.onboardingMaxHR?.trim()
    const hrParts = []
    if (resting) hrParts.push(`resting HR ${resting}bpm`)
    if (max) hrParts.push(`max HR ${max}bpm`)
    lines.push(`Heart rate: ${hrParts.length ? hrParts.join(', ') : 'known but not specified'} — anchor Z2/Z3 zones off this rather than pace-only estimates where useful.`)
  }

  if (profile.onboardingKnowsThreshold === true && profile.onboardingThresholdDetails?.trim()) {
    lines.push(`Known threshold numbers: ${profile.onboardingThresholdDetails.trim()} — use this to anchor threshold/FTP-based prescriptions instead of estimating from goal time alone.`)
  }

  // Equipment & access
  if (profile.sport === 'triathlon') {
    if (profile.onboardingBikeSetup?.trim()) {
      lines.push(`Bike training setup: ${profile.onboardingBikeSetup.trim()}${profile.onboardingBikeSetup.includes('power meter') ? ' — power-based prescriptions are usable.' : ' — avoid prescribing power targets that need a meter they don\u2019t have.'}`)
    }
    const poolDays = profile.onboardingPoolDaysPerWeek?.trim()
    if (poolDays) {
      lines.push(`Pool access: about ${poolDays} day(s)/week${profile.onboardingOpenWaterAccess === true ? ', plus open water access in season' : profile.onboardingOpenWaterAccess === false ? ', no open water access' : ''}.`)
    }
  }

  if (profile.onboardingTerrain?.trim()) {
    lines.push(`Typical training terrain: ${profile.onboardingTerrain.trim()}${profile.onboardingTreadmillAccess === true ? ', with treadmill access for bad weather' : ''}.`)
  }

  // Lifestyle
  const lifestyleParts = []
  if (profile.onboardingJobType?.trim()) lifestyleParts.push(`job: ${profile.onboardingJobType.trim()}`)
  if (profile.onboardingSleepHours?.trim()) lifestyleParts.push(`typical sleep: ~${profile.onboardingSleepHours.trim()}h/night`)
  if (profile.onboardingPreferredTrainingTime?.trim()) lifestyleParts.push(`prefers training in the ${profile.onboardingPreferredTrainingTime.trim().toLowerCase()}`)
  if (lifestyleParts.length) lines.push(`Lifestyle: ${lifestyleParts.join('; ')} — factor this into recovery expectations and session placement.`)

  // Ongoing medical (distinct from past injury history above)
  if (profile.onboardingOngoingConditions === true && profile.onboardingOngoingConditionsDetails?.trim()) {
    lines.push(`Ongoing condition(s) to actively manage: ${profile.onboardingOngoingConditionsDetails.trim()}.`)
  }

  // Experience & adherence
  const experienceParts = []
  if (profile.onboardingPriorStructuredPlan === true) experienceParts.push('has followed a structured training plan before')
  else if (profile.onboardingPriorStructuredPlan === false) experienceParts.push('has never followed a structured training plan before — keep early instructions extra clear')
  if (profile.onboardingConsistencyRating?.trim()) experienceParts.push(`self-rated consistency: ${profile.onboardingConsistencyRating.trim()}`)
  if (experienceParts.length) lines.push(`Training experience: ${experienceParts.join('; ')}.`)

  if (profile.onboardingAdditionalInfo?.trim()) {
    lines.push(`Additional context from the athlete: ${profile.onboardingAdditionalInfo.trim()}.`)
  }

  return lines
}

/** The gym/S&C rule bullet — overrides the normal "always include S&C"
 * default when the athlete has opted out (Profile toggle or onboarding
 * question), and swaps in "bodyweight-only" phrasing when that's their
 * stated preference. */
export function gymRuleBullet(profile) {
  if (!profile.excludeGymSessions) {
    return 'Every week includes at least one clear rest day, some mobility/stretching, and strength & conditioning worked in on my existing gym pattern — even for a running-only plan, per §7.6, S&C still stays in.'
  }
  if (profile.bodyweightOnlyStrength) {
    return 'Every week includes at least one clear rest day and some mobility/stretching. The athlete has opted out of gym/weighted strength training — replace it entirely with bodyweight-only strength & conditioning (no equipment, or minimal/home equipment) in every week of the plan; never schedule a weighted gym session.'
  }
  return 'Every week includes at least one clear rest day and some mobility/stretching. The athlete has opted out of gym/strength training entirely — do NOT include any gym or strength & conditioning sessions anywhere in this plan, for any week.'
}

/** Computes a deterministic Beginner/Intermediate/Advanced tier from
 * onboarding signals (§7.7 in PLAN_SCHEMA.md). Computed here — once, by
 * the app — rather than left for whatever AI model reads the prompt to
 * guess at, so the tier stays stable across different tools/models
 * generating different blocks for the same athlete. `recentSessions` is
 * only used to flag when a real log already exists, since §7.7 says log
 * evidence should lead once there's enough of it — this function doesn't
 * try to read fitness level out of the log itself, that's §7.3's job. */
export function computeExperienceTier(profile, recentSessions = []) {
  let beginnerPoints = 0
  let advancedPoints = 0
  const reasons = []
  const isTri = profile.sport === 'triathlon'
  const disciplinePriorExperience = isTri ? profile.onboardingTriPriorExperience : profile.onboardingAlreadyRuns

  if (profile.onboardingPriorStructuredPlan === false) {
    beginnerPoints++
    reasons.push('never followed a structured training plan before')
  } else if (profile.onboardingPriorStructuredPlan === true) {
    advancedPoints++
    reasons.push('has followed a structured training plan before')
  }

  if (profile.onboardingConsistencyRating === 'Not tested yet' || profile.onboardingConsistencyRating === 'I struggle with consistency') {
    beginnerPoints++
    reasons.push(`self-rated consistency: "${profile.onboardingConsistencyRating}"`)
  } else if (profile.onboardingConsistencyRating === 'Very consistent') {
    advancedPoints++
    reasons.push('self-rated consistency: "Very consistent"')
  }

  if (disciplinePriorExperience === false) {
    beginnerPoints++
    reasons.push(isTri ? 'no prior triathlon completed' : 'new to running')
  } else if (disciplinePriorExperience === true) {
    advancedPoints++
    reasons.push(isTri ? 'has completed triathlon(s) before' : 'already running before this plan')
  }

  const hasKnownNumbers = profile.onboardingKnowsThreshold === true || (profile.onboardingAlreadyRuns === true && !!profile.onboardingCurrentRacePace?.trim())
  if (hasKnownNumbers) {
    advancedPoints++
    reasons.push('has known threshold/FTP or current race pace numbers')
  }

  const tier = beginnerPoints > advancedPoints ? 'Beginner' : advancedPoints > beginnerPoints ? 'Advanced' : 'Intermediate'
  const hasSubstantialLog = recentSessions.length >= 15

  return { tier, reasons, hasSubstantialLog }
}

/** Renders the computed experience tier as a binding prompt line — see
 * §7.7. Falls back to Intermediate (the document's stated default) when
 * onboarding hasn't been completed yet, since there's nothing to derive
 * a tier from. */
export function experienceTierLine(profile, recentSessions) {
  if (!profile.onboardingCompleted) {
    return "Experience tier: Intermediate (per §7.7's default — onboarding wasn't completed, so there are no self-reported signals to derive a tier from). Apply §7.7's Intermediate modifiers."
  }
  const { tier, reasons, hasSubstantialLog } = computeExperienceTier(profile, recentSessions)
  const reasonText = reasons.length ? ` Based on: ${reasons.join('; ')}.` : ' No strong signals either way — defaulting to Intermediate.'
  const logNote = hasSubstantialLog
    ? " A meaningful training log already exists — per §7.7, let demonstrated capacity (§7.3) lead over this tier where the two disagree."
    : ''
  return `Experience tier: ${tier} (per §7.7).${reasonText} Apply §7.7's ${tier} modifiers (weekly increase cap, rest-day minimum, quality-session cap, cueing detail) to this block.${logNote}`
}

/** Binding injury/ongoing-condition adaptation instruction — see §7.8.
 * Returns null (omit entirely) when nothing was reported, so the prompt
 * doesn't carry a hollow "no adaptation needed" line for every athlete. */
export function injuryAdaptationLine(profile) {
  const hasPastInjury = !!profile.onboardingInjury?.trim()
  const hasOngoing = profile.onboardingOngoingConditions === true && !!profile.onboardingOngoingConditionsDetails?.trim()
  if (!hasPastInjury && !hasOngoing) return null
  const parts = []
  if (hasPastInjury) parts.push(`past injury noted: ${profile.onboardingInjury.trim()}`)
  if (hasOngoing) parts.push(`ongoing condition to actively manage: ${profile.onboardingOngoingConditionsDetails.trim()}`)
  return `Injury/condition adaptation required (§7.8) — ${parts.join('; ')}. This is binding, not just background: bias progression conservatively around the affected area/discipline, avoid movements that plausibly aggravate an ongoing condition, and state in this block's Notes what was avoided or adjusted and why.`
}

/** Binding lifestyle recovery bias — see §7.9. Returns null (omit) only
 * when neither job type nor sleep hours were reported at all; otherwise
 * always states the applicable bias (including the explicit "no bias
 * needed" case), since that's still useful confirmation for the coach. */
export function lifestyleRecoveryBiasLine(profile) {
  const jobType = profile.onboardingJobType?.trim()
  const sleepHours = parseFloat(profile.onboardingSleepHours)
  if (!jobType && Number.isNaN(sleepHours)) return null

  const physicallyDemanding = jobType === 'Physically active job'
  const lowSleep = !Number.isNaN(sleepHours) && sleepHours < 6.5

  if (physicallyDemanding || lowSleep) {
    const reasons = []
    if (physicallyDemanding) reasons.push('physically active job')
    if (lowSleep) reasons.push(`reported sleep ~${profile.onboardingSleepHours.trim()}h/night`)
    return `Lifestyle recovery bias (§7.9): ${reasons.join(', ')} — bias toward the lower half of §7.1's volume range this block, and avoid stacking a hard training day on top of a demanding work day where the schedule suggests that's a regular pattern.`
  }
  return "Lifestyle recovery bias (§7.9): no adjustment needed — reported job type/sleep look typical, use the tier-appropriate default within §7.1's range."
}


/** A single self-contained block of text, ready to paste straight into a
 * Claude chat. Ported from `PlanPromptBuilder.buildCheckInPrompt`. */
export function buildCheckInPrompt({ profile, recentSessions, weekPhases, athleteNote, capacityWarningText }) {
  const schema = schemaText
  const isFirstPlan = recentSessions.length === 0
  const lastLoggedDate = isFirstPlan
    ? startOfDay(new Date())
    : recentSessions.reduce((max, s) => {
        const d = asDate(s.date)
        return !max || d > max ? d : max
      }, null)

  // Every 2-week block is normally Monday-to-Sunday, continuing straight
  // on from the last logged day. But for a brand-new athlete with an
  // empty log, "snap forward to the next Monday" would silently skip
  // whatever's left of the current week — if someone starts the app on a
  // Thursday, they shouldn't have to wait until next Monday to get a
  // plan. So the very first plan gets an extra partial stretch (today
  // through the Sunday right before the first full Monday) ahead of the
  // normal 2 full weeks, unless today already IS a Monday.
  let nextBlockStart
  let partialStart = null
  let partialEnd = null
  if (isFirstPlan) {
    const today = startOfDay(new Date())
    nextBlockStart = snappedToMonday(today)
    if (nextBlockStart > today) {
      partialStart = today
      partialEnd = addDays(nextBlockStart, -1)
    }
  } else {
    const dayAfterLast = addDays(lastLoggedDate, 1)
    nextBlockStart = snappedToMonday(dayAfterLast)
  }
  const blockEnd = addDays(nextBlockStart, 13)
  const week1End = addDays(nextBlockStart, 6)
  const raceCalcAnchor = partialStart ?? nextBlockStart

  let raceLine = "No specific competition date is set on the athlete's profile."
  if (profile.competitionDate) {
    const compDate = asDate(profile.competitionDate)
    const weeksOut = weeksBetween(raceCalcAnchor, compDate)
    const name = profile.competitionName || 'the target event'
    raceLine = `Racing ${name} on ${abbrevDate(compDate)} — ${weeksOut} week(s) out from the start of this new block.`
  }

  let currentPhase = phaseDisplayName(phaseForDate(weekPhases, lastLoggedDate))
  if (isFirstPlan) {
    currentPhase = "N/A — this is the athlete's very first training block, so start at Build-Up."
  } else if (profile.trainingBlockStartDate && asDate(profile.trainingBlockStartDate) > lastLoggedDate) {
    currentPhase =
      'N/A — the athlete just started a new training block (changed target race distance/discipline), so begin this block at Build-Up regardless of whatever phase was logged before the change.'
  }

  const target = targetLine(profile)
  const availability = availabilityLine(profile, capacityWarningText)
  const longSessions = longSessionDatesLine(profile, nextBlockStart)
  const scope = disciplineLine(profile)
  const background = athleteBackgroundLines(profile)
  const gymRule = gymRuleBullet(profile)
  const tierLine = experienceTierLine(profile, recentSessions)
  const injuryLine = injuryAdaptationLine(profile)
  const lifestyleLine = lifestyleRecoveryBiasLine(profile)

  const rangeBullet = partialStart
    ? `- This is the athlete's very first plan and today (${abbrevDate(partialStart)}) falls mid-week, so ALSO generate an initial partial stretch of days from ${abbrevDate(partialStart)} through ${abbrevDate(partialEnd)} (that Sunday) — its own dedicated week header and \`\`\`session block, scaled appropriately as a lighter introductory few days — placed BEFORE the two standard Monday-to-Sunday weeks below. Then generate EXACTLY 2 full weeks, Monday through Sunday: week 1 runs ${abbrevDate(nextBlockStart)} (Monday) through ${abbrevDate(week1End)}, and week 2 runs through ${abbrevDate(blockEnd)} (Sunday). In total this reply covers ${abbrevDate(partialStart)} through ${abbrevDate(blockEnd)} — never more, never fewer.`
    : `- Generate EXACTLY 2 weeks, Monday through Sunday: week 1 runs ${abbrevDate(nextBlockStart)} (Monday) through ${abbrevDate(week1End)}, and week 2 runs through ${abbrevDate(blockEnd)} (Sunday). Never more, never fewer, and always aligned to full Monday-to-Sunday weeks — even if the athlete's last logged session or check-in falls mid-week.`

  const openingLine = isFirstPlan
    ? "You are my coach building my very first training block, in the exact markdown+JSON format defined by the governance document below."
    : 'You are my coach generating the next 2-week block of my ongoing training plan, in the exact markdown+JSON format defined by the governance document below.'

  return `${openingLine} Follow it exactly: one \`\`\`session fenced block per week (or per partial stretch), valid JSON, phase names copied verbatim from its §3 list. This block ALSO governs how you size and pace this plan (§7) — my race distance, goal time, and weekly availability below aren't background color, they're binding targets for weekly volume, session distances, prescribed paces/power, day-by-day placement, and which disciplines appear at all.

${schema}

Additional rules for this generation:
${rangeBullet}
- Every prescribed session must be fully explicit: exact sets/reps/distances/paces/power/rest for swim/bike/run/brick, and exact exercises with specific weights for gym. No vague placeholders like "technique + aerobic set."
- ${gymRule}
- Base exercise selection and load progression on my own historical log below, not generic defaults.
- Progress the phase sensibly (Build-Up → Endurance → Peak → Taper) based on weeks-to-race. The block just completed was: ${currentPhase}.
- Size weekly volume and derive target paces/power from my race distance and goal time below, per §7 — not from generic defaults or from what the historical log happens to show, since the log may currently be running lighter or heavier than my actual target requires.
- Fit the whole block into my actual weekly availability below (§7.5) — never schedule more training days than I have, even if the volume tables suggest more would be ideal; compress into fewer, longer, or combined (double-session/brick) days instead.
- Place double sessions and the longest single sessions (long runs, long rides, bricks) on my higher-time days listed below, and keep the other training days shorter/lighter — per §7.5.
- Respect the discipline scope below (§7.6) exactly — no swim/bike sessions for a running-only athlete, and at least one brick per week for a triathlete.
- Apply the Experience tier line below exactly (§7.7) — it sets binding caps on weekly volume increase, minimum rest days, and quality-session frequency for this block; don't substitute your own judgment about the athlete's level.${injuryLine ? `\n- ${injuryLine}` : ''}${lifestyleLine ? `\n- ${lifestyleLine}` : ''}
- Reply with ONLY the markdown for this block (week headers + prose + session blocks) — I'm going to copy your entire reply and paste it into an importer that extracts \`\`\`session blocks directly, so please skip any other preamble or closing remarks.

Athlete: ${profile.name}, training for ${profile.sport === 'running' ? 'Running' : 'Triathlon'}.
${raceLine}
${target}
${availability}
${longSessions}
${scope}
${tierLine}
${background.length ? `\nAthlete background (from onboarding — keep applying this to every block, not just the first):\n${background.join('\n')}` : ''}

My check-in note for this block:
${athleteNote?.trim() ? athleteNote.trim() : '(none — just continue the plan as progressed)'}

The block I just completed, as logged in the app (prescribed work, completion status, and any per-session feedback):

${serializeSessions(recentSessions)}

Please generate ${isFirstPlan ? 'this first block' : 'the next 2-week block'} now.`
}

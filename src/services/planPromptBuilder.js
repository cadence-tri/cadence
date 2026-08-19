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
        lines.push(`  ${set.isCompleted ? '[done]' : '[skipped]'} ${setSummary(set)}`)
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

/** A single self-contained block of text, ready to paste straight into a
 * Claude chat. Ported from `PlanPromptBuilder.buildCheckInPrompt`. */
export function buildCheckInPrompt({ profile, recentSessions, weekPhases, athleteNote, capacityWarningText }) {
  const schema = schemaText
  const lastLoggedDate =
    recentSessions.length > 0
      ? recentSessions.reduce((max, s) => {
          const d = asDate(s.date)
          return !max || d > max ? d : max
        }, null)
      : new Date()

  const dayAfterLast = addDays(lastLoggedDate, 1)
  const nextBlockStart = snappedToMonday(dayAfterLast)
  const blockEnd = addDays(nextBlockStart, 13)
  const week1End = addDays(nextBlockStart, 6)

  let raceLine = "No specific competition date is set on the athlete's profile."
  if (profile.competitionDate) {
    const compDate = asDate(profile.competitionDate)
    const weeksOut = weeksBetween(nextBlockStart, compDate)
    const name = profile.competitionName || 'the target event'
    raceLine = `Racing ${name} on ${abbrevDate(compDate)} — ${weeksOut} week(s) out from the start of this new block.`
  }

  let currentPhase = phaseDisplayName(phaseForDate(weekPhases, lastLoggedDate))
  if (profile.trainingBlockStartDate && asDate(profile.trainingBlockStartDate) > lastLoggedDate) {
    currentPhase =
      'N/A — the athlete just started a new training block (changed target race distance/discipline), so begin this block at Build-Up regardless of whatever phase was logged before the change.'
  }

  const target = targetLine(profile)
  const availability = availabilityLine(profile, capacityWarningText)
  const longSessions = longSessionDatesLine(profile, nextBlockStart)
  const scope = disciplineLine(profile)

  return `You are my coach generating the next 2-week block of my ongoing training plan, in the exact markdown+JSON format defined by the governance document below. Follow it exactly: one \`\`\`session fenced block per week, valid JSON, phase names copied verbatim from its §3 list. This block ALSO governs how you size and pace this plan (§7) — my race distance, goal time, and weekly availability below aren't background color, they're binding targets for weekly volume, session distances, prescribed paces/power, day-by-day placement, and which disciplines appear at all.

${schema}

Additional rules for this generation:
- Generate EXACTLY 2 weeks, Monday through Sunday: week 1 runs ${abbrevDate(nextBlockStart)} (Monday) through ${abbrevDate(week1End)}, and week 2 runs through ${abbrevDate(blockEnd)} (Sunday). Never more, never fewer, and always aligned to full Monday-to-Sunday weeks — even if the athlete's last logged session or check-in falls mid-week.
- Every prescribed session must be fully explicit: exact sets/reps/distances/paces/power/rest for swim/bike/run/brick, and exact exercises with specific weights for gym. No vague placeholders like "technique + aerobic set."
- Every week includes at least one clear rest day, some mobility/stretching, and strength & conditioning worked in on my existing gym pattern — even for a running-only plan, per §7.6, S&C still stays in.
- Base exercise selection and load progression on my own historical log below, not generic defaults.
- Progress the phase sensibly (Build-Up → Endurance → Peak → Taper) based on weeks-to-race. The block just completed was: ${currentPhase}.
- Size weekly volume and derive target paces/power from my race distance and goal time below, per §7 — not from generic defaults or from what the historical log happens to show, since the log may currently be running lighter or heavier than my actual target requires.
- Fit the whole block into my actual weekly availability below (§7.5) — never schedule more training days than I have, even if the volume tables suggest more would be ideal; compress into fewer, longer, or combined (double-session/brick) days instead.
- Place double sessions and the longest single sessions (long runs, long rides, bricks) on my higher-time days listed below, and keep the other training days shorter/lighter — per §7.5.
- Respect the discipline scope below (§7.6) exactly — no swim/bike sessions for a running-only athlete, and at least one brick per week for a triathlete.
- Reply with ONLY the markdown for these 2 weeks (week headers + prose + session blocks) — I'm going to copy your entire reply and paste it into an importer that extracts \`\`\`session blocks directly, so please skip any other preamble or closing remarks.

Athlete: ${profile.name}, training for ${profile.sport === 'running' ? 'Running' : 'Triathlon'}.
${raceLine}
${target}
${availability}
${longSessions}
${scope}

My check-in note for this block:
${athleteNote?.trim() ? athleteNote.trim() : '(none — just continue the plan as progressed)'}

The block I just completed, as logged in the app (prescribed work, completion status, and any per-session feedback):

${serializeSessions(recentSessions)}

Please generate the next 2-week block now.`
}

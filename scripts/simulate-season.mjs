// Pure diagnostic: synthetic completion, no database writes or external AI.
// node scripts/simulate-season.mjs [output-directory]
import fs from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlanSkeleton } from '../src/services/planning/planScheduler.js'
import { validateSkeleton, validateGeneratedPlan, mergeGeneratedWithSkeleton } from '../src/services/planning/planValidator.js'
import { parseMarkdown } from '../src/services/markdownImporter.js'
import { COACH_PROTOCOL, coachBlockId, buildCompactCoachPrompt, coachContext, packCoachContext, unpackCoachContext } from '../src/services/planning/coachProtocol.js'
import { parseImportDate, toISODateString, addDays } from '../src/services/dateUtils.js'

export const marathonProfile = (overrides = {}) => ({ id: 1, sport: 'running', runningDistance: 'marathon', triathlonDistance: 'olympic',
  competitionDate: '2027-04-25', competitionName: 'April marathon', goalOverallTime: '2:58:00',
  trainingDaysPerWeek: 6, longSessionDays: [2, 4, 1], strengthSessionsPerWeek: 2,
  excludeGymSessions: false, onboardingAlreadyRuns: true, onboardingCurrentRacePace: 'Previous marathon 3:10:00',
  trainingFitness: { run: { level: 'experienced' } }, fitnessHistory: [], ...overrides })
export function coachFixture(skeleton) {
  return { protocol: COACH_PROTOCOL, blockId: coachBlockId(skeleton), sessions: skeleton.weeks.flatMap(w => w.sessions).map((s, i) => ({
    id: `S${i + 1}`, title: s.isRace ? 'Race day' : `${s.discipline} ${s.endurancePrescription?.purpose ?? s.strengthPrescription?.focus ?? s.role}`,
    notes: 'Synthetic diagnostic fixture, not an AI coaching recommendation.',
    ...(s.strengthPrescription ? { sets: s.strengthPrescription.exerciseSlots.map(slot => ({
      slot, exercise: `${slot} fixture`, setsCount: slot === 'core' ? s.strengthPrescription.coreSets : s.strengthPrescription.workSetsMin,
      ...(slot === 'core' ? { duration: '30 seconds' } : { reps: 8 }), rest: slot === 'core' ? '30 seconds' : '90 seconds',
    })) } : {}) })) }
}
export function simulateSeason({ profile = marathonProfile(), start = '2026-08-31', feedback = 'controlled', maxBlocks = 18, checkInForBlock = () => ({}), complete = () => true } = {}) {
  let today = parseImportDate(start), history = [], phases = [], recent = []
  const blocks = [], weeks = [], errors = []
  for (let b = 0; b < maxBlocks && toISODateString(today) <= profile.competitionDate; b++) {
    const checkIn = { recovery: 'normal', previousBlockLoad: 'aboutRight', painLevel: 'none', assessment: 'offer', ...checkInForBlock(b) }
    const skeleton = buildPlanSkeleton({ profile, planHistory: history, recentSessions: recent, weekPhases: phases, checkIn, today })
    const validation = validateSkeleton(skeleton, profile)
    const reply = coachFixture(skeleton)
    const parsed = parseMarkdown(JSON.stringify(reply), history, phases, skeleton)
    const roundTrip = validateGeneratedPlan({ skeleton, sessions: parsed.decodedSessions })
    errors.push(...validation.errors, ...roundTrip.errors, ...parsed.summary.failedItems)
    const prompt = buildCompactCoachPrompt({ profile, skeleton, recentSessions: recent, checkIn })
    const context = coachContext({ profile, skeleton, recentSessions: recent, checkIn })
    assert.deepEqual(unpackCoachContext(packCoachContext(context)), context, 'Focused Coach context must survive its lossless transport codec')
    blocks.push({ block: b + 1, start: skeleton.blockStart, end: skeleton.blockEnd, promptCharacters: prompt.length,
      replyCharacters: JSON.stringify(reply).length, decisions: skeleton.endurancePlan.decisions, reviews: skeleton.endurancePlan.reviews,
      warnings: validation.warnings })
    weeks.push(...skeleton.weeks.filter(w => w.calendarStart <= profile.competitionDate))
    if (errors.length) break
    recent = mergeGeneratedWithSkeleton({ skeleton, sessions: parsed.newSessions }).map(s => {
      const done = complete(s, b), p = s.endurancePrescription
      return { ...s, isCompleted: done, sets: s.sets.map(step => ({ ...step, isCompleted: done, isSkipped: !done })),
        workoutResult: done && feedback && p?.feedbackRequired ? {
          outcome: 'asPrescribed', feel: feedback, recovery: 'asPrescribed', context: 'normal', completedReps: p.repetitions,
          recordedAt: s.date,
        } : null }
    })
    history.push(...recent)
    phases.push(...skeleton.weeks.map(w => ({ weekStart: parseImportDate(w.weekStart).toISOString(), phase: w.phase })))
    today = addDays(parseImportDate(skeleton.blockEnd), 1)
  }
  const sessions = weeks.flatMap(w => w.sessions)
  const summary = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, blocks: blocks.length, weeks: weeks.length,
    trainingSessions: sessions.filter(s => !s.isRace).length, races: sessions.filter(s => s.isRace).length,
    peakRunKm: Math.max(...weeks.map(w => w.targets.runKm ?? 0)),
    longestRunKm: Math.max(0, ...sessions.filter(s => s.role === 'long').map(s => s.targetDistanceKm)),
    assessments: sessions.filter(s => s.endurancePrescription?.purpose === 'assessment').map(s => ({ date: s.date, discipline: s.discipline, key: s.endurancePrescription.assessmentKey })),
    raceSpecific: sessions.filter(s => s.endurancePrescription?.purpose === 'raceSpecific').length,
    promptCharacters: { first: blocks[0]?.promptCharacters, maximum: Math.max(...blocks.map(b => b.promptCharacters)) }, errors }
  return { disclaimer: 'Synthetic completion/recovery only; no measured fitness invented. Not an importable backup or race prediction.', profile, start, summary, weeks, blocks }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2] ?? 'simulation-results')
  fs.mkdirSync(output, { recursive: true })
  const scenarios = {
    marathon: marathonProfile(),
    beginner: marathonProfile({ goalOverallTime: '4:30:00', onboardingAlreadyRuns: false, onboardingCurrentRacePace: '', trainingFitness: { run: { level: 'new', currentWeeklyKm: 30, longestRunKm: 12 } } }),
    intermediate: marathonProfile({ goalOverallTime: '3:45:00', trainingFitness: { run: { level: 'regular', currentWeeklyKm: 34, longestRunKm: 14 } } }),
    olympic: marathonProfile({ sport: 'triathlon', triathlonDistance: 'olympic', competitionName: 'Olympic triathlon', onboardingTriPriorExperience: true, trainingFitness: { swim: { level: 'new' }, bike: { level: 'regular' }, run: { level: 'regular' } } }),
  }
  for (const [name, profile] of Object.entries(scenarios)) {
    const result = simulateSeason({ profile })
    fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(result, null, 2))
    console.log(name, JSON.stringify(result.summary))
  }
}

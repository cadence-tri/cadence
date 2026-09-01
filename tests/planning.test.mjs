import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlanSkeleton } from '../src/services/planning/planScheduler.js'
import { validateSkeleton, validateGeneratedPlan, mergeGeneratedWithSkeleton } from '../src/services/planning/planValidator.js'
import { runningPaceTargets, parseDurationSeconds } from '../src/services/planning/planRules.js'
import { effortLabel, sessionDistanceKmForDisplay, withAllSetsCompleted } from '../src/db/session.js'
import { canonicalEnduranceSets } from '../src/services/planning/endurancePlanning.js'
// These fixtures describe local calendar dates, not UTC-midnight instants.
// Keep real instant handling covered separately; do not reinterpret old backups.
const localISO = date => new Date(`${date}T00:00:00`).toISOString()

const profile = (overrides = {}) => ({
  id: 1,
  name: 'Test athlete',
  sport: 'running',
  runningDistance: 'halfMarathon',
  triathlonDistance: 'olympic',
  trainingDaysPerWeek: 7,
  longSessionDays: [7, 1],
  competitionDate: null,
  trainingBlockStartDate: null,
  excludeGymSessions: false,
  bodyweightOnlyStrength: false,
  onboardingCompleted: true,
  onboardingPriorStructuredPlan: false,
  onboardingConsistencyRating: 'Not tested yet',
  onboardingAlreadyRuns: false,
  onboardingTriPriorExperience: null,
  onboardingKnowsThreshold: false,
  onboardingCurrentRacePace: '',
  onboardingThresholdDetails: '',
  onboardingJobType: 'Desk job (mostly sitting)',
  onboardingSleepHours: '8',
  goalOverallTime: '', goalSwimTime: '', goalBikeTime: '', goalRunTime: '',
  ...overrides,
})

const today = new Date('2026-08-28T12:00:00')
const normalCheckIn = { recovery: 'normal', painLevel: 'none', previousBlockLoad: 'aboutRight' }

test('session feedback distance switches from prescribed to completed work', () => {
  const pending = {
    discipline: 'run',
    totalDistance: 8.3,
    sets: [{ distanceM: 2000, isCompleted: false, isSkipped: false }],
  }
  assert.equal(sessionDistanceKmForDisplay(pending), 8.3)

  const addressed = {
    ...pending,
    sets: [
      { distanceM: 2000, isCompleted: true, isSkipped: false },
      { distanceM: 500, setsCount: 4, isCompleted: false, isSkipped: true },
    ],
  }
  assert.equal(sessionDistanceKmForDisplay(addressed), 2)
  assert.equal(effortLabel(0), 'Easy')
  assert.equal(effortLabel(6), 'Moderate')
  assert.equal(effortLabel(10), 'Very hard')
})

test('bulk session completion marks every prescribed step done and clears skipped states', () => {
  const session = {
    sets: [
      { isCompleted: false, isSkipped: false },
      { isCompleted: false, isSkipped: true },
    ],
  }
  const completed = withAllSetsCompleted(session, true)
  assert.ok(completed.sets.every((set) => set.isCompleted && !set.isSkipped))

  const cleared = withAllSetsCompleted(completed, false)
  assert.ok(cleared.sets.every((set) => !set.isCompleted && !set.isSkipped))
})

test('first plan gets partial week plus two full weeks and respects Beginner recovery floors', () => {
  const p = profile()
  const skeleton = buildPlanSkeleton({ profile: p, recentSessions: [], weekPhases: [], checkIn: normalCheckIn, today })
  assert.equal(skeleton.athleteState.experienceTier, 'Beginner')
  assert.equal(skeleton.weeks.length, 3)
  assert.deepEqual(validateSkeleton(skeleton, p).errors, [])
  for (const week of skeleton.weeks.filter((w) => !w.partial)) {
    assert.ok(new Set(week.trainingDates).size <= 5)
    assert.ok(week.sessions.filter((s) => s.role === 'quality').length <= 1)
  }
})

test('significant pain suppresses high-intensity sessions and reduces volume', () => {
  const p = profile({ trainingDaysPerWeek: 4 })
  const normal = buildPlanSkeleton({ profile: p, recentSessions: [], weekPhases: [], checkIn: normalCheckIn, today })
  const pain = buildPlanSkeleton({ profile: p, recentSessions: [], weekPhases: [], checkIn: { recovery: 'veryFatigued', painLevel: 'significant', previousBlockLoad: 'tooHard' }, today })
  assert.equal(pain.weeks.flatMap((w) => w.sessions).filter((s) => s.role === 'quality').length, 0)
  assert.ok(pain.weeks[1].targets.runKm < normal.weeks[1].targets.runKm)
})

test('triathlon schedule keeps a brick and distributes swim volume when days allow', () => {
  const p = profile({
    sport: 'triathlon', trainingDaysPerWeek: 6,
    onboardingPriorStructuredPlan: true, onboardingConsistencyRating: 'Very consistent',
    onboardingTriPriorExperience: true, onboardingKnowsThreshold: true,
  })
  const skeleton = buildPlanSkeleton({ profile: p, recentSessions: [], weekPhases: [], checkIn: normalCheckIn, today })
  assert.deepEqual(validateSkeleton(skeleton, p).errors, [])
  for (const week of skeleton.weeks.filter((w) => !w.partial)) {
    assert.ok(week.sessions.some((s) => s.discipline === 'brick'))
    assert.ok(week.sessions.filter((s) => s.discipline === 'swim').length >= 2)
  }
})

test('generated response must preserve locked ids, roles, dates, disciplines and totals', () => {
  const p = profile({ trainingDaysPerWeek: 4, goalOverallTime: '1:45:00' })
  const skeleton = buildPlanSkeleton({ profile: p, recentSessions: [], weekPhases: [], checkIn: normalCheckIn, today })
  const specs = skeleton.weeks.flatMap((w) => w.sessions)
  const generated = specs.map((spec) => ({
    skeletonId: spec.skeletonId,
    skeletonRole: spec.role,
    weekLabel: spec.weekLabel,
    brickTargets: spec.brickTargets,
    strengthPrescription: spec.strengthPrescription,
    endurancePrescription: spec.endurancePrescription,
    isOptional: spec.isOptional,
    date: spec.date,
    discipline: spec.discipline,
    title: `Generated ${spec.role}`,
    totalDistance: spec.targetDistanceKm == null ? null : (spec.discipline === 'swim' ? spec.targetDistanceKm * 1000 : spec.targetDistanceKm),
    sets: spec.strengthPrescription ? spec.strengthPrescription.exerciseSlots.map(slot => ({
      slot, exercise: `${slot} exercise`, setsCount: slot === 'core' ? spec.strengthPrescription.coreSets : spec.strengthPrescription.workSetsMin,
      isCore: slot === 'core',
    })) : spec.endurancePrescription ? canonicalEnduranceSets(spec.endurancePrescription) : [],
  }))
  assert.deepEqual(validateGeneratedPlan({ skeleton, sessions: generated }).errors, [])
  const altered = generated.map((s, i) => i === 0 ? { ...s, date: '2026-01-01' } : s)
  assert.ok(validateGeneratedPlan({ skeleton, sessions: altered }).errors.length > 0)
  assert.equal(mergeGeneratedWithSkeleton({ skeleton, sessions: generated })[0].discipline, specs[0].discipline)
})

test('running goal-time pacing is derived deterministically', () => {
  assert.equal(parseDurationSeconds('1:45:00'), 6300)
  const targets = runningPaceTargets(profile({ runningDistance: 'halfMarathon', goalOverallTime: '1:45:00' }))
  assert.match(targets.racePace, /^4:5\d\/km$/)
  assert.equal(targets.easyPace, null)
  assert.equal(targets.thresholdPace, null, 'goal alone must not manufacture a threshold')
})

test('returning block phase is derived from race proximity instead of defaulting to Maintenance', () => {
  const p = profile({ competitionDate: '2026-10-04T00:00:00.000Z', trainingDaysPerWeek: 4 })
  const recentSessions = [{ date: '2026-08-23T00:00:00.000Z', discipline: 'run', totalDistance: 10 }]
  const weekPhases = [{ weekStart: '2026-08-17T00:00:00.000Z', phase: 'buildUp' }]
  const skeleton = buildPlanSkeleton({ profile: p, recentSessions, weekPhases, checkIn: normalCheckIn, today })
  assert.notEqual(skeleton.weeks[0].phase, 'maintenance')
})

test('hybrid markdown parsing preserves validation metadata while duplicate storage stays separate', async () => {
  const { parseMarkdown } = await import('../src/services/markdownImporter.js')
  const md = '```session\n[{"skeletonId":"abc","skeletonRole":"quality","date":"2026-09-01","discipline":"run","title":"Threshold","totalDistance":10,"sets":[]}]\n```'
  const existing = [{ importKey: '2026-09-01|run|Threshold' }]
  const parsed = parseMarkdown(md, existing, [])
  assert.equal(parsed.decodedSessions.length, 1)
  assert.equal(parsed.decodedSessions[0].skeletonId, 'abc')
  assert.equal(parsed.decodedSessions[0].skeletonRole, 'quality')
  assert.equal(parsed.newSessions.length, 0)
  assert.equal(parsed.summary.skippedDuplicates, 1)
})

test('v3 backup profile normalization fixes the singleton id and sanitizes scheduling fields', async () => {
  const { normalizeProfileLoose, normalizePerceivedEffort } = await import('../src/services/backupService.js')
  const normalized = normalizeProfileLoose({ id: 99, sport: 'nonsense', trainingDaysPerWeek: 99, longSessionDays: [1, 1, 8, '2'], excludeGymSessions: 1, strengthPreferenceConfigured: 1 })
  assert.equal(normalized.id, 1)
  assert.equal(normalized.sport, 'triathlon')
  assert.equal(normalized.trainingDaysPerWeek, 7)
  assert.deepEqual(normalized.longSessionDays.sort(), [1, 2])
  assert.equal(normalized.excludeGymSessions, true)
  assert.equal(normalized.strengthPreferenceConfigured, true)
  assert.equal(normalizePerceivedEffort(null), null)
  assert.equal(normalizePerceivedEffort(''), null)
  assert.equal(normalizePerceivedEffort('7.4'), 7)
  assert.equal(normalizePerceivedEffort(12), 10)
})

test('legacy backup phase normalization uses the current profile instead of imported phase labels', async () => {
  const { deterministicWeekPhasesForImportedSessions } = await import('../src/services/backupService.js')
  const currentProfile = profile({
    sport: 'running',
    runningDistance: 'marathon',
    competitionDate: '2027-04-25',
    trainingBlockStartDate: '2026-08-28',
  })
  const importedSessions = [
    { date: localISO('2026-08-24'), discipline: 'run' },
    { date: localISO('2026-08-28'), discipline: 'run' },
    { date: localISO('2026-08-30'), discipline: 'run' },
  ]

  const phases = deterministicWeekPhasesForImportedSessions(currentProfile, importedSessions)
  assert.equal(phases.length, 1)
  assert.equal(phases[0].phase, 'buildUp')
})

test('marathon five-day Advanced first plan allocates every running week exactly to its target', () => {
  const p = profile({
    sport: 'running',
    runningDistance: 'marathon',
    trainingDaysPerWeek: 5,
    longSessionDays: [1, 3, 7],
    goalOverallTime: '3:30:00',
    onboardingPriorStructuredPlan: true,
    onboardingConsistencyRating: 'Very consistent',
    onboardingAlreadyRuns: true,
    onboardingKnowsThreshold: true,
    trainingFitness: { run: { maxSessionMinutes: 180 } },
    onboardingThresholdDetails: 'Threshold pace 4:20/km',
  })
  const skeleton = buildPlanSkeleton({ profile: p, recentSessions: [], weekPhases: [], checkIn: normalCheckIn, today })
  assert.equal(skeleton.athleteState.experienceTier, 'Advanced')
  assert.deepEqual(validateSkeleton(skeleton, p).errors, [])
  for (const week of skeleton.weeks) {
    const allocated = week.sessions
      .filter((session) => session.discipline === 'run')
      .reduce((sum, session) => sum + (session.targetDistanceKm ?? 0), 0)
    assert.ok(Math.abs(allocated - week.targets.runKm) < 1e-9, `${week.weekStart}: ${allocated} != ${week.targets.runKm}`)
  }
})

test('triathlon rounded allocations exactly preserve swim, bike and run weekly targets', () => {
  const p = profile({
    sport: 'triathlon',
    triathlonDistance: 'ironman',
    trainingDaysPerWeek: 6,
    onboardingPriorStructuredPlan: true,
    onboardingConsistencyRating: 'Very consistent',
    onboardingTriPriorExperience: true,
    onboardingKnowsThreshold: true,
  })
  const skeleton = buildPlanSkeleton({ profile: p, recentSessions: [], weekPhases: [], checkIn: normalCheckIn, today })
  assert.deepEqual(validateSkeleton(skeleton, p).errors, [])
  for (const week of skeleton.weeks) {
    const swim = week.sessions.filter((s) => s.discipline === 'swim').reduce((sum, s) => sum + (s.targetDistanceKm ?? 0), 0)
    const bike = week.sessions.filter((s) => s.discipline === 'bike').reduce((sum, s) => sum + (s.targetDistanceKm ?? 0), 0)
      + week.sessions.filter((s) => s.discipline === 'brick').reduce((sum, s) => sum + (s.brickTargets?.bikeKm ?? 0), 0)
    const run = week.sessions.filter((s) => s.discipline === 'run').reduce((sum, s) => sum + (s.targetDistanceKm ?? 0), 0)
      + week.sessions.filter((s) => s.discipline === 'brick').reduce((sum, s) => sum + (s.brickTargets?.runKm ?? 0), 0)
    assert.ok(Math.abs(swim - week.targets.swimKm) < 1e-9, `${week.weekStart} swim: ${swim} != ${week.targets.swimKm}`)
    assert.ok(Math.abs(bike - week.targets.bikeKm) < 1e-9, `${week.weekStart} bike: ${bike} != ${week.targets.bikeKm}`)
    assert.ok(Math.abs(run - week.targets.runKm) < 1e-9, `${week.weekStart} run: ${run} != ${week.targets.runKm}`)
  }
})

test('hybrid validator compares imported dates in local calendar time and accepts in-block rest entries without skeleton ids', () => {
  const previousTz = process.env.TZ
  process.env.TZ = 'Europe/Rome'
  try {
    const skeleton = {
      blockStart: '2026-08-28',
      blockEnd: '2026-09-13',
      weeks: [{
        weekStart: '2026-08-24',
        calendarStart: '2026-08-28',
        calendarEnd: '2026-08-30',
        weekNumber: 0,
        weekLabel: 'Week 0',
        sessions: [{
          skeletonId: '2026-08-28-run-quality-1',
          role: 'quality',
          date: '2026-08-28',
          discipline: 'run',
          phase: 'buildUp',
          targetDistanceKm: 6.5,
          weekNumber: 0,
          weekLabel: 'Week 0',
        }],
      }, {
        weekStart: '2026-08-31',
        calendarStart: '2026-08-31',
        calendarEnd: '2026-09-06',
        weekNumber: 1,
        weekLabel: 'Week 1',
        sessions: [],
      }],
    }
    const sessions = [
      {
        skeletonId: '2026-08-28-run-quality-1',
        skeletonRole: 'quality',
        weekLabel: 'Week 0',
        // Local midnight on 28 Aug in UTC+2 serializes to 27 Aug 22:00Z.
        date: '2026-08-27T22:00:00.000Z',
        discipline: 'run',
        title: 'Threshold Intro',
        totalDistance: 6.5,
      },
      {
        date: '2026-09-03T22:00:00.000Z',
        discipline: 'rest',
        title: 'Full Rest',
        weekLabel: 'Week 1',
      },
    ]
    assert.deepEqual(validateGeneratedPlan({ skeleton, sessions }).errors, [])
  } finally {
    if (previousTz == null) delete process.env.TZ
    else process.env.TZ = previousTz
  }
})

test('hybrid validator still rejects unscheduled non-rest training without a skeleton id', () => {
  const skeleton = { blockStart: '2026-08-28', blockEnd: '2026-09-13', weeks: [] }
  const validation = validateGeneratedPlan({
    skeleton,
    sessions: [{ date: '2026-09-01T00:00:00.000Z', discipline: 'run', title: 'Extra Run', totalDistance: 5 }],
  })
  assert.equal(validation.errors.length, 1)
  assert.match(validation.errors[0], /missing skeletonId/)
})

test('first-plan partial week scales volume to remaining calendar days and keeps a recovery day', () => {
  const p = profile({
    sport: 'running',
    runningDistance: 'marathon',
    trainingDaysPerWeek: 5,
    longSessionDays: [1, 3, 7],
    goalOverallTime: '3:30:00',
    onboardingPriorStructuredPlan: true,
    onboardingConsistencyRating: 'Very consistent',
    onboardingAlreadyRuns: true,
    onboardingKnowsThreshold: true,
  })
  const skeleton = buildPlanSkeleton({ profile: p, recentSessions: [], weekPhases: [], checkIn: normalCheckIn, today })
  const partial = skeleton.weeks[0]
  const full = skeleton.weeks[1]
  assert.equal(partial.partial, true)
  assert.equal(partial.weekNumber, 0)
  assert.equal(partial.weekLabel, 'Week 0')
  assert.equal(full.weekNumber, 1)
  assert.equal(full.weekLabel, 'Week 1')
  assert.equal(partial.trainingDates.length, 2)
  assert.ok(partial.targets.runKm < full.targets.runKm)
  assert.ok(Math.abs(partial.targets.runKm - 16) <= 0.5, `expected roughly 3/7 of 37.5 km, got ${partial.targets.runKm}`)
  assert.deepEqual(validateSkeleton(skeleton, p).errors, [])
})


test('week numbering continues deterministically from original plan start through Oct 26 block', () => {
  const p = profile({
    sport: 'running',
    runningDistance: 'marathon',
    trainingDaysPerWeek: 5,
    onboardingPriorStructuredPlan: true,
    onboardingConsistencyRating: 'Very consistent',
    onboardingAlreadyRuns: true,
    onboardingKnowsThreshold: true,
    goalOverallTime: '3:30:00',
  })
  const planHistory = [
    { date: localISO('2026-08-28'), discipline: 'run', totalDistance: 5 },
    { date: localISO('2026-10-22'), discipline: 'run', totalDistance: 4.5 },
  ]
  const recentSessions = [planHistory[1]]
  const weekPhases = [
    { weekStart: localISO('2026-08-24'), phase: 'buildUp' },
    { weekStart: localISO('2026-10-19'), phase: 'buildUp' },
  ]
  const skeleton = buildPlanSkeleton({ profile: p, recentSessions, planHistory, weekPhases, checkIn: normalCheckIn, today })
  assert.equal(skeleton.planOriginDate, '2026-08-28')
  assert.equal(skeleton.blockStart, '2026-10-26')
  assert.equal(skeleton.blockEnd, '2026-11-08')
  assert.deepEqual(skeleton.weeks.map((week) => [week.weekLabel, week.calendarStart, week.calendarEnd]), [
    ['Week 9', '2026-10-26', '2026-11-01'],
    ['Week 10', '2026-11-02', '2026-11-08'],
  ])
  assert.ok(skeleton.weeks.every((week) => week.sessions.every((session) => session.weekLabel === week.weekLabel)))
})

test('hybrid validator rejects drifted week labels and merge restores the locked label', () => {
  const skeleton = {
    blockStart: '2026-10-26',
    blockEnd: '2026-11-08',
    weeks: [{
      weekStart: '2026-10-26',
      calendarStart: '2026-10-26',
      calendarEnd: '2026-11-01',
      weekNumber: 9,
      weekLabel: 'Week 9',
      sessions: [{
        skeletonId: '2026-10-26-run-quality-1',
        role: 'quality',
        date: '2026-10-26',
        discipline: 'run',
        phase: 'buildUp',
        weekNumber: 9,
        weekLabel: 'Week 9',
        targetDistanceKm: 3,
      }],
    }],
  }
  const generated = [{
    skeletonId: '2026-10-26-run-quality-1',
    skeletonRole: 'quality',
    weekLabel: 'Week 3',
    date: '2026-10-26T00:00:00.000Z',
    discipline: 'run',
    title: 'Threshold',
    totalDistance: 3,
  }]
  const validation = validateGeneratedPlan({ skeleton, sessions: generated })
  assert.ok(validation.errors.some((error) => /weekLabel/.test(error)))
  const merged = mergeGeneratedWithSkeleton({ skeleton, sessions: generated })
  assert.equal(merged[0].weekLabel, 'Week 9')
})


test('governance schema is generic and prompt builder does not reference athlete-specific worked examples', async () => {
  const { readFile } = await import('node:fs/promises')
  const rootSchema = await readFile(new URL('../PLAN_SCHEMA.md', import.meta.url), 'utf8')
  const bundledSchema = await readFile(new URL('../src/assets/PLAN_SCHEMA.md', import.meta.url), 'utf8')
  const promptBuilder = await readFile(new URL('../src/services/planPromptBuilder.js', import.meta.url), 'utf8')

  assert.equal(rootSchema, bundledSchema)
  assert.match(rootSchema, /generic skeleton in §1 is the canonical \*\*formatting example\*\*/i)
  assert.doesNotMatch(rootSchema, /Hamburg_2027|Matteo|TriathlonLog|TrainingSession\.swift|MarkdownImporter\.swift/)
  assert.doesNotMatch(promptBuilder, /Hamburg_2027|Week 3\/4 worked example|Claude chat/)
  assert.match(promptBuilder, /governance document's §1 skeleton is formatting guidance only/)
})

test('healthy marathon progression uses the latest completed full week and does not ratchet down from an incomplete recent week', () => {
  const p = profile({
    sport: 'running',
    runningDistance: 'marathon',
    trainingDaysPerWeek: 5,
    longSessionDays: [1, 3, 7],
    goalOverallTime: '3:30:00',
    trainingFitness: { run: { maxSessionMinutes: 180 } },
    onboardingPriorStructuredPlan: true,
    onboardingConsistencyRating: 'Very consistent',
    onboardingAlreadyRuns: true,
    onboardingKnowsThreshold: true,
  })
  const completed = (date, totalDistance) => ({ date: localISO(date), discipline: 'run', totalDistance, isCompleted: true })
  const pending = (date, totalDistance) => ({ date: localISO(date), discipline: 'run', totalDistance, isCompleted: false })
  const planHistory = [
    completed('2026-08-28', 5), // partial Week 0: deliberately ignored for progression
    completed('2026-10-12', 5), completed('2026-10-13', 5), completed('2026-10-14', 6), completed('2026-10-15', 6), completed('2026-10-18', 12), // 34 km
    pending('2026-10-19', 3), pending('2026-10-20', 3), pending('2026-10-21', 3.5), pending('2026-10-22', 3.5), // incomplete 13 km must not drag target down
  ]
  const weekPhases = [
    { weekStart: localISO('2026-08-24'), phase: 'buildUp' },
    { weekStart: localISO('2026-10-12'), phase: 'buildUp' },
    { weekStart: localISO('2026-10-19'), phase: 'buildUp' },
  ]
  const recentSessions = planHistory.filter((session) => session.date >= '2026-10-19')
  const skeleton = buildPlanSkeleton({ profile: p, recentSessions, planHistory, weekPhases, checkIn: normalCheckIn, today })
  assert.equal(skeleton.blockStart, '2026-10-26')
  assert.deepEqual(skeleton.weeks.map((week) => week.targets.runKm), [37, 37], 'v4 holds within-block volume; progression is reassessed next block')
  assert.ok(skeleton.weeks[0].targets.runKm >= 34)
  assert.ok(skeleton.weeks[1].targets.runKm >= skeleton.weeks[0].targets.runKm)
  assert.deepEqual(validateSkeleton(skeleton, p).errors, [])
})

test('normal same-phase progression is monotonic while an explicit recovery condition may reduce it', async () => {
  const { progressTowardTarget } = await import('../src/services/planning/planScheduler.js')
  assert.equal(progressTowardTarget(37.5, 34, 'Advanced', { step: 0.5 }), 37)
  assert.equal(progressTowardTarget(37.5, 37, 'Advanced', { step: 0.5 }), 37.5)
  assert.equal(progressTowardTarget(30, 34, 'Advanced', { step: 0.5 }), 34)
  assert.equal(progressTowardTarget(30, 34, 'Advanced', { allowReduction: true, step: 0.5 }), 30)
})

test('new-profile screen exposes and persists gym/bodyweight preferences before onboarding', async () => {
  const { readFile } = await import('node:fs/promises')
  const login = await readFile(new URL('../src/screens/LoginScreen.jsx', import.meta.url), 'utf8')
  const wizard = await readFile(new URL('../src/components/PlanGenerationWizardSheet.jsx', import.meta.url), 'utf8')
  const profileDefaults = await readFile(new URL('../src/db/profile.js', import.meta.url), 'utf8')

  assert.match(login, /Do not include gym sessions in my training plan/)
  assert.match(login, /Include bodyweight exercises in my training plan/)
  assert.match(login, /strengthPreferenceConfigured:\s*true/)
  assert.match(login, /bodyweightOnlyStrength:\s*excludeGymSessions && bodyweightOnlyStrength/)
  assert.match(wizard, /!strengthPreferenceConfigured/)
  assert.match(profileDefaults, /strengthPreferenceConfigured:\s*false/)
})

test('Add activity is available from Training Log and legacy markdown file import is removed from Coach', async () => {
  const { readFile } = await import('node:fs/promises')
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const daily = await readFile(new URL('../src/screens/DailyScreen.jsx', import.meta.url), 'utf8')
  const coach = await readFile(new URL('../src/screens/ImportScreen.jsx', import.meta.url), 'utf8')
  const manualEntry = await readFile(new URL('../src/components/ManualEntrySheet.jsx', import.meta.url), 'utf8')

  assert.match(daily, /onOpenManualEntry\(trainingLogSelectedDate\)/)
  assert.match(daily, /Add activity/)
  assert.match(coach, /Add activity/)
  assert.match(manualEntry, /title="Add Activity"/)
  assert.match(app, /initialDate=\{manualEntryDate\}/)
  assert.match(manualEntry, /initialDate = new Date\(\)/)
  assert.match(manualEntry, /parseImportDate\(date\)/)
  assert.doesNotMatch(coach, /Import from file|accept="\.md/)
  assert.doesNotMatch(coach, /importMarkdown/)
})


test('no-race-date macrocycle leaves Build-up, inserts recovery every fourth full week, and never uses Peak/Taper', async () => {
  const { noCompetitionPhaseForWeekNumber } = await import('../src/services/planning/planScheduler.js')
  const phases = Array.from({ length: 12 }, (_, index) => noCompetitionPhaseForWeekNumber(index + 1))
  assert.deepEqual(phases, [
    'buildUp', 'buildUp', 'buildUp', 'recovery',
    'endurance', 'endurance', 'endurance', 'recovery',
    'endurance', 'endurance', 'endurance', 'recovery',
  ])
  assert.ok(!phases.includes('peak'))
  assert.ok(!phases.includes('taper'))
})

test('healthy no-race marathon uses progressive load waves instead of a flat phase midpoint', () => {
  const p = profile({
    sport: 'running',
    runningDistance: 'marathon',
    trainingDaysPerWeek: 5,
    longSessionDays: [1, 3, 7],
    goalOverallTime: '3:30:00',
    onboardingPriorStructuredPlan: true,
    onboardingConsistencyRating: 'Very consistent',
    onboardingAlreadyRuns: true,
    onboardingKnowsThreshold: true,
    trainingFitness: { run: { maxSessionMinutes: 180 } },
  })

  // Seed a plan that starts on Fri 28 Aug, then generate each two-week block
  // and feed the locked sessions back as completed history. This exercises
  // the real week-number/phase/progression pipeline over twelve full weeks.
  const planHistory = [{ date: localISO('2026-08-28'), discipline: 'run', totalDistance: 5, isCompleted: true }]
  const weekPhases = [{ weekStart: localISO('2026-08-24'), phase: 'buildUp' }]
  const observed = []

  for (let block = 0; block < 6; block++) {
    const skeleton = buildPlanSkeleton({ profile: p, recentSessions: planHistory.slice(-20), planHistory, weekPhases, checkIn: normalCheckIn, today })
    for (const week of skeleton.weeks) {
      observed.push({ week: week.weekNumber, phase: week.phase, km: week.targets.runKm, quality: week.sessions.filter((session) => session.role === 'quality').length })
      weekPhases.push({ weekStart: localISO(week.weekStart), phase: week.phase })
      for (const session of week.sessions) {
        if (session.discipline !== 'run') continue
        planHistory.push({
          date: localISO(session.date),
          discipline: 'run',
          totalDistance: session.targetDistanceKm,
          isCompleted: true,
        })
      }
    }
  }

  const full = observed.filter((entry) => entry.week > 0).slice(0, 12)
  assert.deepEqual(full.map((entry) => entry.phase), [
    'buildUp', 'buildUp', 'buildUp', 'recovery',
    'endurance', 'endurance', 'endurance', 'recovery',
    'endurance', 'endurance', 'endurance', 'recovery',
  ])
  // Load weeks rise; recovery weeks deload and contain no quality sessions.
  assert.ok(full[1].km >= full[0].km)
  assert.ok(full[2].km > full[1].km)
  assert.ok(full[3].km < full[2].km)
  assert.equal(full[3].quality, 0)
  assert.ok(full[4].km >= full[2].km)
  assert.ok(full[5].km >= full[4].km)
  assert.ok(full[7].km < full[6].km)
  assert.equal(full[7].quality, 0)
  assert.ok(new Set(full.filter((entry) => entry.phase !== 'recovery').map((entry) => entry.km)).size > 3)
})

test('race-dated plans insert deloads during build/endurance but never override peak or taper', () => {
  const p = profile({
    sport: 'running',
    runningDistance: 'marathon',
    trainingDaysPerWeek: 5,
    competitionDate: '2026-11-29T00:00:00.000Z',
    onboardingPriorStructuredPlan: true,
    onboardingConsistencyRating: 'Very consistent',
    onboardingAlreadyRuns: true,
  })
  const history = [{ date: '2026-08-28T00:00:00.000Z', discipline: 'run', totalDistance: 5, isCompleted: true }]
  const phases = [{ weekStart: '2026-08-24T00:00:00.000Z', phase: 'buildUp' }]
  const skeleton = buildPlanSkeleton({ profile: p, recentSessions: history, planHistory: history, weekPhases: phases, checkIn: normalCheckIn, today })
  assert.ok(skeleton.weeks.every((week) => ['buildUp', 'endurance', 'recovery', 'peak', 'taper'].includes(week.phase)))
})

import { raceProjection } from '../src/services/raceProjection.js'

test('race projection stays in building state when there is no performance evidence', () => {
  const p = profile({ competitionDate: '2027-04-25', runningDistance: 'marathon' })
  const result = raceProjection(p, [], today)
  assert.equal(result.status, 'building')
})

test('running race projection uses athlete threshold evidence without treating goal time as fitness evidence', () => {
  const p = profile({
    competitionDate: '2027-04-25',
    runningDistance: 'marathon',
    goalOverallTime: '3:00:00',
    onboardingThresholdDetails: "4'30/km run threshold",
    trainingFitness: { run: { value: 270, source: 'test', status: 'assessed', assessedOn: '2026-08-20' } },
  })
  const result = raceProjection(p, [], today)
  assert.equal(result.status, 'ready')
  assert.equal(result.evidence, 'confirmed assessment')
  assert.ok(result.seconds > 3 * 3600, 'low endurance readiness should keep the estimate more conservative than the ambitious goal')
  assert.ok(result.upperSeconds > result.seconds)
  assert.ok(result.lowerSeconds < result.seconds)
})

test('triathlon projection refuses a full finish estimate while a discipline lacks evidence', () => {
  const p = profile({
    sport: 'triathlon',
    competitionDate: '2027-06-01',
    triathlonDistance: 'olympic',
    onboardingThresholdDetails: "1:45/100m swim threshold, 4'30/km run threshold, 250W FTP",
  })
  const result = raceProjection(p, [], today)
  assert.equal(result.status, 'building')
  assert.match(result.reason, /bike/i)
})

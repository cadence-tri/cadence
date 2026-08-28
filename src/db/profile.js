import { PROFILE_ID } from './db'

/** Default shape for a freshly created profile — mirrors
 * `AthleteProfile`'s Swift init defaults. `longSessionDays` is stored as a
 * plain array of weekday values (1=Sun...7=Sat, matching the native app's
 * `Weekday.rawValue`) rather than a comma-string — Dexie stores arrays
 * natively, so the string-encoding workaround SwiftData needed doesn't
 * apply here. */
export function newProfileDefaults(overrides = {}) {
  return {
    id: PROFILE_ID,
    name: '',
    sport: 'triathlon', // 'running' | 'triathlon'
    imageData: null, // base64 data URL string, or null
    createdAt: new Date().toISOString(),
    competitionName: '',
    competitionDate: null,
    runningDistance: 'marathon',
    triathlonDistance: 'olympic',
    goalOverallTime: '',
    goalSwimTime: '',
    goalBikeTime: '',
    goalRunTime: '',
    trainingDaysPerWeek: 5,
    longSessionDays: [],
    trainingBlockStartDate: null,
    // Gym/strength preference — toggled from the Profile screen at any
    // time (§ "Do not include gym sessions"). Purely a live switch: the
    // prompt builder reads it fresh on every generation, so flipping it
    // off simply means gym sessions resume in the *next* generated
    // block, no re-onboarding needed.
    excludeGymSessions: false,
    // Only meaningful when excludeGymSessions is true — swaps "no S&C at
    // all" for "bodyweight-only S&C" in the generated prompt.
    bodyweightOnlyStrength: false,
    // One-time onboarding answers, collected the first time the athlete
    // builds a plan (empty-log "It starts here!" flow). Persisted on the
    // profile (not just used for the first prompt) so every subsequent
    // 2-week generation still has this context — see planPromptBuilder's
    // `athleteBackgroundLines`.
    onboardingCompleted: false,
    onboardingInjury: '',
    onboardingAlreadyRuns: null, // true | false | null (unanswered)
    onboardingCurrentRacePace: '',
    onboardingTriPriorExperience: null, // true | false | null
    onboardingTriExperienceDetails: '',
    onboardingSwimFitness: '',
    onboardingBikeFitness: '',
    onboardingRunFitness: '',
    // Physiology baseline — all optional, all free text/number strings
    // (nothing in the app computes off these, they're descriptive
    // context for the coach prompt, same treatment as goal times).
    onboardingAge: '',
    onboardingWeightKg: '',
    onboardingKnowsHeartRate: null, // true | false | null
    onboardingRestingHR: '',
    onboardingMaxHR: '',
    onboardingKnowsThreshold: null, // true | false | null
    onboardingThresholdDetails: '', // e.g. "220W FTP, 4'30/km run threshold"
    // Equipment & access
    onboardingBikeSetup: '', // 'Outdoor only' | 'Indoor trainer (no power meter)' | 'Smart trainer with power meter' | ''
    onboardingPoolDaysPerWeek: '',
    onboardingOpenWaterAccess: null, // true | false | null
    onboardingTerrain: '', // 'Flat' | 'Hilly' | 'Mixed' | ''
    onboardingTreadmillAccess: null, // true | false | null
    // Lifestyle
    onboardingJobType: '', // 'Desk job (mostly sitting)' | 'Physically active job' | 'Mixed' | ''
    onboardingSleepHours: '',
    onboardingPreferredTrainingTime: '', // 'Morning' | 'Midday' | 'Evening' | 'Varies' | ''
    // Ongoing medical (distinct from onboardingInjury, which is past
    // injury history — this is anything currently being managed)
    onboardingOngoingConditions: null, // true | false | null
    onboardingOngoingConditionsDetails: '',
    // Experience & adherence
    onboardingPriorStructuredPlan: null, // true | false | null
    onboardingConsistencyRating: '', // 'Not tested yet' | 'I struggle with consistency' | 'Fairly consistent' | 'Very consistent' | ''
    onboardingAdditionalInfo: '',
    ...overrides,
  }
}

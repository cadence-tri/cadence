import { useState } from 'react'
import { Wand2, Copy, Check } from 'lucide-react'
import Sheet from './Sheet'
import { db } from '../db/db'
import { preparePlanGeneration } from '../services/planning/planGeneration'
import { mostRecentBlock } from '../services/planBlockTrigger'
import { capacityWarningMessage } from '../services/trainingCapacityWarning'
import { importMarkdown } from '../services/markdownImporter'

/** Small yes/no toggle used throughout the first-time onboarding
 * questions below. `value` is `true` | `false` | `null` (unanswered). */
function YesNoToggle({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-1 bg-panel rounded-xl p-1">
      {[
        { v: true, label: 'Yes' },
        { v: false, label: 'No' },
      ].map(({ v, label }) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(v)}
          className={`py-2 rounded-lg text-sm font-semibold ${
            value === v ? 'bg-accent text-white' : 'text-main-text'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Label + control wrapper so every onboarding question looks the same. */
function QuestionBlock({ label, children }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm text-main-text">{label}</label>
      {children}
    </div>
  )
}

/** Multi-option picker (3+ choices) styled like YesNoToggle/the sport
 * picker elsewhere in the app. `value` is a string, empty string means
 * unanswered. */
function SelectGroup({ value, onChange, options }) {
  return (
    <div className={`grid gap-1 bg-panel rounded-xl p-1`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const opt = typeof option === 'string' ? { value: option, label: option } : option
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`py-2 px-1 rounded-lg text-xs font-semibold leading-tight ${
              value === opt.value ? 'bg-accent text-white' : 'text-main-text'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** Small uppercase divider label to break the long onboarding question
 * list into readable groups. */
function SectionHeader({ label }) {
  return <h4 className="text-xs font-semibold text-accent uppercase tracking-wide mt-2">{label}</h4>
}

const inputClass = 'w-full p-3 rounded-xl bg-panel text-main-text outline-none'

/** The "how'd it go, generate the next 2 weeks" wizard. Ported from
 * PlanGenerationWizardView.swift, minus the Smart Coach one-tap path (cut
 * from the PWA per HANDOFF_PWA.md — copy/paste into an AI chat is now
 * the only generation path).
 *
 * For a brand-new profile (empty log), the free-text-only "tell me about
 * yourself" box is replaced by a set of close-ended onboarding questions
 * (injury history, running background, gym/bodyweight preference,
 * triathlon experience or discipline self-assessment). Answers are
 * persisted onto the profile itself — not just used for this one prompt
 * — so every future 2-week generation keeps drawing on them via
 * `athleteBackgroundLines` in planPromptBuilder.js. */
export default function PlanGenerationWizardSheet({ profile, allSessions, weekPhases, onClose }) {
  const isPlanEmpty = allSessions.length === 0
  const [stage, setStage] = useState('note') // note | prompt | pasteBack | result
  const [note, setNote] = useState('')
  const [prompt, setPrompt] = useState('')
  const [skeleton, setSkeleton] = useState(null)
  const [pastedReply, setPastedReply] = useState('')
  const [copied, setCopied] = useState(false)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const [showDetails, setShowDetails] = useState(false)

  // Onboarding-only question state (unused for returning athletes).
  const [injuryHasHistory, setInjuryHasHistory] = useState(null)
  const [injuryDetails, setInjuryDetails] = useState('')
  const [alreadyRuns, setAlreadyRuns] = useState(null)
  const [currentRacePace, setCurrentRacePace] = useState('')
  const [includeGym, setIncludeGym] = useState(null)
  const [bodyweightSessions, setBodyweightSessions] = useState(null)
  const [triPriorExperience, setTriPriorExperience] = useState(null)
  const [triExperienceDetails, setTriExperienceDetails] = useState('')
  const [swimFitness, setSwimFitness] = useState('')
  const [bikeFitness, setBikeFitness] = useState('')
  const [runFitness, setRunFitness] = useState('')

  // Physiology baseline
  const [age, setAge] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [knowsHeartRate, setKnowsHeartRate] = useState(null)
  const [restingHR, setRestingHR] = useState('')
  const [maxHR, setMaxHR] = useState('')
  const [knowsThreshold, setKnowsThreshold] = useState(null)
  const [thresholdDetails, setThresholdDetails] = useState('')

  // Equipment & access
  const [bikeSetup, setBikeSetup] = useState('')
  const [poolDaysPerWeek, setPoolDaysPerWeek] = useState('')
  const [openWaterAccess, setOpenWaterAccess] = useState(null)
  const [terrain, setTerrain] = useState('')
  const [treadmillAccess, setTreadmillAccess] = useState(null)

  // Lifestyle
  const [jobType, setJobType] = useState('')
  const [sleepHours, setSleepHours] = useState('')
  const [preferredTrainingTime, setPreferredTrainingTime] = useState('')

  // Ongoing medical (distinct from past injury history above)
  const [ongoingConditions, setOngoingConditions] = useState(null)
  const [ongoingConditionsDetails, setOngoingConditionsDetails] = useState('')

  // Experience & adherence
  const [priorStructuredPlan, setPriorStructuredPlan] = useState(null)
  const [consistencyRating, setConsistencyRating] = useState('')

  // Returning-athlete structured check-in. These values are deliberately
  // transient generation inputs: the deterministic scheduler consumes them,
  // while the free-text note is still passed through to the AI as context.
  const [recovery, setRecovery] = useState('normal')
  const [painLevel, setPainLevel] = useState('none')
  const [painDetails, setPainDetails] = useState('')
  const [previousBlockLoad, setPreviousBlockLoad] = useState('aboutRight')

  const strengthPreferenceConfigured = profile.strengthPreferenceConfigured === true
  const askGymQuestion = isPlanEmpty && !strengthPreferenceConfigured && !profile.excludeGymSessions
  const askBodyweightQuestion = isPlanEmpty && !strengthPreferenceConfigured && (profile.excludeGymSessions || includeGym === false)
  const isTriathlete = profile.sport === 'triathlon'

  const buildPrompt = async () => {
    setError(null)
    try {
      let effectiveProfile = profile
      if (isPlanEmpty) {
        const onboardingFields = {
          onboardingCompleted: true,
          onboardingInjury: injuryHasHistory ? injuryDetails.trim() : '',
          onboardingAlreadyRuns: alreadyRuns,
          onboardingCurrentRacePace: alreadyRuns ? currentRacePace.trim() : '',
          onboardingTriPriorExperience: isTriathlete ? triPriorExperience : null,
          onboardingTriExperienceDetails: isTriathlete && triPriorExperience ? triExperienceDetails.trim() : '',
          onboardingSwimFitness: isTriathlete && triPriorExperience === false ? swimFitness.trim() : '',
          onboardingBikeFitness: isTriathlete && triPriorExperience === false ? bikeFitness.trim() : '',
          onboardingRunFitness: isTriathlete && triPriorExperience === false ? runFitness.trim() : '',
          onboardingAge: age.trim(),
          onboardingWeightKg: weightKg.trim(),
          onboardingKnowsHeartRate: knowsHeartRate,
          onboardingRestingHR: knowsHeartRate ? restingHR.trim() : '',
          onboardingMaxHR: knowsHeartRate ? maxHR.trim() : '',
          onboardingKnowsThreshold: knowsThreshold,
          onboardingThresholdDetails: knowsThreshold ? thresholdDetails.trim() : '',
          onboardingBikeSetup: isTriathlete ? bikeSetup : '',
          onboardingPoolDaysPerWeek: isTriathlete ? poolDaysPerWeek.trim() : '',
          onboardingOpenWaterAccess: isTriathlete ? openWaterAccess : null,
          onboardingTerrain: terrain,
          onboardingTreadmillAccess: treadmillAccess,
          onboardingJobType: jobType,
          onboardingSleepHours: sleepHours.trim(),
          onboardingPreferredTrainingTime: preferredTrainingTime,
          onboardingOngoingConditions: ongoingConditions,
          onboardingOngoingConditionsDetails: ongoingConditions ? ongoingConditionsDetails.trim() : '',
          onboardingPriorStructuredPlan: priorStructuredPlan,
          onboardingConsistencyRating: consistencyRating,
          onboardingAdditionalInfo: note.trim(),
          // The gym question here only fires when the Profile-level flag
          // isn't already set — but if it IS already set, still honor a
          // fresh bodyweight answer given during onboarding.
          ...(askGymQuestion ? { excludeGymSessions: includeGym === false } : {}),
          ...(askBodyweightQuestion ? { bodyweightOnlyStrength: bodyweightSessions === true } : {}),
          ...((askGymQuestion || askBodyweightQuestion) ? { strengthPreferenceConfigured: true } : {}),
        }
        effectiveProfile = { ...profile, ...onboardingFields }
        await db.profile.update(profile.id, onboardingFields)
      }

      const block = mostRecentBlock(allSessions)
      const capacityWarningText = capacityWarningMessage({
        sport: effectiveProfile.sport,
        runningDistance: effectiveProfile.runningDistance,
        triathlonDistance: effectiveProfile.triathlonDistance,
        trainingDaysPerWeek: effectiveProfile.trainingDaysPerWeek,
      })
      const checkIn = isPlanEmpty
        ? { recovery: 'normal', painLevel: 'none', previousBlockLoad: 'aboutRight', painDetails: '', note: '' }
        : { recovery, painLevel, previousBlockLoad, painDetails: painLevel === 'none' ? '' : painDetails.trim(), note: note.trim() }
      const generation = preparePlanGeneration({
        profile: effectiveProfile,
        recentSessions: block,
        planHistory: allSessions,
        weekPhases,
        checkIn,
        capacityWarningText,
      })
      setSkeleton(generation.skeleton)
      setPrompt(generation.prompt)
      setCopied(false)
      setStage('prompt')
    } catch (e) {
      setError(e.message)
    }
  }

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
    } catch {
      setError('Could not copy automatically — select and copy the text manually.')
    }
  }

  const commitImport = async (markdown) => {
    setError(null)
    try {
      const result = await importMarkdown(markdown, skeleton ? { skeleton } : {})
      setSummary(result)
      setStage('result')
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <Sheet title={isPlanEmpty ? 'It starts here!' : 'Next 2 Weeks'} onClose={onClose}>
      <div className="p-4 flex flex-col gap-4">
        {stage === 'note' && (
          <>
            <Wand2 size={36} className="text-accent" />
            <h3 className="font-display font-bold text-xl text-main-text">
              {isPlanEmpty ? "Let's start training!" : 'How did the last block go?'}
            </h3>

            {isPlanEmpty ? (
              <>
                <p className="text-sm text-minor-text">
                  A few quick questions so your first plan is tailored from the start — then add anything else
                  below.
                </p>

                <QuestionBlock label="Any major injury in the past?">
                  <YesNoToggle value={injuryHasHistory} onChange={setInjuryHasHistory} />
                  {injuryHasHistory === true && (
                    <textarea
                      value={injuryDetails}
                      onChange={(e) => setInjuryDetails(e.target.value)}
                      rows={2}
                      placeholder="Tell us about it — what, when, current status"
                      className={`${inputClass} resize-none`}
                    />
                  )}
                </QuestionBlock>

                <QuestionBlock label="Do you already run?">
                  <YesNoToggle value={alreadyRuns} onChange={setAlreadyRuns} />
                </QuestionBlock>

                {alreadyRuns === true && (
                  <QuestionBlock label="What is your current race pace?">
                    <input
                      type="text"
                      value={currentRacePace}
                      onChange={(e) => setCurrentRacePace(e.target.value)}
                      placeholder="e.g. 4'40&quot;/km, or a recent race time"
                      className={inputClass}
                    />
                  </QuestionBlock>
                )}

                {askGymQuestion && (
                  <QuestionBlock label="Do you want to include gym training in your workout?">
                    <YesNoToggle value={includeGym} onChange={setIncludeGym} />
                  </QuestionBlock>
                )}

                {askBodyweightQuestion && (
                  <QuestionBlock label="Shall we include bodyweight training sessions?">
                    <YesNoToggle value={bodyweightSessions} onChange={setBodyweightSessions} />
                  </QuestionBlock>
                )}

                {isTriathlete && (
                  <QuestionBlock label="Have you already done a triathlon in the past?">
                    <YesNoToggle value={triPriorExperience} onChange={setTriPriorExperience} />
                  </QuestionBlock>
                )}

                {isTriathlete && triPriorExperience === true && (
                  <QuestionBlock label="Tell us more about it">
                    <textarea
                      value={triExperienceDetails}
                      onChange={(e) => setTriExperienceDetails(e.target.value)}
                      rows={3}
                      placeholder="Distance, finish time, how it went, anything worth knowing"
                      className={`${inputClass} resize-none`}
                    />
                  </QuestionBlock>
                )}

                {isTriathlete && triPriorExperience === false && (
                  <>
                    <QuestionBlock label="How do you feel about your swim fitness?">
                      <input
                        type="text"
                        value={swimFitness}
                        onChange={(e) => setSwimFitness(e.target.value)}
                        placeholder="e.g. comfortable, a beginner, rusty"
                        className={inputClass}
                      />
                    </QuestionBlock>
                    <QuestionBlock label="How do you feel about your bike fitness?">
                      <input
                        type="text"
                        value={bikeFitness}
                        onChange={(e) => setBikeFitness(e.target.value)}
                        placeholder="e.g. comfortable, a beginner, rusty"
                        className={inputClass}
                      />
                    </QuestionBlock>
                    <QuestionBlock label="How do you feel about your run fitness?">
                      <input
                        type="text"
                        value={runFitness}
                        onChange={(e) => setRunFitness(e.target.value)}
                        placeholder="e.g. comfortable, a beginner, rusty"
                        className={inputClass}
                      />
                    </QuestionBlock>
                  </>
                )}

                <SectionHeader label="Physiology" />

                <div className="grid grid-cols-2 gap-3">
                  <QuestionBlock label="Age">
                    <input
                      type="number"
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      placeholder="years"
                      className={inputClass}
                    />
                  </QuestionBlock>
                  <QuestionBlock label="Body weight">
                    <input
                      type="number"
                      value={weightKg}
                      onChange={(e) => setWeightKg(e.target.value)}
                      placeholder="kg"
                      className={inputClass}
                    />
                  </QuestionBlock>
                </div>

                <QuestionBlock label="Do you know your resting and max heart rate?">
                  <YesNoToggle value={knowsHeartRate} onChange={setKnowsHeartRate} />
                  {knowsHeartRate === true && (
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="number"
                        value={restingHR}
                        onChange={(e) => setRestingHR(e.target.value)}
                        placeholder="Resting HR (bpm)"
                        className={inputClass}
                      />
                      <input
                        type="number"
                        value={maxHR}
                        onChange={(e) => setMaxHR(e.target.value)}
                        placeholder="Max HR (bpm)"
                        className={inputClass}
                      />
                    </div>
                  )}
                </QuestionBlock>

                <QuestionBlock label="Do you have a known FTP (bike) or threshold running pace?">
                  <YesNoToggle value={knowsThreshold} onChange={setKnowsThreshold} />
                  {knowsThreshold === true && (
                    <input
                      type="text"
                      value={thresholdDetails}
                      onChange={(e) => setThresholdDetails(e.target.value)}
                      placeholder="e.g. 220W FTP, 4'30&quot;/km run threshold"
                      className={inputClass}
                    />
                  )}
                </QuestionBlock>

                <SectionHeader label="Equipment & access" />

                {isTriathlete && (
                  <QuestionBlock label="What's your bike training setup?">
                    <SelectGroup
                      value={bikeSetup}
                      onChange={setBikeSetup}
                      options={['Outdoor only', 'Indoor trainer (no power meter)', 'Smart trainer with power meter']}
                    />
                  </QuestionBlock>
                )}

                {isTriathlete && (
                  <QuestionBlock label="How many days a week can you access a pool?">
                    <input
                      type="number"
                      value={poolDaysPerWeek}
                      onChange={(e) => setPoolDaysPerWeek(e.target.value)}
                      placeholder="days/week"
                      className={inputClass}
                    />
                  </QuestionBlock>
                )}

                {isTriathlete && (
                  <QuestionBlock label="Do you have open water access in season?">
                    <YesNoToggle value={openWaterAccess} onChange={setOpenWaterAccess} />
                  </QuestionBlock>
                )}

                <QuestionBlock label="What's the terrain like where you train?">
                  <SelectGroup value={terrain} onChange={setTerrain} options={['Flat', 'Hilly', 'Mixed']} />
                </QuestionBlock>

                <QuestionBlock label="Do you have treadmill access for bad weather?">
                  <YesNoToggle value={treadmillAccess} onChange={setTreadmillAccess} />
                </QuestionBlock>

                <SectionHeader label="Lifestyle" />

                <QuestionBlock label="What's your day job like?">
                  <SelectGroup
                    value={jobType}
                    onChange={setJobType}
                    options={['Desk job (mostly sitting)', 'Physically active job', 'Mixed']}
                  />
                </QuestionBlock>

                <QuestionBlock label="How many hours do you typically sleep a night?">
                  <input
                    type="number"
                    value={sleepHours}
                    onChange={(e) => setSleepHours(e.target.value)}
                    placeholder="hours"
                    className={inputClass}
                  />
                </QuestionBlock>

                <QuestionBlock label="When do you prefer to train?">
                  <SelectGroup
                    value={preferredTrainingTime}
                    onChange={setPreferredTrainingTime}
                    options={['Morning', 'Midday', 'Evening', 'Varies']}
                  />
                </QuestionBlock>

                <SectionHeader label="Health" />

                <QuestionBlock label="Any ongoing conditions or niggles I should account for right now?">
                  <YesNoToggle value={ongoingConditions} onChange={setOngoingConditions} />
                  {ongoingConditions === true && (
                    <textarea
                      value={ongoingConditionsDetails}
                      onChange={(e) => setOngoingConditionsDetails(e.target.value)}
                      rows={2}
                      placeholder="What it is and anything you're currently doing to manage it"
                      className={`${inputClass} resize-none`}
                    />
                  )}
                </QuestionBlock>

                <SectionHeader label="Training experience" />

                <QuestionBlock label="Have you followed a structured training plan before?">
                  <YesNoToggle value={priorStructuredPlan} onChange={setPriorStructuredPlan} />
                </QuestionBlock>

                <QuestionBlock label="How would you rate your consistency in sticking to a training plan?">
                  <SelectGroup
                    value={consistencyRating}
                    onChange={setConsistencyRating}
                    options={['Not tested yet', 'I struggle with consistency', 'Fairly consistent', 'Very consistent']}
                  />
                </QuestionBlock>

                <div className="flex flex-col gap-2">
                  <label className="text-sm text-main-text">Any other useful information?</label>
                  <p className="text-xs text-minor-text">
                    Add here any additional information about your goals, current fitness level, and training
                    availability during the week
                  </p>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={5}
                    className={`${inputClass} resize-none`}
                  />
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-minor-text">
                  A few structured signals help Cadence size the next block consistently. Add any schedule conflicts,
                  unusual context, or other detail in the free-text note at the end.
                </p>

                <QuestionBlock label="How recovered do you feel?">
                  <SelectGroup
                    value={recovery}
                    onChange={setRecovery}
                    options={[{ value: 'great', label: 'Great' }, { value: 'normal', label: 'Normal' }, { value: 'fatigued', label: 'Fatigued' }, { value: 'veryFatigued', label: 'Very fatigued' }]}
                  />
                </QuestionBlock>

                <QuestionBlock label="How manageable was the previous block?">
                  <SelectGroup
                    value={previousBlockLoad}
                    onChange={setPreviousBlockLoad}
                    options={[{ value: 'tooEasy', label: 'Too easy' }, { value: 'aboutRight', label: 'About right' }, { value: 'tooHard', label: 'Too hard' }]}
                  />
                </QuestionBlock>

                <QuestionBlock label="Any pain or injury concern right now?">
                  <SelectGroup value={painLevel} onChange={setPainLevel} options={[{ value: 'none', label: 'None' }, { value: 'mild', label: 'Mild' }, { value: 'significant', label: 'Significant' }]} />
                  {painLevel !== 'none' && (
                    <textarea
                      value={painDetails}
                      onChange={(e) => setPainDetails(e.target.value)}
                      rows={2}
                      placeholder="Affected area and what you are feeling"
                      className={`${inputClass} resize-none`}
                    />
                  )}
                </QuestionBlock>

                {painLevel === 'significant' && (
                  <p className="text-xs text-red-500">
                    Cadence will reduce the training load and remove high-intensity work where appropriate. The coach
                    will be told not to diagnose and to recommend professional assessment before progressing the affected area.
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <label className="text-sm text-main-text">Anything else your coach should know?</label>
                  <p className="text-xs text-minor-text">
                    Schedule conflicts, travel, how specific sessions felt, or any other context. This stays as free text for the AI coach.
                  </p>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={5}
                    className="w-full p-3 rounded-xl bg-panel text-main-text outline-none resize-none"
                  />
                </div>
              </>
            )}

            <button onClick={buildPrompt} className="w-full py-2.5 rounded-xl bg-accent text-white font-semibold">
              Build check-in prompt to copy
            </button>
          </>
        )}

        {stage === 'prompt' && (
          <>
            <h3 className="font-display font-bold text-xl text-main-text">Copy this into your AI coach</h3>
            <p className="text-sm text-minor-text">Open your favorite AI, paste this whole message, and send it. Cadence has already locked the schedule; the AI is only filling in workout details.</p>
            <div className="max-h-64 overflow-y-auto p-2.5 rounded-xl bg-panel">
              <pre className="text-[11px] font-mono text-main-text whitespace-pre-wrap break-words">{prompt}</pre>
            </div>
            <button
              onClick={copyPrompt}
              className="w-full py-2.5 rounded-xl bg-accent text-white font-semibold flex items-center justify-center gap-2"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied ✓' : 'Copy prompt'}
            </button>
            <button
              onClick={() => setStage('pasteBack')}
              disabled={!copied}
              className="w-full py-2.5 rounded-xl border border-accent text-accent font-semibold disabled:opacity-40"
            >
              Continue → paste Coach&apos;s reply
            </button>
          </>
        )}

        {stage === 'pasteBack' && (
          <>
            <h3 className="font-display font-bold text-xl text-main-text">Paste Coach&apos;s reply</h3>
            <p className="text-sm text-minor-text">
              Copy your AI Coach&apos;s entire reply from the chat and paste it below. Tap Import to save your plan
              and start training.
            </p>
            <p className="text-xs text-minor-text">
              Don&apos;t worry if the code-block formatting gets stripped out along the way — as long as the reply
              text is in here somewhere, it&apos;ll still be found.
            </p>
            <textarea
              value={pastedReply}
              onChange={(e) => setPastedReply(e.target.value)}
              rows={10}
              className="w-full p-3 rounded-xl bg-panel text-main-text outline-none resize-none font-mono text-xs"
            />
            <div className="flex gap-2.5">
              <button onClick={() => setStage('prompt')} className="flex-1 py-2.5 rounded-xl border border-accent text-accent font-semibold">
                Back
              </button>
              <button
                onClick={() => commitImport(pastedReply)}
                disabled={!pastedReply.trim()}
                className="flex-[2] py-2.5 rounded-xl bg-accent text-white font-semibold disabled:opacity-40"
              >
                Import these 2 weeks
              </button>
            </div>
          </>
        )}

        {stage === 'result' && summary && (
          <>
            <h3 className="font-display font-bold text-xl text-main-text">
              Imported {summary.imported} session(s)
            </h3>
            {summary.skippedDuplicates > 0 && (
              <p className="text-sm text-minor-text">Skipped {summary.skippedDuplicates} already in your log.</p>
            )}
            {summary.validation && summary.validation.errors.length === 0 && (
              <p className="text-sm text-accent">✓ Plan checked against the locked Cadence schedule</p>
            )}
            {(summary.warnings.length > 0 || summary.failedItems.length > 0) && (
              <>
                <button onClick={() => setShowDetails((v) => !v)} className="text-xs font-semibold text-accent self-start">
                  {showDetails ? 'Hide details' : 'Show details'}
                </button>
                {showDetails && (
                  <div className="p-3 rounded-xl bg-panel flex flex-col gap-1.5">
                    {summary.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-minor-text">
                        ⚠ {w}
                      </p>
                    ))}
                    {summary.failedItems.map((f, i) => (
                      <p key={i} className="text-xs text-red-500">
                        ✕ {f}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {error && <div className="p-3 rounded-xl bg-red-500/10 text-sm text-red-600">{error}</div>}
      </div>
    </Sheet>
  )
}

import { useState } from 'react'
import WorkoutResultForm from './WorkoutResultForm'
import { CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import Sheet from './Sheet'
import CompletionRing from './CompletionRing'
import { OptionalBadge } from './SessionRow'
import { disciplineIcon, disciplineColor, disciplineDisplayName } from '../db/discipline'
import {
  completionFraction,
  addressedSetCount,
  setSummary,
  makeImportKey,
  sessionDistanceKmForDisplay,
  effortLabel,
  withAllSetsCompleted,
  cleanNumber,
} from '../db/session'
import { startOfWeekMon, addDays, asDate, isSameDay } from '../services/dateUtils'
import { db } from '../db/db'
import { runStepPresentation, runWorkoutOverview } from './runPrescriptionPresentation'

/** Editable form for one prescribed item. Field set depends on
 * discipline: gym gets sets/reps/weight, everything else (swim/bike/run/
 * brick) gets sets/distance/duration/pace-power/rest — those endurance
 * fields previously had no editable inputs at all, so a run's distance
 * or pace could never actually be changed from this screen. */
function EditableSetRow({ set, discipline, displayLabel, onChange }) {
  const isGym = discipline === 'gym'

  const numField = (key, label, width = 60) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-minor-text">{label}</span>
      <input
        type="number"
        value={set[key] ?? ''}
        onChange={(e) => onChange({ ...set, [key]: e.target.value === '' ? null : Number(e.target.value) })}
        style={{ width }}
        className="border border-minor-text/30 rounded px-1.5 py-1 text-sm text-main-text"
      />
    </div>
  )

  const textField = (key, label, placeholder, width = 96) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-minor-text">{label}</span>
      <input
        type="text"
        value={set[key] ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange({ ...set, [key]: e.target.value === '' ? null : e.target.value })}
        style={{ width }}
        className="border border-minor-text/30 rounded px-1.5 py-1 text-sm text-main-text placeholder:text-minor-text/50"
      />
    </div>
  )

  return (
    <div className="py-2.5">
      <div className="text-sm font-semibold text-main-text mb-1.5">{displayLabel || set.exercise || 'Item'}</div>
      <div className="flex gap-3 flex-wrap">
        {isGym ? (
          <>
            {numField('setsCount', 'sets')}
            {numField('reps', 'reps')}
            {numField('weightKg', 'kg')}
          </>
        ) : (
          <>
            {numField('setsCount', 'reps#', 52)}
            {numField('distanceM', 'meters', 76)}
            {textField('duration', 'duration', "e.g. 20'", 76)}
            {textField('paceOrPower', 'pace/power', "e.g. 4'40\"/km", 112)}
            {textField('rest', 'rest', 'e.g. 60"', 68)}
          </>
        )}
      </div>
    </div>
  )
}

/** A prescribed item's row, outside edit mode — completion stays the primary
 * left-side action while the less common skip action is explicit text on the
 * right. Both remain one-tap toggles. Once every item is marked one way or the
 * other, the session counts as fully addressed (see `db/session.js`'s
 * `completionFraction`); skipped items contribute no volume to Stats. */
function loadActionLabel(action) {
  return ({
    establish: 'Log a baseline load',
    hold: 'Repeat the established load',
    addRep: 'Add one repetition',
    increaseLoad: 'Small load increase',
    reduce: 'Recovery load',
  })[action] ?? null
}

function GymLoadControl({ set, onWeightChange }) {
  const [editing, setEditing] = useState(false)
  const suggestion = set.suggestedWeightKg == null ? null : `${cleanNumber(set.suggestedWeightKg)} kg suggested`
  const action = loadActionLabel(set.loadAction)

  if (editing) return (
    <label className="w-full flex items-center gap-2 mt-1 text-xs text-minor-text">
      Actual load
      <input
        autoFocus
        type="number"
        inputMode="decimal"
        min="0"
        step="0.5"
        value={set.weightKg ?? ''}
        onChange={(event) => onWeightChange(event.target.value === '' ? null : Number(event.target.value))}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        className="w-20 border border-minor-text/30 rounded-lg bg-background px-2 py-1 text-sm text-main-text outline-none focus:border-accent"
        aria-label={`Actual load for ${set.exercise || 'gym exercise'} in kilograms`}
      />
      kg
    </label>
  )

  return (
    <div className="w-full flex items-center justify-between gap-2 mt-1">
      <span className="text-[11px] text-minor-text">
        {[suggestion, action].filter(Boolean).join(' · ') || 'No load suggested yet'}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 text-xs font-semibold text-accent"
      >
        {set.weightKg == null ? '+ Log load' : `${cleanNumber(set.weightKg)} kg · Edit`}
      </button>
    </div>
  )
}

function SetRow({ set, color, discipline, runView, showLoadControl, onSetStatus, onWeightChange }) {
  const setStatus = (status) => () => onSetStatus(status)
  const addressed = set.isCompleted || set.isSkipped
  const itemName = runView?.label || set.exercise || 'step'

  return (
    <div className="flex items-start gap-2 py-2">
      <button
        type="button"
        onClick={setStatus('done')}
        aria-label={set.isCompleted ? `Mark ${itemName} not done` : `Mark ${itemName} done`}
        aria-pressed={set.isCompleted}
        className="w-11 h-11 -ml-2 shrink-0 flex items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <CheckCircle2
          size={20}
          style={{ color: set.isCompleted ? color : 'var(--color-minor-text)' }}
          strokeWidth={set.isCompleted ? 2.5 : 1.5}
          className={set.isCompleted ? '' : 'opacity-35'}
        />
      </button>
      <div className="flex-1 min-w-0 py-1">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            {runView ? (
              <div className={`min-w-0 ${addressed ? 'line-through text-minor-text' : ''}`}>
                <div className="flex items-baseline gap-x-1.5 flex-wrap">
                  <span className={`text-sm font-semibold ${addressed ? '' : 'text-main-text'}`}>{runView.label}</span>
                  {runView.quantity && <span className={`text-sm ${addressed ? '' : 'text-main-text'}`}>· {runView.quantity}</span>}
                </div>
                {(runView.target || runView.rpe) && (
                  <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-xs text-minor-text">
                    {runView.target && <span>{runView.target}</span>}
                    {runView.target && runView.rpe && <span aria-hidden="true">·</span>}
                    {runView.rpe && <span>{runView.rpe}</span>}
                  </div>
                )}
              </div>
            ) : (
              <span className={`text-sm ${addressed ? 'line-through text-minor-text' : 'text-main-text'}`}>
                {setSummary(showLoadControl ? { ...set, weightKg: null } : set)}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={setStatus('skipped')}
            aria-label={set.isSkipped ? `Undo skip for ${itemName}` : `Skip ${itemName}`}
            aria-pressed={set.isSkipped}
            className="w-16 min-h-11 -my-1 shrink-0 flex items-center justify-center rounded-full text-xs font-semibold text-minor-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            <span className={set.isSkipped ? 'rounded-full bg-minor-text/15 px-2.5 py-1' : ''}>
              {set.isSkipped ? 'Skipped' : 'Skip'}
            </span>
          </button>
        </div>
        {set.notes && (
          <p className={`mt-1 w-full text-xs text-minor-text ${set.isSkipped ? 'line-through opacity-65' : ''}`}>
            {set.notes}
          </p>
        )}
        {discipline === 'gym' && showLoadControl && (
          <GymLoadControl set={set} onWeightChange={onWeightChange} />
        )}
      </div>
    </div>
  )
}

function RunWorkoutSummary({ sets }) {
  const entries = runWorkoutOverview(sets)
  const hasEffortGuidance = runStepPresentation(sets).some((step) => step.rpe)
  if (!entries.length) return null

  return (
    <div className="mb-2.5 rounded-xl border border-minor-text/15 bg-panel px-3 py-2.5">
      <div className="text-[10px] font-semibold text-minor-text uppercase tracking-wide mb-2">Workout overview</div>
      <div className="flex flex-col gap-1.5">
        {entries.map((entry, index) => (
          <div key={`${entry.label}-${index}`} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 text-xs">
            <span className="font-semibold text-main-text">{entry.label}</span>
            <span className="text-main-text">
              {entry.value || '—'}
              {entry.detail && <span className="block text-minor-text mt-0.5">{entry.detail}</span>}
            </span>
          </div>
        ))}
      </div>
      {hasEffortGuidance && (
        <details className="mt-2.5 border-t border-minor-text/15 pt-2 text-xs text-minor-text">
          <summary className="cursor-pointer font-semibold text-main-text">Effort guidance</summary>
          <p className="mt-1.5 leading-relaxed">
            Pace is a target, not an obligation. Stay within the prescribed effort range and slow down when fatigue, terrain, or conditions require it.
          </p>
        </details>
      )}
    </div>
  )
}

/** Mon–Sun day picker for moving a session within its own week — life
 * happens (an easy run planned for Wednesday actually fits Tuesday
 * better), and the plan should bend to that without needing a full
 * re-import. Deliberately scoped to the session's current week only
 * (not a free-roaming date picker): moving further than that is a
 * planning change, not a scheduling one, and belongs in the next
 * generated block instead. */
function DayPicker({ date, onPick }) {
  const weekStart = startOfWeekMon(date)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <div className="flex gap-1.5">
      {days.map((d) => {
        const selected = isSameDay(d, date)
        return (
          <button
            key={d.toISOString()}
            onClick={() => onPick(d)}
            className={`flex-1 flex flex-col items-center py-1.5 rounded-lg ${
              selected ? 'bg-accent text-white' : 'bg-panel text-main-text'
            }`}
          >
            <span className="text-[10px] font-semibold opacity-80">{format(d, 'EEE')}</span>
            <span className="text-sm font-semibold">{format(d, 'd')}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Session detail — completion toggling, editable prescribed sets, notes,
 * and athlete feedback. Ported from SessionDetailView.swift, plus a
 * within-week day picker (PWA-only addition, see `DayPicker`'s doc
 * comment). */
export default function SessionDetailSheet({ session, onClose }) {
  const [isEditing, setIsEditing] = useState(false)
  const [local, setLocal] = useState(session)

  const Icon = disciplineIcon(local.discipline)
  const color = disciplineColor(local.discipline)
  const distanceKm = sessionDistanceKmForDisplay(local)
  const distanceText = distanceKm == null
    ? '—'
    : local.discipline === 'swim'
      ? `${Math.round(distanceKm * 1000).toLocaleString()} m`
      : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(distanceKm)} km`
  const allPrescribedDone = local.sets?.length > 0
    ? local.sets.every((set) => set.isCompleted)
    : !!local.isCompleted
  const runViews = local.discipline === 'run' ? runStepPresentation(local.sets) : []

  const persist = async (patch) => {
    const updated = { ...local, ...patch }
    setLocal(updated)
    await db.sessions.update(local.id, patch)
  }

  const setStepStatus = (index, status) => {
    const current = local.sets[index]
    // Tapping the already-active state clears it back to "not addressed"
    // (a toggle, not a one-way ratchet); tapping the other state always
    // switches cleanly to it.
    const next =
      status === 'done'
        ? current.isCompleted
          ? { isCompleted: false, isSkipped: false }
          : { isCompleted: true, isSkipped: false }
        : current.isSkipped
          ? { isCompleted: false, isSkipped: false }
          : { isCompleted: false, isSkipped: true }
    const sets = local.sets.map((s, i) => (i === index ? { ...s, ...next } : s))
    persist({ sets })
  }

  const toggleAllSteps = () => {
    const updated = withAllSetsCompleted(local, !allPrescribedDone)
    persist(local.sets?.length > 0
      ? { sets: updated.sets, isCompleted: updated.isCompleted }
      : { isCompleted: updated.isCompleted })
  }

  const editSet = (index, newSet) => {
    const sets = local.sets.map((s, i) => (i === index ? newSet : s))
    setLocal({ ...local, sets, workoutResult: null, prescriptionEdited: !!local.endurancePrescription })
    // Debounce-free write on every keystroke is fine at this scale.
    db.sessions.update(local.id, { sets, workoutResult: null, prescriptionEdited: !!local.endurancePrescription })
  }

  const logGymLoad = (index, weightKg) => {
    const sets = local.sets.map((set, i) => (i === index ? { ...set, weightKg } : set))
    setLocal({ ...local, sets })
    // Actual load is athlete evidence, not an edit to the prescribed plan.
    db.sessions.update(local.id, { sets })
  }

  const moveToDay = (newDate) => {
    // De-dup key is date+discipline+title (see PLAN_SCHEMA.md) — keep it
    // in sync with the move so a future re-import of the original plan
    // still recognizes this session by its new date, not its old one.
    persist({ date: newDate.toISOString(), importKey: makeImportKey(newDate, local.discipline, local.title) })
  }

  return (
    <Sheet title={local.title} onClose={onClose}>
      <div className="p-4 flex flex-col gap-6">
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={toggleAllSteps}
            className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label={allPrescribedDone ? 'Mark all prescribed steps not done' : 'Mark all prescribed steps done'}
            aria-pressed={allPrescribedDone}
          >
            <CompletionRing fraction={completionFraction(local)} color={color} size={36} strokeWidth={4} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2" style={{ color }}>
              <Icon size={16} />
              <span className="text-sm font-semibold">{disciplineDisplayName(local.discipline)}</span>
              {local.isOptional && <OptionalBadge />}
            </div>
            {local.isOptional && (
              <div className="text-[11px] text-minor-text">Doesn&apos;t count toward totals unless completed</div>
            )}
            {local.sets?.length > 0 && (
              <div className="text-xs text-minor-text">
                {addressedSetCount(local)}/{local.sets.length} items addressed
              </div>
            )}
          </div>
          <span className="text-sm text-minor-text shrink-0">{format(new Date(local.date), 'MMM d, yyyy')}</span>
        </div>

        <div>
          <div className="text-xs font-semibold text-minor-text uppercase tracking-wide mb-2">
            Reschedule for a different day
          </div>
          <DayPicker date={asDate(local.date)} onPick={moveToDay} />
        </div>

        {(!local.sets || local.sets.length === 0) && (
          <label className="flex items-center justify-between">
            <span className="text-sm text-main-text">Completed</span>
            <input
              type="checkbox"
              checked={local.isCompleted}
              onChange={(e) => persist({ isCompleted: e.target.checked })}
              className="w-5 h-5 accent-[var(--color-accent)]"
            />
          </label>
        )}

        {local.sets?.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-minor-text uppercase tracking-wide">Prescribed</span>
              <button onClick={() => setIsEditing((v) => !v)} className="text-xs font-semibold text-accent">
                {isEditing ? 'Done' : 'Edit'}
              </button>
            </div>
            {!isEditing && local.discipline === 'run' && <RunWorkoutSummary sets={local.sets} />}
            <div className="bg-panel rounded-xl px-3 flex flex-col divide-y divide-minor-text/15">
              {local.sets.map((set, i) =>
                isEditing ? (
                  <EditableSetRow key={i} set={set} discipline={local.discipline}
                    displayLabel={runViews[i]?.label} onChange={(s) => editSet(i, s)} />
                ) : (
                  <SetRow key={i} set={set} color={color} discipline={local.discipline} runView={runViews[i]}
                    showLoadControl={local.discipline === 'gym' && local.strengthPrescription?.equipment !== 'bodyweight'}
                    onSetStatus={(status) => setStepStatus(i, status)} onWeightChange={(weightKg) => logGymLoad(i, weightKg)} />
                )
              )}
            </div>
            {local.discipline === 'gym' && local.strengthPrescription?.equipment !== 'bodyweight' && (
              <p className="mt-2 text-[11px] text-minor-text">Log the load actually used. Keep the same kg convention for the same exercise.</p>
            )}
          </div>
        )}

        {local.notes && (
          <div>
            <div className="text-xs font-semibold text-minor-text uppercase tracking-wide mb-2">Coach notes</div>
            <p className="text-sm text-main-text whitespace-pre-wrap">{local.notes}</p>
          </div>
        )}

        {local.prescriptionEdited && local.originalPrescription && <details className="text-xs text-minor-text"><summary className="cursor-pointer">Original plan (before your edits)</summary><p className="mt-2">This modified workout remains in your log but does not automatically advance the original workout family.</p>{local.originalPrescription.map((s, i) => <p key={i} className="mt-1">{setSummary(s)}</p>)}</details>}
        <WorkoutResultForm key={`${local.id}:${local.workoutResult?.recordedAt ?? 'unreported'}`} session={local} onSave={persist} />
        <div>
          <div className="text-xs font-semibold text-minor-text uppercase tracking-wide mb-2">Your feedback</div>
          <textarea
            value={local.athleteFeedback ?? ''}
            onChange={(e) => persist({ athleteFeedback: e.target.value })}
            rows={4}
            className="w-full p-3 rounded-xl bg-panel text-main-text outline-none resize-none"
            placeholder="How did it go?"
          />

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="rounded-xl bg-panel p-3">
              <div className="text-xs text-minor-text">Perceived effort</div>
              <div className="mt-1 text-2xl font-bold text-main-text">
                {local.perceivedEffort == null ? '—' : `${local.perceivedEffort}/10`}
              </div>
              <div className="text-xs text-minor-text">{effortLabel(local.perceivedEffort)}</div>
            </div>
            <div className="rounded-xl bg-panel p-3">
              <div className="text-xs text-minor-text">{local.workoutResult?.actualDistanceKm ? 'Reported distance' : local.distanceIsEstimate ? 'Estimated distance' : 'Total distance'}</div>
              <div className="mt-1 text-2xl font-bold text-main-text">{distanceText}</div>
              <div className="text-xs text-minor-text">
                {distanceKm == null ? 'Not applicable' : 'Session total'}
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-xl bg-panel px-3 py-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <label htmlFor={`effort-${local.id}`} className="text-xs font-semibold text-main-text">
                Rate this session
              </label>
              {local.perceivedEffort != null && (
                <button
                  type="button"
                  onClick={() => persist({ perceivedEffort: null })}
                  className="text-xs font-semibold text-accent"
                >
                  Clear
                </button>
              )}
            </div>
            <input
              id={`effort-${local.id}`}
              type="range"
              min="0"
              max="10"
              step="1"
              value={local.perceivedEffort ?? 5}
              onChange={(e) => persist({ perceivedEffort: Number(e.target.value) })}
              aria-valuetext={local.perceivedEffort == null ? 'Not rated' : `${local.perceivedEffort} out of 10, ${effortLabel(local.perceivedEffort)}`}
              className="w-full accent-[var(--color-accent)]"
            />
            <div className="flex justify-between text-[10px] text-minor-text mt-1">
              <span>0 · Easy</span>
              <span>10 · Hard</span>
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

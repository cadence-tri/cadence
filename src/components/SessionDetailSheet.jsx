import { useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import Sheet from './Sheet'
import CompletionRing from './CompletionRing'
import { OptionalBadge } from './SessionRow'
import { disciplineIcon, disciplineColor, disciplineDisplayName } from '../db/discipline'
import { completionFraction, addressedSetCount, setSummary, makeImportKey } from '../db/session'
import { startOfWeekMon, addDays, asDate, isSameDay } from '../services/dateUtils'
import { db } from '../db/db'

function SkippedBadge() {
  return (
    <span className="text-[10px] font-semibold text-minor-text bg-minor-text/15 px-1.5 py-0.5 rounded-full shrink-0">
      Skipped
    </span>
  )
}

/** Editable form for one prescribed item. Field set depends on
 * discipline: gym gets sets/reps/weight, everything else (swim/bike/run/
 * brick) gets sets/distance/duration/pace-power/rest — those endurance
 * fields previously had no editable inputs at all, so a run's distance
 * or pace could never actually be changed from this screen. */
function EditableSetRow({ set, discipline, onChange }) {
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
      <div className="text-sm font-semibold text-main-text mb-1.5">{set.exercise || 'Item'}</div>
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

/** A prescribed item's row, outside edit mode — two independent tap
 * targets (done / skipped) rather than a single toggle, so "I did this"
 * and "I'm deliberately not doing this" are both one tap away instead of
 * skip only being reachable by leaving the item blank forever. Once every
 * item in a session is marked one way or the other, the session counts
 * as fully addressed (see `db/session.js`'s `completionFraction`) and
 * shows up in Stats — skipped items themselves just don't contribute any
 * distance/duration/weight to those stats. */
function SetRow({ set, color, onSetStatus }) {
  const setStatus = (status) => () => onSetStatus(status)
  const addressed = set.isCompleted || set.isSkipped

  return (
    <div className="flex items-center gap-2 py-2">
      <button onClick={setStatus('done')} aria-label="Mark done" className="shrink-0">
        <CheckCircle2
          size={20}
          style={{ color: set.isCompleted ? color : 'var(--color-minor-text)' }}
          strokeWidth={set.isCompleted ? 2.5 : 1.5}
          className={set.isCompleted ? '' : 'opacity-35'}
        />
      </button>
      <button onClick={setStatus('skipped')} aria-label="Mark skipped" className="shrink-0">
        <XCircle
          size={20}
          className="text-minor-text"
          strokeWidth={set.isSkipped ? 2.5 : 1.5}
          style={{ opacity: set.isSkipped ? 1 : 0.35 }}
        />
      </button>
      <div className="flex-1 flex items-center gap-1.5 flex-wrap">
        <span className={`text-sm ${addressed ? 'line-through text-minor-text' : 'text-main-text'}`}>
          {setSummary(set)}
        </span>
        {set.isSkipped && <SkippedBadge />}
      </div>
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

  const editSet = (index, newSet) => {
    const sets = local.sets.map((s, i) => (i === index ? newSet : s))
    setLocal({ ...local, sets })
    // Debounce-free write on every keystroke is fine at this scale.
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
          <CompletionRing fraction={completionFraction(local)} color={color} size={36} strokeWidth={4} />
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
            <div className="bg-panel rounded-xl px-3 flex flex-col divide-y divide-minor-text/15">
              {local.sets.map((set, i) =>
                isEditing ? (
                  <EditableSetRow key={i} set={set} discipline={local.discipline} onChange={(s) => editSet(i, s)} />
                ) : (
                  <SetRow key={i} set={set} color={color} onSetStatus={(status) => setStepStatus(i, status)} />
                )
              )}
            </div>
          </div>
        )}

        {local.notes && (
          <div>
            <div className="text-xs font-semibold text-minor-text uppercase tracking-wide mb-2">Coach notes</div>
            <p className="text-sm text-main-text whitespace-pre-wrap">{local.notes}</p>
          </div>
        )}

        <div>
          <div className="text-xs font-semibold text-minor-text uppercase tracking-wide mb-2">Your feedback</div>
          <textarea
            value={local.athleteFeedback ?? ''}
            onChange={(e) => persist({ athleteFeedback: e.target.value })}
            rows={4}
            className="w-full p-3 rounded-xl bg-panel text-main-text outline-none resize-none"
            placeholder="How did it go?"
          />
        </div>
      </div>
    </Sheet>
  )
}

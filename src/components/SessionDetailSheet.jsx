import { useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import Sheet from './Sheet'
import CompletionRing from './CompletionRing'
import { OptionalBadge } from './SessionRow'
import { disciplineIcon, disciplineColor, disciplineDisplayName } from '../db/discipline'
import { completionFraction, addressedSetCount, setSummary } from '../db/session'
import { db } from '../db/db'

function SkippedBadge() {
  return (
    <span className="text-[10px] font-semibold text-minor-text bg-minor-text/15 px-1.5 py-0.5 rounded-full shrink-0">
      Skipped
    </span>
  )
}

function EditableSetRow({ set, discipline, onChange }) {
  const showsWeight = discipline === 'gym' || set.weightKg != null

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

  return (
    <div className="py-1.5">
      <div className="text-sm font-semibold text-main-text mb-1">{set.exercise || 'Item'}</div>
      <div className="flex gap-4">
        {numField('setsCount', 'sets')}
        {numField('reps', 'reps')}
        {showsWeight && numField('weightKg', 'kg')}
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

/** Session detail — completion toggling, editable prescribed sets, notes,
 * and athlete feedback. Ported from SessionDetailView.swift. */
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

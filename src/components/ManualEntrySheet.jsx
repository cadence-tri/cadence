import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Sheet from './Sheet'
import { DISCIPLINES, disciplineDisplayName } from '../db/discipline'
import { newSet, makeImportKey } from '../db/session'
import { parseImportDate, toISODateString } from '../services/dateUtils'
import { db } from '../db/db'

function StepEditorRow({ step, discipline, onChange, onDelete }) {
  const field = (key, placeholder, type = 'text', width) => (
    <input
      type={type}
      value={step[key] ?? ''}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value
        const value = type === 'number' ? (raw === '' ? null : Number(raw)) : raw === '' ? null : raw
        onChange({ ...step, [key]: value })
      }}
      style={width ? { width } : undefined}
      className="border border-minor-text/25 rounded-lg px-2 py-1.5 text-sm text-main-text placeholder:text-minor-text/60"
    />
  )

  return (
    <div className="flex flex-col gap-2 bg-panel rounded-xl p-3">
      <div className="flex items-center gap-2">
        {field('exercise', discipline === 'gym' ? 'Exercise (e.g. Squat)' : 'Step (e.g. Warm-up)', 'text', undefined)}
        <button onClick={onDelete} className="text-minor-text hover:text-red-500 shrink-0">
          <Trash2 size={15} />
        </button>
      </div>
      <div className="flex gap-2 flex-wrap">
        {field('setsCount', 'Sets', 'number', 64)}
        {field('reps', 'Reps', 'number', 64)}
        {discipline === 'gym' ? field('weightKg', 'kg', 'number', 64) : field('distanceM', 'Meters', 'number', 80)}
      </div>
      {discipline !== 'gym' && (
        <div className="flex gap-2 flex-wrap">
          {field('duration', "Duration e.g. 5'")}
          {field('paceOrPower', "Pace/Power e.g. 4'40\"/km")}
        </div>
      )}
      {discipline === 'gym' && <div className="flex gap-2">{field('rest', "Rest e.g. 2'")}</div>}
      {discipline !== 'gym' && <div className="flex gap-2">{field('rest', "Rest e.g. 2'")}</div>}
      {field('notes', 'Notes (optional)')}
    </div>
  )
}

/** "Add activity" — add a single session outside the generated plan. Ported
 * from ManualEntryView.swift. */
export default function ManualEntrySheet({ onClose, onSaved, initialDate = new Date() }) {
  const [date, setDate] = useState(toISODateString(initialDate))
  const [discipline, setDiscipline] = useState('run')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [isOptional, setIsOptional] = useState(false)
  const [steps, setSteps] = useState([])
  const [totalDistanceText, setTotalDistanceText] = useState('')
  const [error, setError] = useState(null)

  const usesStepList = discipline !== 'rest'
  const requiresTotalDistance = ['swim', 'bike', 'run'].includes(discipline)
  const distanceUnit = discipline === 'swim' ? 'm' : 'km'

  const setDisciplineAndReset = (d) => {
    setDiscipline(d)
    if (d === 'rest') setSteps([])
    if (!['swim', 'bike', 'run'].includes(d)) setTotalDistanceText('')
  }

  const save = async () => {
    if (usesStepList && steps.length === 0) {
      setError(`This activity needs at least one ${discipline === 'gym' ? 'exercise' : 'step'} before you can save it.`)
      return
    }
    let totalDistance = null
    if (requiresTotalDistance) {
      const parsed = Number(totalDistanceText.trim())
      if (!totalDistanceText.trim() || isNaN(parsed) || parsed <= 0) {
        setError(`Enter the total distance for this session, in ${distanceUnit}.`)
        return
      }
      totalDistance = parsed
    }

    const trimmedTitle = title.trim() || disciplineDisplayName(discipline)
    // Parse as local calendar midnight so a selected Training Log day does
    // not shift backward when the athlete is west of UTC.
    const dateObj = parseImportDate(date)
    const session = {
      date: dateObj.toISOString(),
      discipline,
      title: trimmedTitle,
      notes: notes.trim(),
      sets: usesStepList ? steps : [],
      isCompleted: false,
      athleteFeedback: '',
      importedAt: new Date().toISOString(),
      weekLabel: null,
      isOptional,
      totalDistance,
      importKey: makeImportKey(dateObj, discipline, trimmedTitle),
    }
    const id = await db.sessions.add(session)
    onSaved?.({ ...session, id })
    onClose()
  }

  return (
    <Sheet
      title="Add Activity"
      onClose={onClose}
      footer={
        <button onClick={save} className="w-full py-2.5 rounded-xl bg-accent text-white font-semibold">
          Save
        </button>
      }
    >
      <div className="p-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-minor-text">Day</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-minor-text">Activity</label>
          <select
            value={discipline}
            onChange={(e) => setDisciplineAndReset(e.target.value)}
            className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
          >
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {disciplineDisplayName(d)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-minor-text">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={disciplineDisplayName(discipline)}
            className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
          />
        </div>

        {requiresTotalDistance && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-minor-text">Total distance ({distanceUnit})</label>
            <input
              type="number"
              value={totalDistanceText}
              onChange={(e) => setTotalDistanceText(e.target.value)}
              className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-minor-text">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full p-3 rounded-xl bg-panel text-main-text outline-none resize-none"
          />
        </div>

        <label className="flex items-center justify-between">
          <span className="text-sm text-main-text">Optional session</span>
          <input
            type="checkbox"
            checked={isOptional}
            onChange={(e) => setIsOptional(e.target.checked)}
            className="w-5 h-5 accent-[var(--color-accent)]"
          />
        </label>

        {usesStepList && (
          <div className="flex flex-col gap-2">
            <label className="text-xs text-minor-text">{discipline === 'gym' ? 'Exercises' : 'Workout steps'}</label>
            {steps.map((step, i) => (
              <StepEditorRow
                key={i}
                step={step}
                discipline={discipline}
                onChange={(s) => setSteps(steps.map((st, idx) => (idx === i ? s : st)))}
                onDelete={() => setSteps(steps.filter((_, idx) => idx !== i))}
              />
            ))}
            <button
              onClick={() => setSteps([...steps, newSet()])}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-accent text-accent text-sm font-semibold"
            >
              <Plus size={15} /> {discipline === 'gym' ? 'Add exercise' : 'Add step'}
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 text-sm text-red-600">{error}</div>
        )}
      </div>
    </Sheet>
  )
}

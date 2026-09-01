import { useState } from 'react'
import { normalizeWorkoutResult, paceSeconds, formatFitness } from '../services/planning/fitness'
const input = 'w-full p-2 rounded-lg bg-background text-main-text border border-minor-text/20'
export default function WorkoutResultForm({ session, onSave }) {
  const [draft, setDraft] = useState(session.workoutResult ?? {})
  const [actual, setActual] = useState(session.workoutResult?.actualValue == null ? '' : session.discipline === 'bike' ? String(session.workoutResult.actualValue) : formatFitness(session.workoutResult.actualValue, session.discipline).split('/')[0])
  const [message, setMessage] = useState('')
  if (!session.endurancePrescription || !['run', 'bike', 'swim'].includes(session.discipline) || session.isRace) return null
  const quality = session.endurancePrescription.feedbackRequired
  const change = (key, value) => { setDraft((d) => ({ ...d, [key]: value })); setMessage('') }
  const select = (key, label, options) => <label>{label}<select className={input} value={draft[key] ?? ''} onChange={(e) => change(key, e.target.value)}><option value="">Not reported</option>{options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}</select></label>
  const save = async () => {
    if (quality && (!draft.outcome || !draft.feel || !draft.recovery)) { setMessage('Choose completion, main effort and recovery, or leave this form unreported.'); return }
    const actualValue = actual.trim() === '' ? null : session.discipline === 'bike' ? Number(actual) : paceSeconds(actual)
    if (actual.trim() && (!Number.isFinite(actualValue) || actualValue <= 0)) { setMessage('Check the actual pace/power format.'); return }
    try {
      await onSave({ workoutResult: normalizeWorkoutResult({ ...draft, actualValue, recordedAt: new Date().toISOString() }) })
      setMessage('Result saved for the next block. Your baseline has not changed.')
    } catch { setMessage('Could not save this result. Please try again.'); }
  }
  return <details className="bg-panel rounded-xl p-3 text-main-text">
    <summary className="cursor-pointer font-semibold text-sm">Workout result <span className="font-normal text-xs">{session.workoutResult ? '· recorded' : '· optional'}</span></summary>
    <div className="flex flex-col gap-3 mt-3 text-sm">
      <p className="text-xs text-minor-text">{quality ? 'Report the main work, not the warm-up. Marking steps done does not verify achieved pace.' : 'Optional actual distance and duration improve workload tracking. Completion still counts when these measurements are unavailable.'}</p>
      {session.endurancePrescription.purpose === 'assessment' && <p className="text-xs text-accent">Phase checkpoint: record controlled main-work pace/power if measured. Review and confirm any supported baseline in Profile → Fitness estimates &amp; capacity; it will not change automatically.</p>}
      {select('outcome', 'Completion', [['asPrescribed', 'As prescribed'], ['modified', 'Modified'], ['stopped', 'Stopped early']])}
      {select('feel', 'Main effort', [['comfortable', 'Very comfortable'], ['controlled', 'Controlled'], ['difficult', 'Difficult'], ['tooHard', 'Too hard']])}
      {quality && select('recovery', 'Recovery between repetitions', [['asPrescribed', 'As prescribed'], ['extended', 'Needed longer recovery']])}
      {quality && <label>Completed work repetitions (optional)<input type="number" min="0" max="100" className={input} value={draft.completedReps ?? ''} onChange={(e) => change('completedReps', e.target.value)} /></label>}
      {quality && <label>Actual main-work {session.discipline === 'bike' ? 'power (W)' : session.discipline === 'swim' ? 'pace (min:sec /100m, full stroke only)' : 'pace (min:sec /km)'} (optional)<input className={input} value={actual} onChange={(e) => setActual(e.target.value)} /></label>}
      <label>Actual total session distance, km (optional)<input type="number" min="0" step="0.1" className={input} value={draft.actualDistanceKm ?? ''} onChange={(e) => change('actualDistanceKm', e.target.value)} /></label>
      <label>Actual total session duration, minutes (optional)<input type="number" min="0" className={input} value={draft.actualDurationMinutes ?? ''} onChange={(e) => change('actualDurationMinutes', e.target.value)} /></label>
      {select('context', 'Anything affecting the result?', [['normal', 'Nothing unusual'], ['fatigue', 'Unusual fatigue'], ['conditions', 'Heat, terrain or other conditions'], ['pain', 'Pain']])}
      <div className="flex gap-4"><button type="button" onClick={save} className="text-accent font-semibold">Save result</button><button type="button" onClick={async () => { await onSave({ workoutResult: null }); setDraft({}); setActual(''); setMessage('Result cleared.') }} className="text-minor-text">Clear</button></div>
      {message && <p role="status" className="text-xs">{message}</p>}
    </div>
  </details>
}

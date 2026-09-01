import { useState } from 'react'
import { DISCIPLINES, normalizeFitness, formatFitness, paceSeconds, updateFitness, baselineReview } from '../services/planning/fitness'
import { toISODateString } from '../services/dateUtils'

const input = 'w-full p-2 rounded-lg bg-background text-main-text border border-minor-text/20'
const names = { run: 'Running', bike: 'Cycling', swim: 'Swimming' }
function FitnessDiscipline({ discipline, profile, onChange, sessions }) {
  const current = normalizeFitness(profile.trainingFitness)[discipline]
  const [value, setValue] = useState(current.value == null ? '' : discipline === 'bike' ? String(current.value) : formatFitness(current.value, discipline).split('/')[0])
  const [source, setSource] = useState(current.source)
  const [date, setDate] = useState(current.assessedOn ?? '')
  const [level, setLevel] = useState(current.level)
  const [minutes, setMinutes] = useState(current.maxSessionMinutes ?? '')
  const [meters, setMeters] = useState(current.comfortableSwimMeters ?? '')
  const [weeklyKm, setWeeklyKm] = useState(current.currentWeeklyKm ?? '')
  const [longKm, setLongKm] = useState(current.longestRunKm ?? '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const review = baselineReview(profile, discipline, sessions)
  const save = async () => {
    setError(''); setSaved(false)
    const parsed = value.trim() === '' ? null : discipline === 'bike' ? Number(value) : paceSeconds(value)
    if (value.trim() && (parsed == null || !Number.isFinite(parsed) || parsed <= 0)) { setError('Enter a valid pace such as 4:00, or FTP in watts.'); return }
    if (date > toISODateString(new Date()) || (parsed != null && source !== 'personal' && !date)) { setError('An assessment needs its date (not in the future).'); return }
    if ([weeklyKm, longKm].some(v => v !== '' && (!Number.isFinite(Number(v)) || Number(v) <= 0))) { setError('Capacity distances must be positive, or left blank.'); return }
    const candidate = normalizeFitness({ [discipline]: { value: parsed, source, assessedOn: date, status: source === 'personal' ? 'provisional' : 'assessed', level, maxSessionMinutes: minutes, comfortableSwimMeters: meters, currentWeeklyKm: weeklyKm, longestRunKm: longKm } })[discipline]
    if (parsed != null && candidate.value == null) { setError('That value is outside the supported range. Check the units.'); return }
    try {
      await onChange(updateFitness(profile, discipline, candidate))
      setSaved(true)
    } catch { setError('Could not save. Please try again.'); }
  }
  return <details className="rounded-xl bg-panel p-3">
    <summary className="cursor-pointer text-sm font-semibold">{names[discipline]} · {formatFitness(current.value, discipline)} <span className="text-xs font-normal text-minor-text">{current.value == null ? 'effort-led' : current.status}</span></summary>
    <div className="flex flex-col gap-3 mt-3 text-sm">
      {review && <p className="text-xs text-accent">{review}</p>}
      <label>{discipline === 'bike' ? 'FTP estimate (W)' : discipline === 'swim' ? 'Swim threshold / CSS estimate (min:sec per 100m)' : 'Running threshold estimate (min:sec per km)'}
        <input className={input} value={value} onChange={(e) => { setValue(e.target.value); setSaved(false) }} placeholder={discipline === 'bike' ? 'e.g. 220' : discipline === 'swim' ? 'e.g. 2:00' : 'e.g. 4:00'} /></label>
      <label>Source<select className={input} value={source} onChange={(e) => setSource(e.target.value)}><option value="personal">Personal estimate — start conservatively</option><option value="test">Completed assessment / test</option><option value="race">Estimate from a recent race</option></select></label>
      <label>Assessment date (optional for personal estimate)<input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Experience in {names[discipline].toLowerCase()}<select className={input} value={level} onChange={(e) => setLevel(e.target.value)}><option value="new">New / my weaker discipline</option><option value="regular">Regular training</option><option value="experienced">Experienced</option></select></label>
      <label>Maximum session duration, minutes (optional)<input type="number" min="15" max="300" className={input} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
      {discipline === 'swim' && <label>Comfortable continuous swim, metres (optional)<input type="number" min="25" step="25" className={input} value={meters} onChange={(e) => setMeters(e.target.value)} /></label>}
      {discipline === 'run' && <>
        <label>Current consistent weekly running, km (optional)<input type="number" min="1" max="250" step="0.5" className={input} value={weeklyKm} onChange={e => setWeeklyKm(e.target.value)} /></label>
        <label>Recent longest comfortable run, km (optional)<input type="number" min="1" max="80" step="0.5" className={input} value={longKm} onChange={e => setLongKm(e.target.value)} /></label>
        <p className="text-xs text-minor-text">Use your recent consistent training, not your goal mileage. These anchor the start; completed training guides subsequent blocks.</p>
      </>}
      <p className="text-xs text-minor-text">Blank pace/power means effort-led. Your estimate is not a race goal or a requirement to hit this number immediately. Saving affects the next generated block only.</p>
      <button type="button" onClick={save} className="text-accent font-semibold self-start">Confirm and save {source === 'personal' ? 'estimate' : 'assessment'}</button>
      {error && <p role="alert" className="text-red-500 text-xs">{error}</p>}
      {saved && <p role="status" className="text-xs text-minor-text">Saved. No existing sessions were changed.</p>}
    </div>
  </details>
}
export default function FitnessSettings({ profile, onChange, sessions = [] }) {
  return <details className="rounded-xl border border-minor-text/20 p-3 text-main-text">
    <summary className="font-semibold text-sm cursor-pointer">Fitness estimates &amp; capacity</summary>
    <div className="mt-3 flex flex-col gap-3">
      {profile.onboardingThresholdDetails && <p className="text-xs text-minor-text">Earlier entry: {profile.onboardingThresholdDetails}. Confirm the relevant number below to use it; until then workouts remain effort-led.</p>}
      {(profile.sport === 'triathlon' ? DISCIPLINES : ['run']).map((discipline) => <FitnessDiscipline key={discipline} discipline={discipline} profile={profile} onChange={onChange} sessions={sessions} />)}
      {profile.sport === 'triathlon' && <label className="text-sm">Pool access, days/week<select className={input} value={profile.onboardingPoolDaysPerWeek ?? ''} onChange={(e) => onChange({ onboardingPoolDaysPerWeek: e.target.value })}><option value="">Not specified (at most 2 swims)</option>{[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
      {profile.sport === 'triathlon' && <label className="text-sm">Can you follow cycling power targets?<select className={input} value={profile.bikePowerAvailable == null ? '' : String(profile.bikePowerAvailable)} onChange={(e) => onChange({ bikePowerAvailable: e.target.value === '' ? null : e.target.value === 'true' })}><option value="">Use existing equipment answer</option><option value="true">Yes — power meter or smart trainer</option><option value="false">No — use effort</option></select></label>}
    </div>
  </details>
}

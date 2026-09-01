import { useId } from 'react'
import { normalizeStrengthFrequency } from '../services/planning/strengthPlanning'

export default function StrengthFrequencyField({ value, onChange }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-panel p-3">
      <label htmlFor={id} className="text-sm font-semibold text-main-text">Strength sessions per week</label>
      <select id={id} value={normalizeStrengthFrequency(value)} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-minor-text/30 bg-background p-2 text-main-text">
        <option value={1}>1 — Full body</option>
        <option value={2}>2 — Upper + lower body</option>
        <option value={3}>3 — Upper + lower + full body</option>
        <option value={4}>4 — Two upper/lower pairs</option>
      </select>
      <p className="text-xs text-minor-text">Each session ends with core/abs work. Recovery weeks use shorter, lighter sessions. Taper, race proximity, pain, or placement limits can reduce frequency; any adjustment is shown before you copy the prompt.</p>
      <p className="text-xs text-minor-text">Applies to the next generated block, not activities already in your calendar.</p>
    </div>
  )
}

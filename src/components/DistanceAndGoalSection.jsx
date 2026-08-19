import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { RUNNING_DISTANCES, RUNNING_META, TRIATHLON_DISTANCES, TRIATHLON_META, WEEKDAYS_MON_FIRST } from '../db/raceDistance'
import { capacityWarningMessage } from '../services/trainingCapacityWarning'

function GoalField({ placeholder, value, onChange }) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full p-3 rounded-xl bg-panel text-main-text placeholder:text-minor-text/70 outline-none"
    />
  )
}

/** The "what race, what distance, what goal time, what availability" block
 * — shared between Login and Profile. Ported from
 * DistanceAndGoalSection.swift. */
export default function DistanceAndGoalSection({ sport, values, onChange }) {
  const [warningDismissed, setWarningDismissed] = useState(false)

  useEffect(() => {
    setWarningDismissed(false)
  }, [sport, values.runningDistance, values.triathlonDistance, values.trainingDaysPerWeek])

  const warning = capacityWarningMessage({
    sport,
    runningDistance: values.runningDistance,
    triathlonDistance: values.triathlonDistance,
    trainingDaysPerWeek: values.trainingDaysPerWeek,
  })

  const toggleLongDay = (dayValue) => {
    const set = new Set(values.longSessionDays ?? [])
    if (set.has(dayValue)) set.delete(dayValue)
    else set.add(dayValue)
    onChange('longSessionDays', [...set].sort((a, b) => a - b))
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-minor-text">Race distance</label>
      {sport === 'running' ? (
        <div className="grid grid-cols-4 gap-1 bg-panel rounded-xl p-1">
          {RUNNING_DISTANCES.map((d) => (
            <button
              key={d}
              onClick={() => onChange('runningDistance', d)}
              className={`py-2 rounded-lg text-xs font-semibold ${
                values.runningDistance === d ? 'bg-accent text-white' : 'text-main-text'
              }`}
            >
              {RUNNING_META[d].displayName}
            </button>
          ))}
        </div>
      ) : (
        <select
          value={values.triathlonDistance}
          onChange={(e) => onChange('triathlonDistance', e.target.value)}
          className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
        >
          {TRIATHLON_DISTANCES.map((d) => (
            <option key={d} value={d}>
              {TRIATHLON_META[d].displayName}
            </option>
          ))}
        </select>
      )}
      <p className="text-[11px] text-minor-text">Sets the weekly training volume your plan is built around.</p>

      {sport === 'running' ? (
        <div className="flex flex-col gap-2 pt-2">
          <label className="text-xs text-minor-text">Goal finish time</label>
          <GoalField placeholder="e.g. 3:45:00" value={values.goalOverallTime} onChange={(v) => onChange('goalOverallTime', v)} />
        </div>
      ) : (
        <div className="flex flex-col gap-2 pt-2">
          <label className="text-xs text-minor-text">Goal times</label>
          <GoalField placeholder="Overall finish, e.g. 5:30:00" value={values.goalOverallTime} onChange={(v) => onChange('goalOverallTime', v)} />
          <GoalField placeholder="Swim split (optional), e.g. 28:00" value={values.goalSwimTime} onChange={(v) => onChange('goalSwimTime', v)} />
          <GoalField placeholder="Bike split (optional), e.g. 2:40:00" value={values.goalBikeTime} onChange={(v) => onChange('goalBikeTime', v)} />
          <GoalField placeholder="Run split (optional), e.g. 1:50:00" value={values.goalRunTime} onChange={(v) => onChange('goalRunTime', v)} />
          <p className="text-[11px] text-minor-text">Leave splits blank and your coach will derive them proportionally from the overall goal.</p>
        </div>
      )}

      <div className="pt-2">
        <div className="flex items-center justify-between">
          <span className="text-main-text text-sm">Training days per week</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onChange('trainingDaysPerWeek', Math.max(1, values.trainingDaysPerWeek - 1))}
              className="w-7 h-7 rounded-full bg-panel text-main-text"
            >
              −
            </button>
            <span className="text-sm text-minor-text w-4 text-center">{values.trainingDaysPerWeek}</span>
            <button
              onClick={() => onChange('trainingDaysPerWeek', Math.min(7, values.trainingDaysPerWeek + 1))}
              className="w-7 h-7 rounded-full bg-panel text-main-text"
            >
              +
            </button>
          </div>
        </div>
        <p className="text-[11px] text-minor-text mt-1">
          How many days you can train — you can still fit two sessions into a day (e.g. run + gym, swim + gym, or a
          brick), especially on the longer-time days below.
        </p>
      </div>

      <div className="pt-2">
        <label className="text-xs text-minor-text">Which days do you have more time?</label>
        <div className="flex gap-1.5 mt-2">
          {WEEKDAYS_MON_FIRST.map((day) => {
            const isOn = (values.longSessionDays ?? []).includes(day.value)
            return (
              <button
                key={day.value}
                onClick={() => toggleLongDay(day.value)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold ${
                  isOn ? 'bg-accent text-white' : 'bg-panel text-main-text'
                }`}
              >
                {day.short}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-minor-text mt-1.5">
          Your coach can schedule double sessions or longer ones (a long run, a long ride, a brick) on these days,
          and keep the rest lighter.
        </p>
      </div>

      {warning && !warningDismissed && (
        <div className="mt-2 p-3 rounded-xl bg-orange-500/12 flex flex-col gap-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-orange-500 shrink-0 mt-0.5" />
            <p className="text-sm text-main-text">{warning}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setWarningDismissed(true)}
              className="px-3 py-1.5 rounded-lg border border-accent text-accent text-xs font-semibold"
            >
              Continue anyway
            </button>
            <button
              onClick={() => setWarningDismissed(true)}
              className="px-3 py-1.5 rounded-lg border border-minor-text/40 text-main-text text-xs font-semibold"
            >
              Change days
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

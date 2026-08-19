import { useState, useRef } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import Sheet from './Sheet'
import ProfileAvatar from './ProfileAvatar'
import DistanceAndGoalSection from './DistanceAndGoalSection'
import { db } from '../db/db'
import { currentBlockEnd } from '../services/planBlockTrigger'
import { asDate } from '../services/dateUtils'

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Whether there's a training block active/recent enough that a
 * distance/discipline change should reset the Road to Race anchor —
 * matches native's `hasOngoingPlan` (block-end within the last 7 days). */
function hasOngoingPlan(allSessions) {
  const blockEnd = currentBlockEnd(allSessions)
  if (!blockEnd) return false
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  weekAgo.setHours(0, 0, 0, 0)
  return blockEnd >= weekAgo
}

export default function ProfileSheet({ profile, allSessions, onClose }) {
  const fileRef = useRef(null)
  const [local, setLocal] = useState(profile)
  const [hasCompetition, setHasCompetition] = useState(!!profile.competitionDate)
  const [confirmingBlockReset, setConfirmingBlockReset] = useState(null) // { field, value, message } | null
  const [showingGoalNotice, setShowingGoalNotice] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const patch = async (fields) => {
    setLocal((l) => ({ ...l, ...fields }))
    await db.profile.update(profile.id, fields)
  }

  const values = {
    runningDistance: local.runningDistance,
    triathlonDistance: local.triathlonDistance,
    goalOverallTime: local.goalOverallTime,
    goalSwimTime: local.goalSwimTime,
    goalBikeTime: local.goalBikeTime,
    goalRunTime: local.goalRunTime,
    trainingDaysPerWeek: local.trainingDaysPerWeek,
    longSessionDays: local.longSessionDays,
  }

  const onDistanceGoalChange = (field, value) => {
    // Distance/discipline changes reset the Road to Race anchor when a
    // plan is ongoing — goal-time changes just get a light notice.
    if ((field === 'runningDistance' || field === 'triathlonDistance') && hasOngoingPlan(allSessions)) {
      const label = field === 'runningDistance' ? 'running distance' : 'triathlon distance'
      setConfirmingBlockReset({ field, value, message: `Change your ${label}? This starts a new training block and resets your Road to Race progress to Week 1.` })
      return
    }
    if (field.startsWith('goal') && hasOngoingPlan(allSessions)) {
      patch({ [field]: value })
      setShowingGoalNotice(true)
      return
    }
    patch({ [field]: value })
  }

  const onSportChange = (sport) => {
    if (hasOngoingPlan(allSessions)) {
      setConfirmingBlockReset({
        field: 'sport',
        value: sport,
        message: `Switch to ${sport === 'running' ? 'Running' : 'Triathlon'}? This starts a new training block and resets your Road to Race progress to Week 1.`,
      })
      return
    }
    patch({ sport })
  }

  const confirmBlockReset = async () => {
    if (!confirmingBlockReset) return
    await patch({ [confirmingBlockReset.field]: confirmingBlockReset.value, trainingBlockStartDate: new Date().toISOString() })
    setConfirmingBlockReset(null)
  }

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const dataUrl = await readFileAsDataURL(file)
    patch({ imageData: dataUrl })
  }

  const toggleCompetition = (on) => {
    setHasCompetition(on)
    if (on) {
      const d = new Date()
      d.setMonth(d.getMonth() + 3)
      patch({ competitionDate: local.competitionDate ?? d.toISOString() })
    } else {
      patch({ competitionName: '', competitionDate: null })
    }
  }

  const deleteProfile = async () => {
    await db.transaction('rw', db.sessions, db.weekPhases, db.profile, async () => {
      await db.sessions.clear()
      await db.weekPhases.clear()
      await db.profile.delete(profile.id)
    })
    onClose()
  }

  const deleteWarning = (() => {
    let msg = "This permanently deletes your profile and every session in your training log, including any in-progress plans. This can't be undone."
    if (local.competitionDate) {
      const label = local.competitionName?.trim() || 'your race'
      msg += ` You're training for ${label} on ${new Date(local.competitionDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} — if you haven't exported a backup, that plan and progress will be gone before race day.`
    }
    return msg
  })()

  return (
    <Sheet title="Profile" onClose={onClose} wide>
      <div className="p-4 flex flex-col gap-7 pb-10">
        <label className="relative self-center cursor-pointer">
          <ProfileAvatar imageData={local.imageData} name={local.name} diameter={110} />
          <span className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5">
            <Camera size={28} className="text-accent" />
          </span>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
        </label>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-minor-text">Name</label>
          <input
            type="text"
            value={local.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-minor-text">Training for</label>
          <div className="grid grid-cols-2 gap-1 bg-panel rounded-xl p-1">
            {['running', 'triathlon'].map((s) => (
              <button
                key={s}
                onClick={() => onSportChange(s)}
                className={`py-2 rounded-lg text-sm font-semibold capitalize ${
                  local.sport === s ? 'bg-accent text-white' : 'text-main-text'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <DistanceAndGoalSection sport={local.sport} values={values} onChange={onDistanceGoalChange} />

        {showingGoalNotice && (
          <div className="p-3 rounded-xl bg-accent/12 flex items-center justify-between gap-2">
            <p className="text-xs text-main-text">
              Noted — your next generated 2 weeks will target this updated goal time and pace accordingly.
            </p>
            <button onClick={() => setShowingGoalNotice(false)} className="text-xs font-semibold text-accent shrink-0">
              OK
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between">
            <span className="text-sm text-main-text">Training for a specific competition</span>
            <input
              type="checkbox"
              checked={hasCompetition}
              onChange={(e) => toggleCompetition(e.target.checked)}
              className="w-5 h-5 accent-[var(--color-accent)]"
            />
          </label>
          {hasCompetition && (
            <>
              <input
                type="text"
                value={local.competitionName}
                onChange={(e) => patch({ competitionName: e.target.value })}
                placeholder="Competition name (e.g. Hamburg Marathon)"
                className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
              />
              <input
                type="date"
                value={local.competitionDate ? asDate(local.competitionDate).toISOString().slice(0, 10) : ''}
                onChange={(e) => patch({ competitionDate: new Date(e.target.value).toISOString() })}
                className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
              />
            </>
          )}
        </div>

        <div className="border-t border-minor-text/15 pt-6 flex flex-col gap-3 items-center text-center">
          <h3 className="font-semibold text-red-500">Danger Zone</h3>
          <p className="text-sm text-minor-text">
            Deletes your profile and every session in your training log, including any in-progress plans. This
            can&apos;t be undone.
          </p>
          <button
            onClick={() => setConfirmingDelete(true)}
            className="w-full py-2.5 rounded-xl border border-red-500 text-red-500 font-semibold flex items-center justify-center gap-2"
          >
            <Trash2 size={16} /> Delete Profile
          </button>
        </div>

        {confirmingDelete && (
          <div className="p-4 rounded-xl bg-panel flex flex-col gap-3">
            <p className="text-sm font-semibold text-main-text">Delete Profile?</p>
            <p className="text-xs text-minor-text">{deleteWarning}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingDelete(false)} className="flex-1 py-2 rounded-lg border border-minor-text/40 text-main-text text-sm font-semibold">
                Cancel
              </button>
              <button onClick={deleteProfile} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold">
                Delete
              </button>
            </div>
          </div>
        )}

        {confirmingBlockReset && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" onClick={() => setConfirmingBlockReset(null)}>
            <div className="bg-background rounded-2xl p-5 max-w-xs w-full flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-main-text">{confirmingBlockReset.message}</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmingBlockReset(null)} className="flex-1 py-2 rounded-lg border border-minor-text/40 text-main-text text-sm font-semibold">
                  Cancel
                </button>
                <button onClick={confirmBlockReset} className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-semibold">
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}

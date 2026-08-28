import { useState } from 'react'
import { Camera } from 'lucide-react'
import ProfileAvatar from '../components/ProfileAvatar'
import DistanceAndGoalSection from '../components/DistanceAndGoalSection'
import { db } from '../db/db'
import { newProfileDefaults } from '../db/profile'

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function LoginScreen() {
  const [name, setName] = useState('')
  const [sport, setSport] = useState('triathlon')
  const [imageData, setImageData] = useState(null)
  const [hasCompetition, setHasCompetition] = useState(false)
  const [excludeGymSessions, setExcludeGymSessions] = useState(false)
  const [bodyweightOnlyStrength, setBodyweightOnlyStrength] = useState(false)
  const [competitionName, setCompetitionName] = useState('')
  const [competitionDate, setCompetitionDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 3)
    return d.toISOString().slice(0, 10)
  })
  const [values, setValues] = useState({
    runningDistance: 'marathon',
    triathlonDistance: 'olympic',
    goalOverallTime: '',
    goalSwimTime: '',
    goalBikeTime: '',
    goalRunTime: '',
    trainingDaysPerWeek: 5,
    longSessionDays: [],
  })

  const trimmedName = name.trim()

  const onChange = (field, value) => setValues((v) => ({ ...v, [field]: value }))

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageData(await readFileAsDataURL(file))
  }

  const createProfile = async () => {
    if (!trimmedName) return
    const profile = newProfileDefaults({
      name: trimmedName,
      sport,
      imageData,
      competitionName: hasCompetition ? competitionName.trim() : '',
      competitionDate: hasCompetition ? new Date(competitionDate).toISOString() : null,
      excludeGymSessions,
      bodyweightOnlyStrength: excludeGymSessions && bodyweightOnlyStrength,
      strengthPreferenceConfigured: true,
      ...values,
      goalOverallTime: values.goalOverallTime.trim(),
      goalSwimTime: values.goalSwimTime.trim(),
      goalBikeTime: values.goalBikeTime.trim(),
      goalRunTime: values.goalRunTime.trim(),
    })
    await db.profile.put(profile)
  }

  return (
    <div className="min-h-screen bg-background overflow-y-auto">
      <div className="max-w-md mx-auto px-4 pb-12 flex flex-col gap-7">
        <div className="text-center pt-10 flex flex-col gap-2">
          <h1 className="font-display font-bold text-2xl text-main-text">Welcome to Cadence!</h1>
          <p className="text-sm text-minor-text">
            Set up your profile to get started. You can change this anytime from the Profile page.
          </p>
        </div>

        <label className="relative self-center cursor-pointer">
          <ProfileAvatar imageData={imageData} name={trimmedName} diameter={110} />
          <span className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5">
            <Camera size={28} className="text-accent" />
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
        </label>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-minor-text">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-minor-text">Training for</label>
          <div className="grid grid-cols-2 gap-1 bg-panel rounded-xl p-1">
            {['running', 'triathlon'].map((s) => (
              <button
                key={s}
                onClick={() => setSport(s)}
                className={`py-2 rounded-lg text-sm font-semibold capitalize ${
                  sport === s ? 'bg-accent text-white' : 'text-main-text'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <DistanceAndGoalSection sport={sport} values={values} onChange={onChange} />

        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-main-text">Do not include gym sessions in my training plan</span>
            <input
              type="checkbox"
              checked={excludeGymSessions}
              onChange={(e) => {
                const excluded = e.target.checked
                setExcludeGymSessions(excluded)
                if (!excluded) setBodyweightOnlyStrength(false)
              }}
              className="w-5 h-5 accent-[var(--color-accent)] shrink-0"
            />
          </label>
          <p className="text-xs text-minor-text">
            {excludeGymSessions
              ? 'Your generated plan won\u2019t include gym sessions unless you choose bodyweight exercises below.'
              : 'Turn this on if you only want to use Cadence for running/triathlon training, without gym work.'}
          </p>

          {excludeGymSessions && (
            <>
              <label className="flex items-center justify-between gap-3 pl-3 mt-1">
                <span className="text-sm text-main-text">Include bodyweight exercises in my training plan</span>
                <input
                  type="checkbox"
                  checked={bodyweightOnlyStrength}
                  onChange={(e) => setBodyweightOnlyStrength(e.target.checked)}
                  className="w-5 h-5 accent-[var(--color-accent)] shrink-0"
                />
              </label>
              {!bodyweightOnlyStrength && (
                <div className="ml-3 p-3 rounded-xl bg-red-500/10">
                  <p className="text-xs text-red-600">
                    Your training plan won&apos;t include any strength exercise to support your{' '}
                    {sport === 'triathlon' ? 'triathlon' : 'running'} training. Are you sure you want to continue?
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between">
            <span className="text-sm text-main-text">Training for a specific competition</span>
            <input
              type="checkbox"
              checked={hasCompetition}
              onChange={(e) => setHasCompetition(e.target.checked)}
              className="accent-[var(--color-accent)] w-5 h-5"
            />
          </label>
          {hasCompetition && (
            <>
              <input
                type="text"
                value={competitionName}
                onChange={(e) => setCompetitionName(e.target.value)}
                placeholder="Competition name (e.g. Hamburg Marathon)"
                className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
              />
              <input
                type="date"
                value={competitionDate}
                onChange={(e) => setCompetitionDate(e.target.value)}
                className="w-full p-3 rounded-xl bg-panel text-main-text outline-none"
              />
            </>
          )}
        </div>

        <button
          onClick={createProfile}
          disabled={!trimmedName}
          className="w-full py-3 rounded-xl bg-accent text-white font-semibold disabled:opacity-40"
        >
          Get Started
        </button>
      </div>
    </div>
  )
}

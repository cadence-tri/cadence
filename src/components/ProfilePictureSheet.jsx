import { useRef } from 'react'
import ProfileAvatar from './ProfileAvatar'
import wordmark from '../assets/cadence-wordmark.jpg'
import logoIcon from '../assets/cadence-logo.png'
import { RUNNING_META, TRIATHLON_META } from '../db/raceDistance'

/** "Training for: X" — the race/competition name when one's set, falling
 * back to the target distance itself (e.g. "Marathon", "Olympic
 * Triathlon") so the line is never blank just because no specific
 * competition has been picked yet. */
function trainingForLine(profile) {
  if (profile.competitionDate) {
    return `Training for: ${profile.competitionName?.trim() || 'your race'}`
  }
  const distanceLabel =
    profile.sport === 'running'
      ? RUNNING_META[profile.runningDistance]?.displayName
      : TRIATHLON_META[profile.triathlonDistance]
        ? `${TRIATHLON_META[profile.triathlonDistance].displayName} Triathlon`
        : null
  return distanceLabel ? `Training for: ${distanceLabel}` : null
}

/** Full-screen "who's training" view — opened by tapping the avatar on
 * ProfileSheet instead of the photo picker opening immediately, so the
 * athlete sees their profile at a glance before deciding to change the
 * picture. "Update profile picture" is the only way in from here to the
 * actual file picker — tapping the photo itself does nothing. Ported from
 * ProfileView.swift's `ProfilePictureSheet`, with an added streak line
 * (native only shows the streak as a flame badge on the Daily header, not
 * here — added here too since this screen is otherwise the "profile at a
 * glance" summary). */
export default function ProfilePictureSheet({ profile, weekStreak, onClose, onPickPhoto }) {
  const fileRef = useRef(null)

  const targetTimeLine = profile.goalOverallTime?.trim() ? `Target time: ${profile.goalOverallTime.trim()}` : null

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 shrink-0">
        <button onClick={onClose} className="text-accent">
          Done
        </button>
        <button onClick={() => fileRef.current?.click()} className="text-accent font-semibold">
          Update profile picture
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onPickPhoto(e)
        }}
      />

      <div className="flex-1 flex flex-col items-center justify-between px-6 pb-8 pt-4">
        <div className="flex flex-col items-center gap-5 pt-2">
          <ProfileAvatar imageData={profile.imageData} name={profile.name} diameter={200} />
          <div className="text-center flex flex-col gap-1.5">
            <h2 className="font-display font-bold text-2xl text-main-text">{profile.name || 'Athlete'}</h2>
            {trainingForLine(profile) && <p className="text-sm text-minor-text">{trainingForLine(profile)}</p>}
            {targetTimeLine && <p className="text-sm text-minor-text">{targetTimeLine}</p>}
            {weekStreak > 0 && (
              <p className="text-sm text-minor-text flex items-center justify-center gap-1.5">
                <img src={logoIcon} alt="Cadence" className="w-4 h-4 rounded-[3px]" />
                streak: {weekStreak}
              </p>
            )}
          </div>
        </div>
        <img src={wordmark} alt="" className="w-28 opacity-55" />
      </div>
    </div>
  )
}

import { Flame } from 'lucide-react'
import ProfileAvatar from './ProfileAvatar'
import { format } from 'date-fns'

/** Header shown at the top of the Daily tab — avatar, name, "Training
 * for:" line, and a week-streak badge. Ported from ProfileHeaderBar.swift. */
export default function ProfileHeaderBar({ profile, weekStreak, onTap }) {
  const competitionLine = profile.competitionDate
    ? `Training for: ${profile.competitionName?.trim() || 'race'} · ${format(
        new Date(profile.competitionDate),
        'MMM d, yyyy'
      )}`
    : null

  return (
    <div className="flex items-start gap-3">
      <button onClick={onTap} className="flex items-center gap-3 text-left min-w-0">
        <ProfileAvatar imageData={profile.imageData} name={profile.name} diameter={64} showsBorder={false} />
        <div className="min-w-0">
          <div className="font-display font-bold text-2xl text-main-text truncate">{profile.name}</div>
          {competitionLine && <div className="text-sm text-minor-text truncate">{competitionLine}</div>}
        </div>
      </button>
      <div className="flex-1" />
      {weekStreak > 0 && (
        <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-panel shrink-0">
          <Flame size={16} className="text-accent" fill="currentColor" />
          <span className="text-sm font-bold text-main-text">{weekStreak}</span>
        </div>
      )}
    </div>
  )
}

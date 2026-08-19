import CompletionRing from './CompletionRing'
import { disciplineIcon, disciplineColor } from '../db/discipline'
import { completionFraction, isFullyCompleted, withAllSetsCompleted } from '../db/session'

export function OptionalBadge() {
  return (
    <span className="text-[10px] font-semibold text-minor-text bg-minor-text/15 px-1.5 py-0.5 rounded-full">
      Optional
    </span>
  )
}

/** A single session row — discipline icon, title, item count, completion
 * ring. Ported from DailyView.swift's `SessionRow`. */
export default function SessionRow({ session, onTap, onToggle }) {
  const Icon = disciplineIcon(session.discipline)
  const color = disciplineColor(session.discipline)
  const fraction = completionFraction(session)
  const done = isFullyCompleted(session)

  return (
    <div className="flex items-center gap-3 py-2.5 cursor-pointer" onClick={() => onTap?.(session)}>
      <Icon size={20} style={{ color }} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate ${done ? 'line-through text-minor-text' : 'text-main-text'}`}>
            {session.title}
          </span>
          {session.isOptional && <OptionalBadge />}
        </div>
        {session.sets?.length > 0 && (
          <div className="text-xs text-minor-text">
            {session.sets.filter((s) => s.isCompleted).length}/{session.sets.length} items
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggle?.(withAllSetsCompleted(session, !done))
        }}
        className="shrink-0"
        aria-label="Toggle completion"
      >
        <CompletionRing fraction={fraction} color={color} size={26} strokeWidth={3} />
      </button>
    </div>
  )
}

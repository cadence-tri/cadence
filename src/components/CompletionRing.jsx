import { Check } from 'lucide-react'

/** Small activity-ring indicator — ported from CompletionRing.swift. */
export default function CompletionRing({ fraction, color, size = 26, strokeWidth = 3 }) {
  const clamped = Math.min(Math.max(fraction, 0), 1)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashoffset = circumference * (1 - clamped)

  return (
    <div style={{ width: size, height: size }} className="relative shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeOpacity={0.2}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {clamped >= 1 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Check size={size * 0.35} color={color} strokeWidth={3} />
        </div>
      )}
    </div>
  )
}

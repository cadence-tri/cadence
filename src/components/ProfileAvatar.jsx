/** Circular avatar — photo if set, else a tinted circle with the athlete's
 * initial. Ported from ProfileAvatar.swift. */
export default function ProfileAvatar({ imageData, name, diameter = 60, showsBorder = true }) {
  const initial = (name ?? '').trim().charAt(0).toUpperCase() || '?'

  return (
    <div
      style={{ width: diameter, height: diameter }}
      className={`rounded-full overflow-hidden shrink-0 flex items-center justify-center ${
        showsBorder ? 'ring-1 ring-minor-text/20' : ''
      }`}
    >
      {imageData ? (
        <img src={imageData} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-accent/18">
          <span
            style={{ fontSize: diameter * 0.42 }}
            className="font-semibold text-accent"
          >
            {initial}
          </span>
        </div>
      )}
    </div>
  )
}

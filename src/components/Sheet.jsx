import { X } from 'lucide-react'

/**
 * Bottom-sheet-style modal, standing in for SwiftUI's `.sheet(...)`.
 * Full height on mobile, centered card with max width on larger screens.
 */
export default function Sheet({ title, onClose, children, footer, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`bg-background w-full ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        } sm:rounded-2xl rounded-t-2xl h-[92vh] sm:h-[85vh] flex flex-col shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-minor-text/15 shrink-0">
          <div className="w-8" />
          <h2 className="font-display font-semibold text-main-text truncate">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-minor-text hover:bg-panel"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-minor-text/15 p-3 shrink-0">{footer}</div>}
      </div>
    </div>
  )
}

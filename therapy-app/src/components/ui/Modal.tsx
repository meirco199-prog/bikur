import { type ReactNode, useEffect } from 'react'

// חלון מודאלי כללי לטפסים והודעות
interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  maxWidth?: string
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-calm-900/30 backdrop-blur-sm" />
      <div
        className={`relative card w-full ${maxWidth} max-h-[90vh] overflow-y-auto animate-in`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-calm-100 px-5 py-4">
          <h3 className="text-lg font-semibold text-calm-800">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-calm-400 hover:bg-calm-100 hover:text-calm-700"
            aria-label="סגור"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

import { Modal } from './Modal'

// דיאלוג אישור — מוצג כאזהרה לפני מחיקת מידע
interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title = 'אישור מחיקה',
  message,
  confirmLabel = 'מחק',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} maxWidth="max-w-md">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warmth-100 text-xl">
          ⚠️
        </div>
        <p className="pt-1.5 text-calm-700 leading-relaxed">{message}</p>
      </div>
      <div className="mt-6 flex justify-start gap-2">
        <button className="btn-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="btn-soft" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </Modal>
  )
}

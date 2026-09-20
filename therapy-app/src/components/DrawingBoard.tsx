import { useEffect, useRef, useState } from 'react'

// ===== לוח ציור לילד =====
// Canvas עם תמיכה בעכבר ובמגע (אצבע). כלים: צבע, מחק, עובי קו, ניקוי, שמירה.
// בעת שמירה — מוחזר Data URL של התמונה (PNG) דרך onSave.

const COLORS = [
  '#3b5c77', // כחול רגוע
  '#db6a45', // כתום חמים
  '#36967c', // ירוק מנטה
  '#e0b73a', // צהוב
  '#9b5fb0', // סגול
  '#d94f6e', // ורוד
  '#000000', // שחור
  '#7da9c4', // תכלת
]

interface DrawingBoardProps {
  /** כותרת/הנחיה המוצגת לילד */
  prompt: string
  /** ציור קיים לטעינה (Data URL) — לעריכה */
  initialImage?: string
  onSave: (dataUrl: string) => void
  onClose: () => void
}

export function DrawingBoard({
  prompt,
  initialImage,
  onSave,
  onClose,
}: DrawingBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const drawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(6)
  const [isEraser, setIsEraser] = useState(false)

  // אתחול הקנבס בהתאם לגודל המכל, עם שמירת יחס פיקסלים למסכים חדים
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement!
    const ratio = window.devicePixelRatio || 1
    const w = parent.clientWidth
    const h = parent.clientHeight
    canvas.width = w * ratio
    canvas.height = h * ratio
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctxRef.current = ctx

    // טעינת ציור קיים אם נמסר
    if (initialImage) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, w, h)
      img.src = initialImage
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent) => {
    e.preventDefault()
    drawing.current = true
    lastPos.current = getPos(e)
    // נקודה בודדת (קליק) — מציירת עיגול קטן
    draw(e)
  }

  const draw = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const ctx = ctxRef.current
    if (!ctx) return
    const pos = getPos(e)
    ctx.strokeStyle = isEraser ? '#ffffff' : color
    ctx.lineWidth = isEraser ? width * 3 : width
    ctx.beginPath()
    const from = lastPos.current ?? pos
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPos.current = pos
  }

  const end = () => {
    drawing.current = false
    lastPos.current = null
  }

  const clearBoard = () => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  const save = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    onSave(canvas.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-calm-50">
      {/* כותרת והנחיה */}
      <div className="flex items-center justify-between gap-3 border-b border-calm-100 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-calm-400">לוח ציור</p>
          <p className="truncate font-semibold text-calm-800">
            🎨 {prompt || 'ציור חופשי'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="btn-ghost shrink-0"
          aria-label="סגור"
        >
          ✕ סגירה
        </button>
      </div>

      {/* סרגל כלים */}
      <div className="flex flex-wrap items-center gap-3 border-b border-calm-100 bg-white px-4 py-3">
        {/* צבעים */}
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c)
                setIsEraser(false)
              }}
              className={`h-7 w-7 rounded-full border-2 transition ${
                color === c && !isEraser
                  ? 'border-calm-800 scale-110'
                  : 'border-white'
              }`}
              style={{ backgroundColor: c }}
              aria-label={`צבע ${c}`}
            />
          ))}
        </div>

        <div className="h-6 w-px bg-calm-200" />

        {/* מחק */}
        <button
          onClick={() => setIsEraser((v) => !v)}
          className={`chip ${
            isEraser
              ? 'border-calm-400 bg-calm-500 text-white'
              : 'border-calm-200 bg-white text-calm-600'
          }`}
        >
          🩹 מחק
        </button>

        {/* עובי קו */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-calm-500">עובי</span>
          <input
            type="range"
            min={2}
            max={30}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="accent-calm-500"
          />
          <span
            className="inline-block rounded-full bg-calm-700"
            style={{ width: width, height: width }}
          />
        </div>

        <div className="ms-auto flex gap-2">
          <button className="btn-soft" onClick={clearBoard}>
            🧹 ניקוי
          </button>
          <button className="btn-mint" onClick={save}>
            💾 שמירה
          </button>
        </div>
      </div>

      {/* אזור הציור */}
      <div className="flex-1 p-3">
        <div className="h-full w-full overflow-hidden rounded-2xl bg-white shadow-card">
          <canvas
            ref={canvasRef}
            className="h-full w-full touch-none"
            onPointerDown={start}
            onPointerMove={draw}
            onPointerUp={end}
            onPointerLeave={end}
            onPointerCancel={end}
          />
        </div>
      </div>
    </div>
  )
}

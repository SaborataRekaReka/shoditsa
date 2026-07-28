import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import './ArcGameCarousel.css'

type ArcGameCarouselItem = {
  id: string
  content: ReactElement
}

type ArcGeometry = {
  cardWidth: number
  cardHeight: number
  coverHeight: number
  radius: number
  viewportHeight: number
}

type DragState = {
  pointerId: number
  startX: number
  lastX: number
  lastAt: number
  velocity: number
  startIndex: number
}

const CYCLES = 10
const MAX_VISIBLE_DISTANCE = 4

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor

const circularDistance = (slotIndex: number, currentIndex: number, slotCount: number) => {
  const forward = modulo(slotIndex - currentIndex, slotCount)
  return forward > slotCount / 2 ? forward - slotCount : forward
}

export function ArcGameCarousel({ items }: { items: ArcGameCarouselItem[] }) {
  const shellRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const dragOffsetRef = useRef(0)
  const movedRef = useRef(false)
  const slotCount = Math.max(items.length * CYCLES, items.length)
  const angleStep = 360 / slotCount
  const initialIndex = items.length * Math.floor(CYCLES / 2)
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [geometry, setGeometry] = useState<ArcGeometry>({
    cardWidth: 286,
    cardHeight: 520,
    coverHeight: 340,
    radius: 3000,
    viewportHeight: 590,
  })

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return

    const updateGeometry = () => {
      const width = shell.clientWidth
      const compact = width < 640
      const cardWidth = compact
        ? clamp(Math.round(width * .58), 196, 222)
        : clamp(Math.round(width * .235), 250, 270)
      const cardHeight = compact ? 432 : 520
      const coverHeight = compact ? 270 : 340
      const radius = Math.max(cardWidth * 13, width * 3.2)
      setGeometry({
        cardWidth,
        cardHeight,
        coverHeight,
        radius,
        viewportHeight: cardHeight + (compact ? 76 : 105),
      })
    }

    updateGeometry()
    const observer = new ResizeObserver(updateGeometry)
    observer.observe(shell)
    return () => observer.disconnect()
  }, [])

  const pixelsPerItem = geometry.cardWidth * .48
  const rotation = -(currentIndex * angleStep) + (dragOffset / pixelsPerItem) * angleStep
  const centeredItemIndex = modulo(currentIndex, items.length)
  const centerLabel = items[centeredItemIndex]?.id ?? ''

  const slots = useMemo(
    () => Array.from({ length: slotCount }, (_, slotIndex) => ({
      slotIndex,
      item: items[slotIndex % items.length],
      angle: slotIndex * angleStep,
    })),
    [angleStep, items, slotCount],
  )

  const finishPointer = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const projectedOffset = dragOffsetRef.current + drag.velocity * 150
    const stepDelta = cancelled || !movedRef.current
      ? 0
      : clamp(Math.round(-projectedOffset / pixelsPerItem), -4, 4)

    setCurrentIndex(drag.startIndex + stepDelta)
    setDragOffset(0)
    dragOffsetRef.current = 0
    dragRef.current = null
    setIsDragging(false)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const now = performance.now()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastAt: now,
      velocity: 0,
      startIndex: currentIndex,
    }
    movedRef.current = false
    dragOffsetRef.current = 0
    setDragOffset(0)
    setIsDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const now = performance.now()
    const elapsed = Math.max(1, now - drag.lastAt)
    const offset = event.clientX - drag.startX
    drag.velocity = (event.clientX - drag.lastX) / elapsed
    drag.lastX = event.clientX
    drag.lastAt = now
    movedRef.current ||= Math.abs(offset) > 6
    dragOffsetRef.current = offset
    setDragOffset(offset)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setCurrentIndex((value) => value + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setCurrentIndex((value) => value - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setCurrentIndex(initialIndex)
    } else if (event.key === 'Escape') {
      event.currentTarget.blur()
    }
  }

  const cssVariables = {
    '--arc-card-width': `${geometry.cardWidth}px`,
    '--arc-card-height': `${geometry.cardHeight}px`,
    '--arc-cover-height': `${geometry.coverHeight}px`,
    '--arc-radius': `${geometry.radius}px`,
    '--arc-viewport-height': `${geometry.viewportHeight}px`,
  } as CSSProperties

  const ringStyle = {
    width: geometry.cardWidth,
    marginLeft: -geometry.cardWidth / 2,
    transformOrigin: `${geometry.cardWidth / 2}px ${geometry.radius}px`,
    transform: `translate3d(0, 0, 0) rotate(${rotation}deg)`,
  } as CSSProperties

  return <div ref={shellRef} className="arc-game-carousel category-grid--active" style={cssVariables}>
    <div
      className={`arc-game-carousel__viewport ${isDragging ? 'is-dragging' : ''}`}
      role="region"
      aria-roledescription="карусель"
      aria-label="Игры основного маршрута. Перетаскивайте карточки или используйте клавиши со стрелками."
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishPointer(event)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onClickCapture={(event) => {
        if (!movedRef.current) return
        event.preventDefault()
        event.stopPropagation()
        movedRef.current = false
      }}
    >
      <div className="arc-game-carousel__ring" style={ringStyle}>
        {slots.map(({ slotIndex, item, angle }) => {
          const distance = circularDistance(slotIndex, currentIndex, slotCount)
          const visible = Math.abs(distance) <= MAX_VISIBLE_DISTANCE
          const slotStyle = {
            height: geometry.radius,
            transformOrigin: `${geometry.cardWidth / 2}px ${geometry.radius}px`,
            transform: `rotate(${angle}deg)`,
            zIndex: 100 - Math.abs(distance),
            opacity: visible ? 1 : 0,
            visibility: visible ? 'visible' : 'hidden',
            pointerEvents: visible ? 'auto' : 'none',
          } as CSSProperties

          return <div
            className="arc-game-carousel__slot"
            data-arc-center={distance === 0 ? 'true' : undefined}
            style={slotStyle}
            key={`${item.id}-${slotIndex}`}
            aria-hidden={!visible}
            inert={!visible}
          >
            {item.content}
          </div>
        })}
      </div>
    </div>
    <div className="arc-game-carousel__status" aria-live="polite">
      <span>{String(centeredItemIndex + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}</span>
      <span>{centerLabel}</span>
    </div>
  </div>
}

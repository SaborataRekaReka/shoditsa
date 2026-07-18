import { useRef, useState, type ReactNode } from 'react'

export function HorizontalScrollLane({ className, children }: { className: string; children: ReactNode }) {
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ pointerId: -1, startX: 0, startScrollLeft: 0, moved: false })
  const [isDragging, setIsDragging] = useState(false)

  const stopDrag = (pointerId: number) => {
    const lane = laneRef.current
    if (!lane) return
    if (lane.hasPointerCapture(pointerId)) lane.releasePointerCapture(pointerId)
    const shouldResetAfterClick = dragRef.current.moved
    dragRef.current.pointerId = -1
    setIsDragging(false)
    if (shouldResetAfterClick) requestAnimationFrame(() => { dragRef.current.moved = false })
  }

  return <div
    ref={laneRef}
    className={`${className} ${isDragging ? 'is-dragging' : ''}`.trim()}
    onWheel={(event) => {
      const lane = laneRef.current
      if (!lane || lane.scrollWidth <= lane.clientWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      lane.scrollLeft += delta
      event.preventDefault()
    }}
    onPointerDown={(event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      const lane = laneRef.current
      if (!lane || lane.scrollWidth <= lane.clientWidth) return
      dragRef.current.pointerId = event.pointerId
      dragRef.current.startX = event.clientX
      dragRef.current.startScrollLeft = lane.scrollLeft
      dragRef.current.moved = false
      lane.setPointerCapture(event.pointerId)
      setIsDragging(true)
    }}
    onPointerMove={(event) => {
      const lane = laneRef.current
      if (!lane || dragRef.current.pointerId !== event.pointerId) return
      const dx = event.clientX - dragRef.current.startX
      if (Math.abs(dx) > 4) dragRef.current.moved = true
      lane.scrollLeft = dragRef.current.startScrollLeft - dx
    }}
    onPointerUp={(event) => stopDrag(event.pointerId)}
    onPointerCancel={(event) => stopDrag(event.pointerId)}
    onPointerLeave={(event) => {
      if (event.pointerType === 'mouse' && dragRef.current.pointerId === event.pointerId) stopDrag(event.pointerId)
    }}
    onClickCapture={(event) => {
      if (!dragRef.current.moved) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current.moved = false
    }}
  >
    {children}
  </div>
}

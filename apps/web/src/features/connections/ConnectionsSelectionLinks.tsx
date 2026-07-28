import { useLayoutEffect, useState, type RefObject } from 'react'

type TileBox = {
  centerX: number
  centerY: number
  top: number
  bottom: number
}

type SelectionLink = {
  from: string
  to: string
  path: string
}

const round = (value: number) => Math.round(value * 10) / 10

const linkPath = (from: TileBox, to: TileBox, order: number) => {
  const sameRow = Math.abs(from.centerY - to.centerY) < 8

  if (sameRow) {
    const routeY = Math.max(5, Math.min(from.top, to.top) - 18 - order * 7)
    const direction = Math.sign(to.centerX - from.centerX) || 1
    const corner = Math.min(12, Math.abs(to.centerX - from.centerX) / 4)

    return [
      `M ${round(from.centerX)} ${round(from.top)}`,
      `V ${round(routeY + corner)}`,
      `Q ${round(from.centerX)} ${round(routeY)} ${round(from.centerX + corner * direction)} ${round(routeY)}`,
      `H ${round(to.centerX - corner * direction)}`,
      `Q ${round(to.centerX)} ${round(routeY)} ${round(to.centerX)} ${round(routeY + corner)}`,
      `V ${round(to.top)}`,
    ].join(' ')
  }

  const movingDown = to.centerY > from.centerY
  const startY = movingDown ? from.bottom : from.top
  const endY = movingDown ? to.top : to.bottom
  const midpointY = round((startY + endY) / 2)
  const direction = Math.sign(to.centerX - from.centerX) || 1
  const verticalDirection = movingDown ? 1 : -1
  const corner = Math.min(8, Math.abs(endY - startY) / 4, Math.abs(to.centerX - from.centerX) / 4)

  return [
    `M ${round(from.centerX)} ${round(startY)}`,
    `V ${round(midpointY - corner * verticalDirection)}`,
    `Q ${round(from.centerX)} ${midpointY} ${round(from.centerX + corner * direction)} ${midpointY}`,
    `H ${round(to.centerX - corner * direction)}`,
    `Q ${round(to.centerX)} ${midpointY} ${round(to.centerX)} ${round(midpointY + corner * verticalDirection)}`,
    `V ${round(endY)}`,
  ].join(' ')
}

export function ConnectionsSelectionLinks({
  hostRef,
  tileRefs,
  selected,
  layoutKey,
}: {
  hostRef: RefObject<HTMLDivElement | null>
  tileRefs: RefObject<Map<string, HTMLButtonElement>>
  selected: string[]
  layoutKey: string
}) {
  const [links, setLinks] = useState<SelectionLink[]>([])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || selected.length < 2) {
      setLinks([])
      return
    }

    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const hostBox = host.getBoundingClientRect()
        const boxes = selected.map((tileId) => {
          const tile = tileRefs.current.get(tileId)
          if (!tile) return null
          const box = tile.getBoundingClientRect()
          return {
            centerX: box.left - hostBox.left + box.width / 2,
            centerY: box.top - hostBox.top + box.height / 2,
            top: box.top - hostBox.top,
            bottom: box.bottom - hostBox.top,
          }
        })

        const nextLinks: SelectionLink[] = []
        for (let index = 1; index < selected.length; index += 1) {
          const from = boxes[index - 1]
          const to = boxes[index]
          if (!from || !to) continue
          nextLinks.push({
            from: selected[index - 1],
            to: selected[index],
            path: linkPath(from, to, index - 1),
          })
        }
        setLinks(nextLinks)
      })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    selected.forEach((tileId) => {
      const tile = tileRefs.current.get(tileId)
      if (tile) observer.observe(tile)
    })
    window.addEventListener('resize', update)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [hostRef, layoutKey, selected, tileRefs])

  if (links.length === 0) return null

  return <svg className="connections-selection-links" aria-hidden="true">
    <defs>
      <marker id="connections-link-arrow" viewBox="0 0 6 6" refX="4.8" refY="3" markerWidth="5" markerHeight="5" orient="auto">
        <path d="M 0 0 L 6 3 L 0 6 Z" />
      </marker>
    </defs>
    {links.map((link, index) => (
      <path
        key={`${link.from}-${link.to}`}
        d={link.path}
        markerEnd="url(#connections-link-arrow)"
        style={{
          animationDelay: `${index * 90}ms, ${420 + index * 90}ms`,
        }}
      />
    ))}
  </svg>
}

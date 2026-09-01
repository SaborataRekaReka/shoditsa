import { useId, useMemo, type KeyboardEvent } from 'react'
import type { TerritoryMapPoint, TerritoryPublicSnapshot } from '@shoditsa/contracts'

type TerritoryMap = TerritoryPublicSnapshot['map']
type TerritoryOwnership = TerritoryPublicSnapshot['ownership']
type TerritoryPlayers = TerritoryPublicSnapshot['players']

const classNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')
const pointKey = ([x, y]: readonly [number, number]) => `${x.toFixed(3)},${y.toFixed(3)}`

const territoryStateLabel = (ownerUserId: string | null, currentMemberId: string) => {
  if (!ownerUserId) return 'нейтральная'
  return ownerUserId === currentMemberId ? 'ваша' : 'территория соперника'
}

export function TerritoryBoard({
  map,
  ownership,
  players,
  currentMemberId,
  legalCellIds,
  selectedCellId,
  capturedCellId,
  capitalTowers,
  siegeTargetCellId,
  disabled = false,
  onCapture,
}: {
  map: TerritoryMap
  ownership: TerritoryOwnership
  players: TerritoryPlayers
  currentMemberId: string
  legalCellIds: readonly string[]
  selectedCellId: string | null
  capturedCellId: string | null
  capitalTowers: Readonly<Record<string, number>>
  siegeTargetCellId: string | null
  disabled?: boolean
  onCapture: (cellId: string) => void
}) {
  const patternPrefix = useId().replace(/:/g, '')
  const lightPatternId = `${patternPrefix}-territory-light-pattern`
  const deepPatternId = `${patternPrefix}-territory-deep-pattern`
  const organicFilterId = `${patternPrefix}-territory-organic-filter`
  const legalCells = useMemo(() => new Set(legalCellIds), [legalCellIds])
  const playerByUserId = useMemo(() => new Map(players.map((player, index) => [player.userId, index] as const)), [players])
  const baseByCellId = useMemo(() => new Map(players.map((player, index) => [player.baseCellId, index] as const)), [players])
  const markerRadius = Math.max(20, Math.min(map.viewBox.width, map.viewBox.height) * .034)
  const organicSeed = useMemo(() => Array.from(map.seed).reduce((sum, character) => sum + character.charCodeAt(0), 17) % 997, [map.seed])
  const geometryBounds = useMemo(() => {
    const points = map.cells.flatMap((cell) => cell.polygon)
    if (!points.length) return {
      minX: map.viewBox.x,
      maxX: map.viewBox.x + map.viewBox.width,
      minY: map.viewBox.y,
      maxY: map.viewBox.y + map.viewBox.height,
    }
    return {
      minX: Math.min(...points.map(([x]) => x)),
      maxX: Math.max(...points.map(([x]) => x)),
      minY: Math.min(...points.map(([, y]) => y)),
      maxY: Math.max(...points.map(([, y]) => y)),
    }
  }, [map.cells, map.viewBox])
  const geometryWidth = Math.max(1, geometryBounds.maxX - geometryBounds.minX)
  const geometryHeight = Math.max(1, geometryBounds.maxY - geometryBounds.minY)
  const sourceAspect = geometryWidth / geometryHeight
  const horizontalScale = sourceAspect < 2.3 ? Math.min(1.7, 2.42 / sourceAspect) : 1
  const sourceCenterX = (geometryBounds.minX + geometryBounds.maxX) / 2
  const horizontalPadding = geometryWidth * horizontalScale * .035
  const verticalPadding = geometryHeight * .035
  const renderedWidth = geometryWidth * horizontalScale + horizontalPadding * 2
  const renderedHeight = geometryHeight + verticalPadding * 2
  const renderedX = sourceCenterX - renderedWidth / 2
  const renderedY = geometryBounds.minY - verticalPadding
  const projectX = (x: number) => sourceCenterX + (x - sourceCenterX) * horizontalScale
  const outerContour = useMemo(() => {
    const pointsByKey = new Map<string, TerritoryMapPoint>()
    const edges = new Map<string, { count: number; start: string; end: string }>()
    for (const cell of map.cells) {
      for (let index = 0; index < cell.polygon.length; index += 1) {
        const startPoint = cell.polygon[index]
        const endPoint = cell.polygon[(index + 1) % cell.polygon.length]
        const start = pointKey(startPoint)
        const end = pointKey(endPoint)
        pointsByKey.set(start, startPoint)
        pointsByKey.set(end, endPoint)
        const key = start < end ? `${start}|${end}` : `${end}|${start}`
        const edge = edges.get(key)
        if (edge) edge.count += 1
        else edges.set(key, { count: 1, start, end })
      }
    }
    const boundaryEdges = [...edges.values()].filter((edge) => edge.count === 1)
    if (boundaryEdges.length < 3) return []
    const neighbors = new Map<string, string[]>()
    for (const edge of boundaryEdges) {
      neighbors.set(edge.start, [...(neighbors.get(edge.start) ?? []), edge.end])
      neighbors.set(edge.end, [...(neighbors.get(edge.end) ?? []), edge.start])
    }
    const start = [...neighbors.keys()].sort((left, right) => {
      const leftPoint = pointsByKey.get(left)!
      const rightPoint = pointsByKey.get(right)!
      return leftPoint[0] - rightPoint[0] || leftPoint[1] - rightPoint[1]
    })[0]
    const contour: TerritoryMapPoint[] = []
    let previous: string | null = null
    let current = start
    for (let index = 0; index <= boundaryEdges.length; index += 1) {
      const point = pointsByKey.get(current)
      if (!point) break
      contour.push(point)
      const next = (neighbors.get(current) ?? []).find((candidate) => candidate !== previous)
      if (!next || next === start) break
      previous = current
      current = next
    }
    return contour.length >= 3 ? contour : []
  }, [map.cells])
  const outerContourPoints = outerContour.map(([x, y]) => `${projectX(x)},${y}`).join(' ')

  const activate = (cellId: string) => {
    if (disabled || !legalCells.has(cellId)) return
    onCapture(cellId)
  }

  const onRegionKeyDown = (event: KeyboardEvent<SVGGElement>, cellId: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activate(cellId)
  }

  return <div className="territory-map-shell">
    {map.cells.length > 0
      ? <svg
          className="territory-map"
          viewBox={`${renderedX} ${renderedY} ${renderedWidth} ${renderedHeight}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label={`Карта матча: ${map.cellCount} территорий. Доступно для захвата: ${legalCellIds.length}.`}
        >
          <defs>
            <pattern id={lightPatternId} width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" fill="var(--territory-player-light)" />
              <path d="M-2 8 8-2M2 10 10 2" fill="none" stroke="rgba(16, 39, 23, .2)" strokeWidth="1.2" />
            </pattern>
            <pattern id={deepPatternId} width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" fill="var(--territory-player-deep)" />
              <circle cx="2" cy="2" r=".85" fill="rgba(255, 255, 255, .24)" />
              <circle cx="6" cy="6" r=".65" fill="rgba(255, 255, 255, .18)" />
            </pattern>
            <filter id={organicFilterId} x="-4%" y="-5%" width="108%" height="110%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency=".008 .014" numOctaves="2" seed={organicSeed} result="territoryNoise" />
              <feDisplacementMap in="SourceGraphic" in2="territoryNoise" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
          {outerContourPoints && <polygon className="territory-map__rim-shadow" points={outerContourPoints} aria-hidden="true" />}
          {map.cells.map((cell, index) => {
            const ownerUserId = ownership[cell.id] ?? null
            const ownerIndex = ownerUserId ? playerByUserId.get(ownerUserId) : undefined
            const baseIndex = baseByCellId.get(cell.id)
            const legal = legalCells.has(cell.id)
            const selected = selectedCellId === cell.id
            const relation = territoryStateLabel(ownerUserId, currentMemberId)
            const capital = baseIndex === undefined ? '' : ` Столица игрока ${baseIndex === 0 ? 'А' : 'Б'} — ${players[baseIndex].displayName}.`
            const towers = baseIndex === undefined ? '' : ` Башен стоит: ${capitalTowers[cell.id] ?? 3} из 3.`
            const siege = siegeTargetCellId === cell.id ? ' Идёт осада.' : ''
            const availability = legal ? baseIndex === undefined ? ' Доступна для захвата.' : ' Доступна для осады.' : ' Сейчас недоступна для захвата.'
            const label = `Территория ${index + 1}, ценность ${cell.value} очков: ${relation}.${capital}${towers}${siege}${availability}`
            const fill = ownerIndex === 0
              ? `url(#${lightPatternId})`
              : ownerIndex === 1
                ? `url(#${deepPatternId})`
                : 'var(--territory-neutral)'
            const points = cell.polygon.map(([x, y]) => `${projectX(x)},${y}`).join(' ')
            const centerX = projectX(cell.center[0])
            return <g
              key={cell.id}
              className={classNames(
                'territory-map__region',
                ownerIndex === 0 && 'is-light',
                ownerIndex === 1 && 'is-deep',
                legal && !disabled && 'is-actionable',
                legal && 'is-legal',
                selected && 'is-selected',
                capturedCellId === cell.id && 'is-last-capture',
                siegeTargetCellId === cell.id && 'is-under-siege',
              )}
              role="button"
              tabIndex={0}
              focusable="true"
              aria-label={label}
              aria-disabled={!legal || disabled}
              aria-pressed={selected || undefined}
              onClick={() => activate(cell.id)}
              onKeyDown={(event) => onRegionKeyDown(event, cell.id)}
            >
              <polygon className="territory-map__shape" points={points} style={{ fill }} filter={`url(#${organicFilterId})`} />
              <polygon className="territory-map__hit" points={points} aria-hidden="true" />
              <text
                className="territory-map__value"
                x={centerX}
                y={cell.center[1] + (baseIndex === undefined ? 2 : markerRadius + 27)}
                aria-hidden="true"
              >
                {cell.value}
              </text>
              {baseIndex !== undefined && <g
                className={classNames('territory-map__capital', baseIndex === 0 ? 'is-light' : 'is-deep', siegeTargetCellId === cell.id && 'is-under-siege')}
                transform={`translate(${centerX} ${cell.center[1]})`}
                aria-hidden="true"
              >
                <circle className="territory-map__capital-outer" r={markerRadius} />
                <circle className="territory-map__capital-inner" r={markerRadius * .58} />
                {[0, 1, 2].map((towerIndex) => {
                  const remaining = capitalTowers[cell.id] ?? 3
                  const x = (towerIndex - 1) * markerRadius * .52
                  return <g
                    key={towerIndex}
                    className={classNames('territory-map__tower', towerIndex >= remaining && 'is-down')}
                    transform={`translate(${x} ${-markerRadius * .17})`}
                  >
                    <path d={`M${-markerRadius * .15} ${-markerRadius * .36}v${markerRadius * .72}h${markerRadius * .3}v${-markerRadius * .72}l${-markerRadius * .075} ${markerRadius * .09}l${-markerRadius * .075} ${-markerRadius * .09}l${-markerRadius * .075} ${markerRadius * .09}Z`} />
                  </g>
                })}
              </g>}
            </g>
          })}
          {outerContourPoints && <polygon className="territory-map__rim-line" points={outerContourPoints} aria-hidden="true" />}
        </svg>
      : <p className="territory-map__empty" role="status">Карта пока недоступна. Как только сервер подготовит территории, поле появится здесь.</p>}
  </div>
}

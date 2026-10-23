import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Flag, Maximize2, Minimize2 } from 'lucide-react'
import type { TerritoryPublicSnapshot } from '@shoditsa/contracts'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { createTerritoryBoardLayout } from './territory-board-layout'
import { TerritoryScenery } from './TerritoryScenery'
import './TerritoryBoard.css'

export function TerritoryBoard({ map, ownership, players, currentMemberId, legalCellIds, selectedCellId, capturedCellId, capitalTowers, siegeTargetCellId, disabled = false, onCapture }: {
  map: TerritoryPublicSnapshot['map']
  ownership: TerritoryPublicSnapshot['ownership']
  players: TerritoryPublicSnapshot['players']
  currentMemberId: string
  legalCellIds: readonly string[]
  selectedCellId: string | null
  capturedCellId: string | null
  capitalTowers: Readonly<Record<string, number>>
  siegeTargetCellId: string | null
  disabled?: boolean
  onCapture: (cellId: string) => void
}) {
  const [zoomed, setZoomed] = useState(false)
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const [celebration, setCelebration] = useState<{ id: string; serial: number } | null>(null)
  const previous = useRef({ seed: map.seed, ownership })
  const serial = useRef(0)
  const layout = useMemo(() => createTerritoryBoardLayout(map), [map])
  const legal = useMemo(() => new Set(legalCellIds), [legalCellIds])
  const artId = useId().replace(/:/g, '')
  const inspected = map.cells.find(cell => cell.id === inspectedId)
  const adjacent = new Set(inspected?.adjacentCellIds ?? [])
  const captured = layout.tiles.find(tile => tile.cell.id === celebration?.id)

  // Celebrate a received ownership change, never a click or an already-finished saved match.
  useEffect(() => {
    const before = previous.current
    previous.current = { seed: map.seed, ownership }
    if (before.seed !== map.seed) { setCelebration(null); return }
    const changed = Object.keys(ownership).filter(id => ownership[id] && before.ownership[id] !== ownership[id])
    const id = capturedCellId && changed.includes(capturedCellId) ? capturedCellId : changed[0]
    if (id) setCelebration({ id, serial: ++serial.current })
  }, [map.seed, ownership, capturedCellId])
  useEffect(() => {
    if (!celebration) return
    const timer = window.setTimeout(() => setCelebration(null), 1250)
    return () => window.clearTimeout(timer)
  }, [celebration])

  const activate = (cellId: string) => { if (!disabled && legal.has(cellId)) onCapture(cellId) }
  const onKeyDown = (event: KeyboardEvent<SVGGElement>, cellId: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activate(cellId)
  }
  const canChoose = !disabled && legal.size > 0

  return <section className={`territory-board${zoomed ? ' is-zoomed' : ''}`} aria-label="Карта территорий">
    <header className="territory-board__heading">
      <div><h2>{canChoose ? 'Какую землю займём?' : 'Твой маленький мир'}</h2><p>{canChoose ? 'Выбирай подсвеченную территорию' : 'Каждая земля приближает к победе'}</p></div>
      <QuestButton kind="outline" size="compact" aria-pressed={zoomed} onClick={() => setZoomed(value => !value)}>{zoomed ? <Minimize2 size={17} /> : <Maximize2 size={17} />}{zoomed ? 'Весь остров' : 'Увеличить'}</QuestButton>
    </header>
    {map.cells.length ? <div className="territory-board__viewport" tabIndex={zoomed ? 0 : undefined} aria-label={zoomed ? 'Увеличенный остров, прокрутка по горизонтали' : undefined}>
      <svg className="territory-board__scene" viewBox={layout.viewBox} role="group" aria-label={`Карта матча: ${map.cellCount} территорий. Доступно для захвата: ${disabled ? 0 : legal.size}.`}>
        <defs>
          <linearGradient id={`${artId}-cliff`} x1="0" x2=".3" y1="0" y2="1"><stop stopColor="var(--island-cliff-light)" /><stop offset="1" stopColor="var(--island-cliff)" /></linearGradient>
          <radialGradient id={`${artId}-leaf`} cx=".3" cy=".2" r=".85"><stop stopColor="var(--island-leaf-light)" /><stop offset="1" stopColor="var(--island-leaf)" /></radialGradient>
          <filter id={`${artId}-shadow`} x="-.2" y="-.4" width="1.4" height="1.8"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        <g className="territory-board__coast" aria-hidden="true">
          <path className="territory-board__waterline is-outer" d={layout.coastPath} transform="translate(0 40)" />
          <path className="territory-board__island-shadow" d={layout.coastPath} transform="translate(0 46)" filter={`url(#${artId}-shadow)`} />
          <path className="territory-board__waterline" d={layout.coastPath} transform="translate(0 36)" />
          <path className="territory-board__cliff" d={layout.coastPath} transform="translate(0 32)" fill={`url(#${artId}-cliff)`} />
          <path className="territory-board__shore" d={layout.coastPath} transform="translate(0 10)" />
          <path className="territory-board__ground" d={layout.coastPath} />
        </g>
        {layout.tiles.map(({ cell, center: [x, y], elevation, path, detailScale }) => {
          const owner = players.findIndex(player => player.userId === ownership[cell.id])
          const base = players.findIndex(player => player.baseCellId === cell.id)
          const canCapture = !disabled && legal.has(cell.id)
          const selected = selectedCellId === cell.id
          const mine = ownership[cell.id] === currentMemberId
          const towers = capitalTowers[cell.id] ?? 3
          const cellNumber = map.cells.findIndex(candidate => candidate.id === cell.id) + 1
          const label = `Территория ${cellNumber}, ${cell.value} очков: ${owner < 0 ? 'свободная' : mine ? 'ваша' : 'соперника'}.${base >= 0 ? ` Столица ${players[base].displayName}. Башен: ${towers} из 3.` : ''} ${canCapture ? 'Можно захватить.' : 'Сейчас недоступна для захвата.'}`
          const classes = ['territory-board__tile', owner === 0 ? 'is-mint' : owner === 1 ? 'is-violet' : 'is-neutral', base >= 0 && 'is-capital', canCapture && 'is-legal', selected && 'is-selected', celebration?.id === cell.id && 'is-celebrating', adjacent.has(cell.id) && 'is-neighbor', siegeTargetCellId === cell.id && 'is-under-siege'].filter(Boolean).join(' ')
          return <g key={cell.id} className={classes} transform={`translate(${x} ${y - elevation})`} role="button" tabIndex={0} aria-label={label} aria-disabled={!canCapture} aria-pressed={selected || undefined} data-cell-id={cell.id} onClick={() => activate(cell.id)} onKeyDown={event => onKeyDown(event, cell.id)} onPointerEnter={() => setInspectedId(cell.id)} onPointerLeave={() => setInspectedId(null)} onFocus={() => setInspectedId(cell.id)} onBlur={() => setInspectedId(null)}>
            <title>{label}</title>
            <defs>
              <linearGradient id={`${artId}-${cell.id}`} x1="0" x2=".65" y1="0" y2="1"><stop stopColor="var(--tile-top)" /><stop offset="1" stopColor="var(--tile-face)" /></linearGradient>
              <linearGradient id={`${artId}-${cell.id}-edge`} x1="0" x2=".3" y1="0" y2="1"><stop stopColor="var(--tile-edge-light)" /><stop offset="1" stopColor="var(--tile-edge)" /></linearGradient>
            </defs>
            <path className="territory-board__tile-shadow" d={path} transform="translate(0 19)" aria-hidden="true" />
            <g className="territory-board__piece" aria-hidden="true">
              <path className="territory-board__tile-depth" d={path} transform="translate(0 15)" fill={`url(#${artId}-${cell.id}-edge)`} />
              <path className="territory-board__tile-face" d={path} fill={`url(#${artId}-${cell.id})`} />
              <g className="territory-board__scenery" transform={`scale(${detailScale})`}>
                <TerritoryScenery capital={base >= 0} owned={owner >= 0} variant={cellNumber} towers={towers} leafGradient={`${artId}-leaf`} />
              </g>
              {selected && <ellipse className="territory-board__pending" cy="9" rx="35" ry="17" />}
            </g>
          </g>
        })}
        {/* Labels sit above the terrain so a raised foreground region cannot hide a cost. */}
        <g className="territory-board__labels" aria-hidden="true">
          {layout.tiles.map(({ cell, center: [x, y], elevation }) => {
            const owner = players.findIndex(player => player.userId === ownership[cell.id])
            const canCapture = !disabled && legal.has(cell.id)
            return <g key={cell.id} className={`territory-board__tile-label ${owner === 0 ? 'is-mint' : owner === 1 ? 'is-violet' : 'is-neutral'}${canCapture ? ' is-legal' : ''}`} transform={`translate(${x} ${y - elevation + 17})`} onClick={() => activate(cell.id)} onPointerEnter={() => setInspectedId(cell.id)} onPointerLeave={() => setInspectedId(null)}>
              <g className="territory-board__value"><rect x="-28" y="-11" width="56" height="23" rx="11.5" />
                {canCapture && <path className="territory-board__plus" d="M-20 0H-12M-16-4V4" />}
                <text x={canCapture ? 5 : 0} y="5.5">{cell.value}</text>
              </g>
            </g>
          })}
        </g>
        {captured && celebration && <g key={celebration.serial} className="territory-board__celebration" transform={`translate(${captured.center[0]} ${captured.center[1] - captured.elevation})`} aria-hidden="true">
          <ellipse className="territory-board__capture-ring" rx="43" ry="23" />
          {Array.from({ length: 7 }, (_, i) => <g key={i} transform={`rotate(${i * 51})`}><circle className="territory-board__spark" cx="0" cy="-32" r="4" /></g>)}
          <text className="territory-board__reward" y="-53">+{captured.cell.value}</text>
        </g>}
      </svg>
    </div> : <p role="status">Карта появится, когда сервер подготовит территории.</p>}
    <footer className="territory-board__legend">
      {players.map((player, index) => <span key={player.userId}><i className={index === 0 ? 'is-mint' : 'is-violet'} />{player.userId === currentMemberId ? 'Твои земли' : player.displayName}</span>)}
      <span><i className="is-neutral" />Свободные</span>
      <span><Flag size={14} />Столица, 3 башни</span>
      {zoomed && <small>Остров можно прокручивать влево и вправо</small>}
    </footer>
    <span className="territory-board__announcement" role="status">{captured ? `${ownership[captured.cell.id] === currentMemberId ? 'Твоя новая территория' : 'Соперник захватил территорию'}: ${captured.cell.value} очков.` : ''}</span>
  </section>
}

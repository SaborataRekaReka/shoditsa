import { describe, expect, it } from 'vitest'
import {
  applyTerritoryCapture,
  createInitialTerritoryOwnership,
  createTerritoryFallbackMap,
  createTerritoryMap,
  legalTerritoryCaptures,
  resolveTerritoryDuel,
  resolveTerritoryMatch,
  resolveTerritorySiegeDuel,
  territoryAnswerDistance,
  territoryGraphDistance,
  territoryMajority,
  validateTerritoryMap,
  validateTerritoryQuestion,
} from '../src/territory'

const playerIds = ['player-1', 'player-2'] as const

const geometryMetrics = (map: ReturnType<typeof createTerritoryMap>) => {
  const points = map.cells.flatMap((cell) => cell.polygon)
  const minX = Math.min(...points.map((point) => point[0]))
  const maxX = Math.max(...points.map((point) => point[0]))
  const minY = Math.min(...points.map((point) => point[1]))
  const maxY = Math.max(...points.map((point) => point[1]))
  const width = maxX - minX
  const height = maxY - minY
  const bases = map.baseCellIds.map((baseId) => map.cells.find((cell) => cell.id === baseId)!)
  return { width, height, aspect: width / height, baseHorizontalDistance: Math.abs(bases[0].center[0] - bases[1].center[0]) }
}

const stratifiedRowCounts = (map: ReturnType<typeof createTerritoryMap>) => {
  const sortedY = map.cells.map((cell) => cell.center[1]).sort((left, right) => left - right)
  const rowBreaks = sortedY.slice(1)
    .map((value, index) => ({ index: index + 1, gap: value - sortedY[index] }))
    .sort((left, right) => right.gap - left.gap)
    .slice(0, 2)
    .map(({ index }) => index)
    .sort((left, right) => left - right)
  return [rowBreaks[0], rowBreaks[1] - rowBreaks[0], map.cellCount - rowBreaks[1]].sort((left, right) => left - right)
}

const maximumSharedVertexIncidence = (map: ReturnType<typeof createTerritoryMap>) => {
  const ownersByPoint = new Map<string, Set<string>>()
  for (const cell of map.cells) {
    for (const point of cell.polygon) {
      const key = `${point[0].toFixed(3)},${point[1].toFixed(3)}`
      const owners = ownersByPoint.get(key) ?? new Set<string>()
      owners.add(cell.id)
      ownersByPoint.set(key, owners)
    }
  }
  return Math.max(...[...ownersByPoint.values()].map((owners) => owners.size))
}

const polygonArea = (polygon: Array<readonly [number, number]>) => Math.abs(polygon.reduce((area, point, index) => {
  const next = polygon[(index + 1) % polygon.length]
  return area + point[0] * next[1] - next[0] * point[1]
}, 0) / 2)

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const pointToSegmentDistance = (
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
) => {
  const deltaX = end[0] - start[0]
  const deltaY = end[1] - start[1]
  const lengthSquared = deltaX ** 2 + deltaY ** 2
  const projection = lengthSquared
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared))
    : 0
  return Math.hypot(point[0] - start[0] - deltaX * projection, point[1] - start[1] - deltaY * projection)
}

const markerClearance = (cell: ReturnType<typeof createTerritoryMap>['cells'][number]) => Math.min(
  ...cell.polygon.map((point, index) => pointToSegmentDistance(cell.center, point, cell.polygon[(index + 1) % cell.polygon.length])),
)

const labelClearanceBelow = (cell: ReturnType<typeof createTerritoryMap>['cells'][number]) => {
  let clearance = Number.POSITIVE_INFINITY
  for (let index = 0; index < cell.polygon.length; index += 1) {
    const start = cell.polygon[index]
    const end = cell.polygon[(index + 1) % cell.polygon.length]
    const deltaX = end[0] - start[0]
    if (Math.abs(deltaX) < 1e-7) continue
    const ratio = (cell.center[0] - start[0]) / deltaX
    if (ratio < 0 || ratio > 1) continue
    const intersectionY = start[1] + (end[1] - start[1]) * ratio
    if (intersectionY >= cell.center[1]) clearance = Math.min(clearance, intersectionY - cell.center[1])
  }
  return clearance
}

const expectBaseGeometry = (map: ReturnType<typeof createTerritoryMap>, minimumLabelClearance: number) => {
  const medianArea = median(map.cells.map((cell) => polygonArea(cell.polygon)))
  for (const baseCellId of map.baseCellIds) {
    const base = map.cells.find((cell) => cell.id === baseCellId)!
    expect(polygonArea(base.polygon)).toBeGreaterThanOrEqual(medianArea * 0.7)
    expect(markerClearance(base)).toBeGreaterThanOrEqual(22)
    expect(labelClearanceBelow(base)).toBeGreaterThanOrEqual(minimumLabelClearance)
  }
}

describe('territory map core', () => {
  it.each([11, 12, 13])('builds a deterministic connected %i-cell island', (cellCount) => {
    const first = createTerritoryMap('stable-server-seed', cellCount)
    const second = createTerritoryMap('stable-server-seed', cellCount)
    expect(second).toEqual(first)
    expect(first.generation).toBe('procedural')
    expect(first.cells).toHaveLength(cellCount)
    expect(validateTerritoryMap(first).filter((issue) => issue.severity === 'error')).toEqual([])
    expect(territoryGraphDistance(first, first.baseCellIds[0], first.baseCellIds[1])).toBeGreaterThanOrEqual(3)
    const geometry = geometryMetrics(first)
    expect(geometry.aspect).toBeGreaterThanOrEqual(2.48)
    expect(geometry.aspect).toBeLessThanOrEqual(2.52)
    expect(geometry.baseHorizontalDistance).toBeGreaterThanOrEqual(geometry.width * 0.5)
    expect(first.cells.some((cell) => cell.polygon.length >= 24)).toBe(true)
    expect(first.cells.every((cell) => cell.polygon.length <= 64)).toBe(true)
    expect(first.cells.every((cell) => [100, 150, 200].includes(cell.value))).toBe(true)
    expect(first.baseCellIds.map((baseId) => first.cells.find((cell) => cell.id === baseId)?.value)).toEqual([100, 100])
    for (const cell of first.cells) {
      for (const neighborId of cell.adjacentCellIds) {
        const neighbor = first.cells.find((candidate) => candidate.id === neighborId)!
        expect(neighbor.adjacentCellIds).toContain(cell.id)
        const ownPoints = new Set(cell.polygon.map((point) => `${point[0].toFixed(3)},${point[1].toFixed(3)}`))
        expect(neighbor.polygon.filter((point) => ownPoints.has(`${point[0].toFixed(3)},${point[1].toFixed(3)}`)).length).toBeGreaterThanOrEqual(5)
      }
    }
  })

  it('keeps the island as a three-row patchwork without radial convergence across many seeds', () => {
    const expectedRows = new Map<number, number[]>([[11, [3, 4, 4]], [12, [4, 4, 4]], [13, [4, 4, 5]]])
    for (const cellCount of [11, 12, 13]) {
      for (let seedIndex = 0; seedIndex < 36; seedIndex += 1) {
        const map = createTerritoryMap(`stratified-${cellCount}-${seedIndex}`, cellCount)
        expect(map.generation).toBe('procedural')
        expect(validateTerritoryMap(map).filter((issue) => issue.severity === 'error')).toEqual([])
        expect(stratifiedRowCounts(map)).toEqual(expectedRows.get(cellCount))
        expect(maximumSharedVertexIncidence(map)).toBeLessThanOrEqual(3)
      }
    }
  })

  it('selects substantial opposite bases with room for both marker and value across many seeds', () => {
    for (const cellCount of [11, 12, 13]) {
      for (let seedIndex = 0; seedIndex < 40; seedIndex += 1) {
        const map = createTerritoryMap(`base-clearance-${cellCount}-${seedIndex}`, cellCount)
        expect(map.generation).toBe('procedural')
        expect(validateTerritoryMap(map).filter((issue) => issue.severity === 'error')).toEqual([])
        expectBaseGeometry(map, 60)
      }
    }
  })

  it('rejects a self-intersecting territory polygon', () => {
    const broken = structuredClone(createTerritoryMap('self-intersection', 12))
    broken.cells[0].polygon = [[100, 100], [220, 220], [100, 220], [220, 100]]
    expect(validateTerritoryMap(broken).map((issue) => issue.code)).toContain('cell.polygon_self_intersection')
  })

  it('changes geometry with the seed and exposes a valid deterministic fallback', () => {
    expect(createTerritoryMap('seed-a', 12).cells.map((cell) => cell.polygon)).not.toEqual(
      createTerritoryMap('seed-b', 12).cells.map((cell) => cell.polygon),
    )
    const fallback = createTerritoryFallbackMap('fallback-seed', 12)
    expect(fallback.generation).toBe('fallback')
    expect(validateTerritoryMap(fallback).filter((issue) => issue.severity === 'error')).toEqual([])
    expect(geometryMetrics(fallback).aspect).toBeCloseTo(2.5, 2)
    expectBaseGeometry(fallback, 28)
  })

  it('starts from two bases and only captures adjacent foreign or neutral cells', () => {
    const map = createTerritoryMap('capture-seed', 12)
    const ownership = createInitialTerritoryOwnership(map, playerIds)
    expect(ownership[map.baseCellIds[0]]).toBe(playerIds[0])
    expect(ownership[map.baseCellIds[1]]).toBe(playerIds[1])
    const legal = legalTerritoryCaptures(map, ownership, playerIds[0])
    expect(legal.length).toBeGreaterThan(0)
    expect(legal).toEqual(expect.arrayContaining(
      map.cells.find((cell) => cell.id === map.baseCellIds[0])!.adjacentCellIds,
    ))
    const captured = applyTerritoryCapture(map, ownership, playerIds[0], legal[0])
    expect(captured[legal[0]]).toBe(playerIds[0])
    expect(() => applyTerritoryCapture(map, captured, playerIds[0], map.baseCellIds[0])).toThrow('not legal')
  })
})

describe('territory duel and match rules', () => {
  it('uses a strict sub-150ms speed tie window', () => {
    expect(resolveTerritoryDuel({
      playerIds,
      answers: [
        { userId: playerIds[0], correct: true, distance: null, elapsedMs: 5_000 },
        { userId: playerIds[1], correct: true, distance: null, elapsedMs: 5_149 },
      ],
    })).toEqual({ winnerUserId: null, result: 'speed_tie' })
    expect(resolveTerritoryDuel({
      playerIds,
      answers: [
        { userId: playerIds[0], correct: true, distance: null, elapsedMs: 5_000 },
        { userId: playerIds[1], correct: true, distance: null, elapsedMs: 5_150 },
      ],
    })).toEqual({ winnerUserId: playerIds[0], result: 'faster' })
  })

  it('resolves single-correct and no-correct duels', () => {
    expect(resolveTerritoryDuel({
      playerIds,
      answers: [{ userId: playerIds[1], correct: true, distance: null, elapsedMs: 7_000 }],
    })).toEqual({ winnerUserId: playerIds[1], result: 'single_correct' })
    expect(resolveTerritoryDuel({
      playerIds,
      answers: [{ userId: playerIds[0], correct: false, distance: null, elapsedMs: 4_000 }],
    })).toEqual({ winnerUserId: null, result: 'no_correct' })
  })

  it('uses numeric/date distance only when every option is comparable', () => {
    const numericOptions = [
      { id: 'a', text: '1776' },
      { id: 'b', text: '1789' },
      { id: 'c', text: '1799' },
      { id: 'd', text: '1812' },
    ]
    expect(territoryAnswerDistance(numericOptions, 'b', 'a')).toBe(13)
    expect(territoryAnswerDistance([{ id: 'a', text: 'Париж' }, { id: 'b', text: 'Лион' }], 'a', 'b')).toBeNull()
    expect(resolveTerritoryDuel({
      playerIds,
      answers: [
        { userId: playerIds[0], correct: false, distance: 13, elapsedMs: 5_000 },
        { userId: playerIds[1], correct: false, distance: 10, elapsedMs: 9_000 },
      ],
    })).toEqual({ winnerUserId: playerIds[1], result: 'closer' })
    expect(resolveTerritoryDuel({
      playerIds,
      answers: [
        { userId: playerIds[0], correct: false, distance: 10, elapsedMs: 5_000 },
        { userId: playerIds[1], correct: false, distance: 10, elapsedMs: 5_150 },
      ],
    })).toEqual({ winnerUserId: playerIds[0], result: 'faster' })
  })

  it('uses majority for 11-13 territories', () => {
    expect([11, 12, 13].map(territoryMajority)).toEqual([6, 7, 7])
  })

  it('finishes on a majority before the duel limit', () => {
    const map = createTerritoryFallbackMap('majority', 12)
    const playerOneCells = new Set(map.cells.filter((cell) => cell.id !== map.baseCellIds[1]).slice(0, 7).map((cell) => cell.id))
    const ownership = Object.fromEntries(map.cells.map((cell) => [cell.id, playerOneCells.has(cell.id) ? playerIds[0] : playerIds[1]]))
    expect(resolveTerritoryMatch({
      map,
      ownership,
      players: [
        { userId: playerIds[0], correctAnswers: 3, totalCorrectAnswerTimeMs: 8_000 },
        { userId: playerIds[1], correctAnswers: 3, totalCorrectAnswerTimeMs: 8_000 },
      ],
      duelCount: 8,
    })).toMatchObject({ status: 'finished', winnerUserId: playerIds[0], finishReason: 'majority' })
  })

  it('finishes immediately when an original capital changes owner', () => {
    const map = createTerritoryFallbackMap('capital-finish', 12)
    const ownership = createInitialTerritoryOwnership(map, playerIds)
    ownership[map.baseCellIds[1]] = playerIds[0]
    expect(resolveTerritoryMatch({
      map,
      ownership,
      players: [
        { userId: playerIds[0], correctAnswers: 1, totalCorrectAnswerTimeMs: 1_000 },
        { userId: playerIds[1], correctAnswers: 1, totalCorrectAnswerTimeMs: 1_000 },
      ],
      duelCount: 1,
    })).toMatchObject({ status: 'finished', winnerUserId: playerIds[0], finishReason: 'capital' })
  })

  it('keeps fallen capital towers and transfers every defender territory after the third win', () => {
    const map = createTerritoryFallbackMap('capital-siege', 12)
    const targetCellId = map.baseCellIds[1]
    const ownership = createInitialTerritoryOwnership(map, playerIds)
    const adjacentCellId = map.cells.find((cell) => cell.id === targetCellId)!.adjacentCellIds[0]
    ownership[adjacentCellId] = playerIds[0]
    const siegeState = {
      active: { attackerUserId: playerIds[0], targetCellId },
      towersRemaining: { [map.baseCellIds[0]]: 3, [targetCellId]: 3 },
    }
    const first = resolveTerritorySiegeDuel({ map, ownership, siegeState, playerIds, winnerUserId: playerIds[0] })
    expect(first.siegeState).toMatchObject({ active: { attackerUserId: playerIds[0], targetCellId }, towersRemaining: { [targetCellId]: 2 } })
    const stopped = resolveTerritorySiegeDuel({ map, ownership, siegeState: first.siegeState, playerIds, winnerUserId: playerIds[1] })
    expect(stopped.siegeState).toMatchObject({ active: null, towersRemaining: { [targetCellId]: 2 } })
    const resumed = { ...stopped.siegeState, active: { attackerUserId: playerIds[0], targetCellId } }
    const second = resolveTerritorySiegeDuel({ map, ownership, siegeState: resumed, playerIds, winnerUserId: playerIds[0] })
    const third = resolveTerritorySiegeDuel({ map, ownership, siegeState: second.siegeState, playerIds, winnerUserId: playerIds[0] })
    expect(third.capitalCaptured).toBe(true)
    expect(third.siegeState.towersRemaining[targetCellId]).toBe(0)
    expect(map.cells.every((cell) => third.ownership[cell.id] !== playerIds[1])).toBe(true)
  })

  it('applies max-duel tie-breaks in the agreed order', () => {
    const map = createTerritoryFallbackMap('tie-breaks', 12)
    const neutral = Object.fromEntries(map.cells.map((cell) => [cell.id, null]))
    const territoryOwnership = Object.fromEntries(map.cells.map((cell, index) => [
      cell.id,
      index < 6 ? playerIds[0] : index < 11 ? playerIds[1] : null,
    ]))
    territoryOwnership[map.baseCellIds[0]] = playerIds[0]
    territoryOwnership[map.baseCellIds[1]] = playerIds[1]
    const highValueCell = map.cells.find((cell) => cell.value === 200)!
    const lowValueCell = map.cells.find((cell) => cell.value === 100 && !map.baseCellIds.includes(cell.id))!
    const valueOwnership = { ...neutral, [highValueCell.id]: playerIds[0], [lowValueCell.id]: playerIds[1] }
    const baseStats = [
      { userId: playerIds[0], correctAnswers: 5, totalCorrectAnswerTimeMs: 20_000 },
      { userId: playerIds[1], correctAnswers: 10, totalCorrectAnswerTimeMs: 10_000 },
    ] as const
    expect(resolveTerritoryMatch({ map, ownership: territoryOwnership, players: baseStats, duelCount: 20 })).toMatchObject({
      winnerUserId: playerIds[0], finishReason: 'territories',
    })
    expect(resolveTerritoryMatch({ map, ownership: valueOwnership, players: baseStats, duelCount: 20 })).toMatchObject({
      winnerUserId: playerIds[0], finishReason: 'territory_value',
    })
    expect(resolveTerritoryMatch({ map, ownership: neutral, players: baseStats, duelCount: 20 })).toMatchObject({
      winnerUserId: playerIds[1], finishReason: 'correct_answers',
    })
    expect(resolveTerritoryMatch({
      map,
      ownership: neutral,
      players: [
        { userId: playerIds[0], correctAnswers: 5, totalCorrectAnswerTimeMs: 20_000 },
        { userId: playerIds[1], correctAnswers: 5, totalCorrectAnswerTimeMs: 19_999 },
      ],
      duelCount: 20,
    })).toMatchObject({ winnerUserId: playerIds[1], finishReason: 'correct_time' })
    expect(resolveTerritoryMatch({
      map,
      ownership: neutral,
      players: [
        { userId: playerIds[0], correctAnswers: 5, totalCorrectAnswerTimeMs: 20_000 },
        { userId: playerIds[1], correctAnswers: 5, totalCorrectAnswerTimeMs: 20_000 },
      ],
      duelCount: 20,
    })).toMatchObject({ winnerUserId: null, finishReason: 'draw' })
  })
})

describe('territory question validation', () => {
  const validQuestion = {
    id: 'territory:test:question',
    mode: 'territory',
    schemaVersion: 1,
    locale: 'ru-RU',
    questionType: 'choice',
    prompt: 'Какой город является столицей Франции?',
    options: [
      { id: 'a', text: 'Лион' },
      { id: 'b', text: 'Париж' },
      { id: 'c', text: 'Марсель' },
      { id: 'd', text: 'Бордо' },
    ],
    correctOptionId: 'b',
    explanation: 'Париж является столицей Франции.',
    category: { id: 'geography', label: 'География' },
    difficulty: 'easy',
    provenance: { dataset: 'Wikidata', sourceUrl: 'https://www.wikidata.org/wiki/Q142', license: 'CC0-1.0' },
    contentStatus: 'ready',
    allowedInGame: true,
  } as const

  it('accepts a ready four-option question', () => {
    expect(validateTerritoryQuestion(validQuestion).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('rejects duplicate options, an unknown answer and unlicensed content', () => {
    const broken = structuredClone(validQuestion) as Record<string, any>
    broken.options[1].text = broken.options[0].text
    broken.correctOptionId = 'missing'
    broken.provenance.license = ''
    expect(validateTerritoryQuestion(broken).map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'option.text_duplicate',
      'question.correct_option_missing',
      'provenance.license',
    ]))
  })
})

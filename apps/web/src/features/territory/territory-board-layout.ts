import type { TerritoryMapSnapshot } from '@shoditsa/contracts'

export type BoardPoint = readonly [number, number]
const pointKey = (point: BoardPoint) => point.map(value => value.toFixed(3)).join(',')
export const projectTilePoint = ([x, y]: BoardPoint): [number, number] => [x * .88 - y * .7, x * .32 + y * .56]

/** Shared polygon edges are removed, leaving the actual island coast. */
function islandBoundary(map: TerritoryMapSnapshot): BoardPoint[] {
  const edges = new Map<string, { a: BoardPoint; b: BoardPoint; count: number }>()
  for (const cell of map.cells) cell.polygon.forEach((a, index) => {
    const b = cell.polygon[(index + 1) % cell.polygon.length]
    const key = [pointKey(a), pointKey(b)].sort().join('|')
    const edge = edges.get(key)
    if (edge) edge.count++
    else edges.set(key, { a, b, count: 1 })
  })
  const outer = [...edges.values()].filter(edge => edge.count === 1)
  if (!outer.length) return []
  const chain: BoardPoint[] = [outer[0].a, outer[0].b]
  outer.splice(0, 1)
  while (outer.length) {
    const key = pointKey(chain.at(-1)!)
    const index = outer.findIndex(edge => pointKey(edge.a) === key || pointKey(edge.b) === key)
    if (index < 0) break
    const edge = outer.splice(index, 1)[0]
    const next = pointKey(edge.a) === key ? edge.b : edge.a
    if (pointKey(next) === pointKey(chain[0])) break
    chain.push(next)
  }
  return chain
}

/** Remove tiny waviness before rounding; preserve the meaningful bends. */
function simplifyContour(points: BoardPoint[], tolerance = 2.5): BoardPoint[] {
  const result = [...points]
  let changed = true
  while (changed && result.length > 5) {
    changed = false
    for (let i = 0; i < result.length && result.length > 5; i++) {
      const a = result[(i + result.length - 1) % result.length], b = result[i], c = result[(i + 1) % result.length]
      const length = Math.hypot(c[0] - a[0], c[1] - a[1])
      const distance = Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / Math.max(length, 1)
      if (distance < tolerance && Math.hypot(b[0] - a[0], b[1] - a[1]) < length) {
        result.splice(i--, 1); changed = true
      }
    }
  }
  return result
}

/** Transform geometry only: cell identity, costs, capitals and adjacency remain authoritative. */
export function createTerritoryBoardLayout(map: TerritoryMapSnapshot) {
  const points = map.cells.flatMap(cell => cell.polygon)
  const minX = points.length ? Math.min(...points.map(p => p[0])) : 0, maxX = points.length ? Math.max(...points.map(p => p[0])) : 1
  const minY = points.length ? Math.min(...points.map(p => p[1])) : 0, maxY = points.length ? Math.max(...points.map(p => p[1])) : 1
  const normalize = ([x, y]: BoardPoint): BoardPoint => [(x - (minX + maxX) / 2) / Math.max(1, maxX - minX) * 560, (y - (minY + maxY) / 2) / Math.max(1, maxY - minY) * 390]
  const project = (point: BoardPoint) => projectTilePoint(normalize(point))
  const tiles = map.cells.map(cell => {
    const center = project(cell.center)
    const elevation = map.baseCellIds.includes(cell.id) ? 12 : cell.value === 200 ? 8 : 4
    // Insetting the original region creates a narrow visible seam, never inventing neighbours.
    const polygon: BoardPoint[] = cell.polygon.map(p => {
      const point = project(p)
      return [(point[0] - center[0]) * .955, (point[1] - center[1]) * .955]
    })
    const area = Math.abs(polygon.reduce((sum, p, i) => {
      const next = polygon[(i + 1) % polygon.length]
      return sum + p[0] * next[1] - next[0] * p[1]
    }, 0) / 2)
    return { cell, center, elevation, polygon, path: roundedBoardPath(simplifyContour(polygon), 15), detailScale: Math.min(1, Math.max(.7, Math.sqrt(area) / 90)) }
  })
  const tileById = new Map(tiles.map(tile => [tile.cell.id, tile]))
  const links = tiles.flatMap(tile => tile.cell.adjacentCellIds.filter(id => tile.cell.id < id && tileById.has(id)).map(id => ({ id: `${tile.cell.id}:${id}`, from: tile, to: tileById.get(id)! })))
  const coast = islandBoundary(map).map(project)
  const all = points.map(project)
  const left = Math.min(...all.map(p => p[0]), 0) - 42, right = Math.max(...all.map(p => p[0]), 1) + 42
  const top = Math.min(...all.map(p => p[1]), 0) - 92, bottom = Math.max(...all.map(p => p[1]), 1) + 88
  return {
    tiles: tiles.sort((a, b) => a.center[1] - b.center[1] || a.center[0] - b.center[0]),
    links, coast, coastPath: roundedBoardPath(simplifyContour(coast, 2), 20),
    viewBox: `${left} ${top} ${right - left} ${bottom - top}`,
    center: [(left + right) / 2, (top + bottom) / 2] as BoardPoint,
  }
}

export function roundedBoardPath(points: readonly BoardPoint[], radius: number) {
  if (!points.length) return ''
  return points.map((point, index) => {
    const toward = (other: BoardPoint) => {
      const ratio = Math.min(.28, radius / Math.max(1, Math.hypot(other[0] - point[0], other[1] - point[1])))
      return [point[0] + (other[0] - point[0]) * ratio, point[1] + (other[1] - point[1]) * ratio]
    }
    const start = toward(points[(index + points.length - 1) % points.length])
    const end = toward(points[(index + 1) % points.length])
    return `${index ? 'L' : 'M'}${start.join(',')}Q${point.join(',')} ${end.join(',')}`
  }).join(' ') + 'Z'
}

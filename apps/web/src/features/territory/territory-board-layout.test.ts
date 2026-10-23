import { describe, expect, it } from 'vitest'
import { createTerritoryFallbackMap, createTerritoryMap } from '@shoditsa/game-core'
import { createTerritoryBoardLayout } from './territory-board-layout'

describe('territory tile presentation preserves the server map', () => {
  for (const count of [11, 12, 13]) {
    for (const generation of ['procedural', 'fallback'] as const) {
      it(`${generation}: every one of ${count} cells and its neighbours survives the projection`, () => {
        const map = generation === 'fallback' ? createTerritoryFallbackMap(`board-${count}`, count) : createTerritoryMap(`board-${count}`, count)
        const original = JSON.stringify(map)
        const layout = createTerritoryBoardLayout(map)
        expect(layout.tiles.map(tile => tile.cell.id).sort()).toEqual(map.cells.map(cell => cell.id).sort())
        expect(new Set(layout.tiles.map(tile => tile.center.join(','))).size).toBe(count)
        const [left, top, width, height] = layout.viewBox.split(' ').map(Number)
        for (const a of layout.tiles) {
          expect(a.cell).toBe(map.cells.find(cell => cell.id === a.cell.id))
          expect(a.center[0]).toBeGreaterThan(left)
          expect(a.center[0]).toBeLessThan(left + width)
          expect(a.center[1] - a.elevation - 85).toBeGreaterThan(top)
          expect(a.center[1] + 45).toBeLessThan(top + height)
          expect(a.path).toMatch(/^M.*Z$/)
          expect(a.path).not.toMatch(/NaN|Infinity/)
        }
        expect(layout.coast.length).toBeGreaterThan(5)
        expect(layout.coastPath).toMatch(/^M.*Z$/)
        const expectedLinks = [...new Set(map.cells.flatMap(cell => cell.adjacentCellIds.map(id => [cell.id, id].sort().join(':'))))].sort()
        expect(layout.links.map(link => link.id).sort()).toEqual(expectedLinks)
        expect(layout.viewBox.split(' ').every(value => Number.isFinite(Number(value)))).toBe(true)
        expect(JSON.stringify(map)).toBe(original)
        const reordered = createTerritoryBoardLayout({ ...map, cells: [...map.cells].reverse() })
        expect(reordered.tiles.map(tile => [tile.cell.id, tile.center, tile.path])).toEqual(layout.tiles.map(tile => [tile.cell.id, tile.center, tile.path]))
        expect(reordered.coast.map(point => point.join(',')).sort()).toEqual(layout.coast.map(point => point.join(',')).sort())
      })
    }
  }
})

import { describe, expect, it } from 'vitest'
import { applicationLink } from '../../app/application-navigation'
import { isSvoyakPath, roomCreationHref, roomJoinHref } from './room-navigation'
describe('common room entry', () => {
  it('opens the unified workspace with the chosen mode', () => {
    expect(roomCreationHref('quiz')).toBe('/lobby')
    expect(roomCreationHref('danetki')).toBe('/lobby?mode=danetki')
    expect(roomCreationHref('svoyak')).toBe('/lobby?mode=svoyak')
  })
  it('routes invitation codes to the correct existing room protocol', () => {
    expect(roomJoinHref(' ab234 ', true)).toBe('/games/together?room=AB234')
    expect(roomJoinHref(' a1b2c3 ', true)).toBe('/svoyak/join/A1B2C3')
    for (const code of ['', 'ABC', 'QQQQQQ', 'ab/23', 'javascript:alert(1)']) expect(roomJoinHref(code, true)).toBeUndefined()
    expect(roomJoinHref('A1B2C3', false)).toBeUndefined()
  })
  it('keeps the title, creation, join, room and result in the application router', () => {
    for (const href of ['/games/svoyak', '/svoyak/create', '/svoyak/join/A1B2C3', '/svoyak/rooms/A1B2C3', '/svoyak/rooms/A1B2C3/result']) {
      expect(isSvoyakPath(href)).toBe(true)
      expect(applicationLink(href, 'http://localhost:5180')).toBe(href)
    }
    expect(isSvoyakPath('/svoyak/rooms/secret/path')).toBe(false)
  })
})


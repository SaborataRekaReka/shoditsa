import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ standard: vi.fn(), svoyak: vi.fn() }))
vi.mock('../../api/client', async importOriginal => ({ ...await importOriginal<object>(), api: { friendsRoomList: state.standard } }))
vi.mock('../svoyak/SvoyakHomeCard', () => ({ SVOYAK_ENABLED: true }))
vi.mock('../svoyak/room-directory-client', () => ({ loadSvoyakDirectory: state.svoyak }))
import { assertRoomEntryAvailable } from './room-entry'
import { ApiClientError } from '../../api/client'

beforeEach(() => { state.standard.mockResolvedValue({ rooms: [] }); state.svoyak.mockResolvedValue([]) })
describe('direct invitations across room types', () => {
  it('blocks joining a standard room while in Svoyak, and Svoyak while in a standard room', async () => {
    state.svoyak.mockResolvedValue([{ code: 'ABCDEF' }])
    await expect(assertRoomEntryAvailable('AB234')).rejects.toThrow('другой комнате')
    state.svoyak.mockResolvedValue([])
    state.standard.mockResolvedValue({ rooms: [{ code: 'AB234' }] })
    await expect(assertRoomEntryAvailable('ABCDEF')).rejects.toThrow('другой комнате')
  })
  it('allows returning to the same room and ignores departed history', async () => {
    state.svoyak.mockResolvedValue([{ code: 'ABCDEF' }, { code: 'FEDCBA', leftAt: '2026-10-22' }])
    await expect(assertRoomEntryAvailable('ABCDEF')).resolves.toBeUndefined()
  })
  it('allows unauthenticated invitees but fails closed when membership cannot be checked', async () => {
    state.standard.mockRejectedValue(new ApiClientError(401, 'AUTH_REQUIRED', 'Sign in'))
    await expect(assertRoomEntryAvailable('ABCDEF')).resolves.toBeUndefined()
    state.standard.mockRejectedValue(new ApiClientError(503, 'UNAVAILABLE', 'Unavailable'))
    await expect(assertRoomEntryAvailable('ABCDEF')).rejects.toThrow('Unavailable')
  })
})

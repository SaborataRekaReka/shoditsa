import { describe, expect, it } from 'vitest'
import {
  connectionsGuesses,
  connectionsHintChoices,
  connectionsSchedule,
  connectionsSessionState,
} from '@shoditsa/database'

describe('connections database schema', () => {
  it('maps timestamp properties to the snake_case columns created by the migration', () => {
    expect(connectionsSchedule.createdAt.name).toBe('created_at')
    expect(connectionsSchedule.updatedAt.name).toBe('updated_at')
    expect(connectionsSessionState.updatedAt.name).toBe('updated_at')
    expect(connectionsGuesses.createdAt.name).toBe('created_at')
    expect(connectionsHintChoices.createdAt.name).toBe('created_at')
  })
})

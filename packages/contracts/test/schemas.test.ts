import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'
import { AttemptBodySchema, CatalogSearchQuerySchema, GameStartBodySchema } from '../src/index.js'

describe('API schemas', () => {
  it('rejects unknown start fields', () => expect(Value.Check(GameStartBodySchema, { kind: 'daily', mode: 'movie', answerId: 'secret' })).toBe(false))
  it('rejects invalid attempts', () => expect(Value.Check(AttemptBodySchema, { itemId: '' })).toBe(false))
  it('bounds search limits', () => expect(Value.Check(CatalogSearchQuerySchema, { mode: 'movie', q: 'a', limit: 21 })).toBe(false))
})

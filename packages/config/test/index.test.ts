import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/index.js'

describe('commerce config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.TRUSTED_ORIGINS = 'http://localhost:5173,http://localhost:3001'
    process.env.COMMERCE_ENABLED = 'false'
    process.env.COMMERCE_PROVIDER = 'stub'
    process.env.COMMERCE_RETURN_URL = 'http://localhost:5173/purchase/return'
    process.env.ARCHIVE_FIRST_DATE = '2026-07-01'
    process.env.FREE_ARCHIVE_DAYS = '7'
    delete process.env.FRIENDS_ROOM_PREVIEW
    delete process.env.VITE_FRIENDS_ROOM_PREVIEW
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
    Object.assign(process.env, originalEnv)
  })

  it('loads disabled stub commerce with public archive settings', () => {
    expect(loadConfig().commerce).toMatchObject({ enabled: false, provider: 'stub', currency: 'RUB', archiveFirstDate: '2026-07-01', freeArchiveDays: 7 })
    expect(loadConfig().friendsRoomPreview).toBe(false)
  })

  it('supports the server preview flag and its Vite-compatible fallback', () => {
    process.env.VITE_FRIENDS_ROOM_PREVIEW = 'true'
    expect(loadConfig().friendsRoomPreview).toBe(true)
    process.env.FRIENDS_ROOM_PREVIEW = 'false'
    expect(loadConfig().friendsRoomPreview).toBe(false)
  })

  it('rejects an untrusted return origin', () => {
    process.env.COMMERCE_RETURN_URL = 'https://payments.example/purchase/return'
    expect(() => loadConfig()).toThrow('COMMERCE_RETURN_URL must use a trusted origin')
  })

  it('restricts the free archive window to 31 days', () => {
    process.env.FREE_ARCHIVE_DAYS = '32'
    expect(() => loadConfig()).toThrow('FREE_ARCHIVE_DAYS must be an integer between 1 and 31')
  })

  it('rejects calendar dates that only look valid', () => {
    process.env.ARCHIVE_FIRST_DATE = '2026-02-30'
    expect(() => loadConfig()).toThrow('ARCHIVE_FIRST_DATE must be a valid YYYY-MM-DD date')
  })
})

import { describe, expect, it } from 'vitest'
import { releaseShaChanged } from './release-update'

describe('release update', () => {
  const currentSha = 'a'.repeat(40)

  it('detects a different production release', () => {
    expect(releaseShaChanged(currentSha, { commitSha: 'b'.repeat(40) })).toBe(true)
  })

  it('does not reload for the current or malformed release', () => {
    expect(releaseShaChanged(currentSha, { commitSha: currentSha })).toBe(false)
    expect(releaseShaChanged(currentSha, { commitSha: 'dev' })).toBe(false)
    expect(releaseShaChanged('dev', { commitSha: 'b'.repeat(40) })).toBe(false)
  })
})

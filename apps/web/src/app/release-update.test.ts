import { describe, expect, it } from 'vitest'
import { releaseReloadIsSafe, releaseShaChanged } from './release-update'

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

  it('defers a release reload while an attempt is open', () => {
    expect(releaseReloadIsSafe({ pathname: '/sessions/session-1', hash: '' })).toBe(false)
    expect(releaseReloadIsSafe({ pathname: '/play/city/', hash: '' })).toBe(false)
    expect(releaseReloadIsSafe({ pathname: '/', hash: '#/sessions/session-1?from=archive' })).toBe(false)
  })

  it('allows a release reload outside active attempts', () => {
    expect(releaseReloadIsSafe({ pathname: '/games/city', hash: '' })).toBe(true)
    expect(releaseReloadIsSafe({ pathname: '/specials/dtf-game-comments-25-v1', hash: '' })).toBe(true)
    expect(releaseReloadIsSafe({ pathname: '/', hash: '#/profile' })).toBe(true)
  })
})

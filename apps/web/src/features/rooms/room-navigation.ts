export const LOBBY_HREF = '/lobby'
export type RoomKind = 'quiz' | 'danetki' | 'svoyak'
export const isSvoyakPath = (path: string) => path === '/games/svoyak' || /^\/svoyak\/(?:create|(?:join|rooms)\/[a-fA-F0-9]{6}(?:\/result)?)\/?$/.test(path)
export const roomCreationHref = (kind: RoomKind) => kind === 'quiz' ? LOBBY_HREF : `${LOBBY_HREF}?mode=${kind}`
export function roomJoinHref(value: string, svoyakEnabled: boolean): string | undefined {
  const code = value.trim().toUpperCase()
  if (/^[A-Z2-9]{5}$/.test(code)) return `/games/together?room=${code}`
  if (svoyakEnabled && /^[A-F0-9]{6}$/.test(code)) return `/svoyak/join/${code}`
  return undefined
}

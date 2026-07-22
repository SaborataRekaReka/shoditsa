export const friendsRoomTimeLeft = ({ endsAt, clientNow, serverTime, maximum }: {
  endsAt: string | null | undefined
  clientNow: number
  serverTime: string | null | undefined
  maximum: number
}) => {
  if (!endsAt || maximum <= 0) return 0
  const parsedServerTime = serverTime ? Date.parse(serverTime) : Number.NaN
  const referenceTime = Number.isFinite(parsedServerTime) ? Math.max(clientNow, parsedServerTime) : clientNow
  const remaining = Math.max(0, Math.ceil((Date.parse(endsAt) - referenceTime) / 1_000))
  return Math.min(maximum, remaining)
}

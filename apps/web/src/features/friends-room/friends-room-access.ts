type FriendsRoomUser = { isAnonymous: boolean } | null | undefined

type FriendsRoomEnvironment = {
  dev: boolean
  preview: boolean
}

const currentEnvironment = (): FriendsRoomEnvironment => ({
  dev: import.meta.env.DEV,
  preview: import.meta.env.VITE_FRIENDS_ROOM_PREVIEW === 'true',
})

export const canUseFriendsRoom = (
  user: FriendsRoomUser,
  environment: FriendsRoomEnvironment = currentEnvironment(),
) => environment.dev || environment.preview || Boolean(user && !user.isAnonymous)

export const friendsRoomRegistrationHref = (returnUrl: string) =>
  `/register?returnUrl=${encodeURIComponent(returnUrl)}`

export const currentFriendsRoomReturnUrl = () => {
  if (typeof window === 'undefined') return '/games/together'
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

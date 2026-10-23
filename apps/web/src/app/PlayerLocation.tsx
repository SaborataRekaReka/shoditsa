import { createContext } from 'react'

/** The destination committed with its prepared screen, never a pending URL. */
export const PlayerLocation = createContext<{ pathname: string; search: string; hash: string } | null>(null)

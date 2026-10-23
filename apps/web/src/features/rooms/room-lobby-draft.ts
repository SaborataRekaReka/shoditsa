import { defaultRoomSetup, normalizeRoomSetup, type RoomSetupValue, type SetupMode } from './room-setup-model'

export const ROOM_DRAFT_KEY = 'shoditsa:room-setup:v1'
export type RoomLobbyDraft = { mode: SetupMode; setup: RoomSetupValue }
export function parseRoomDraft(raw: string | null, requestedMode: string | null, svoyakEnabled: boolean): RoomLobbyDraft {
  let setup = defaultRoomSetup()
  let mode: SetupMode = 'quiz'
  try {
    const saved = JSON.parse(raw ?? 'null')
    if (saved && ['quiz', 'danetki', 'territory', 'svoyak'].includes(saved.mode) && Array.isArray(saved.setup?.packs)) {
      const value = saved.setup
      setup = normalizeRoomSetup({ ...setup,
        packs: value.packs.filter((pack: unknown) => !!pack && typeof pack === 'object' && typeof (pack as { mode?: unknown }).mode === 'string'),
        roundsTotal: Number.isFinite(value.roundsTotal) ? value.roundsTotal : setup.roundsTotal,
        answerTimeSeconds: [15, 20, 30, 45].includes(value.answerTimeSeconds) ? value.answerTimeSeconds : setup.answerTimeSeconds,
        shufflePacks: value.shufflePacks === true,
      })
      mode = saved.mode
    }
  } catch { /* A broken or old draft must never block entry. */ }
  if (requestedMode && ['quiz', 'danetki', 'territory', 'svoyak'].includes(requestedMode)) mode = requestedMode as SetupMode
  if (mode === 'svoyak' && !svoyakEnabled) mode = 'quiz'
  return { mode, setup: { ...setup, gameType: mode === 'svoyak' ? 'quiz' : mode } }
}

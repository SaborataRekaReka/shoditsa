import { FINAL_CHOICE_DURATION_MS } from '@shoditsa/contracts'

export const FINAL_CHOICE_DURATION_SECONDS = FINAL_CHOICE_DURATION_MS / 1_000

export const finalChoiceSecondsRemaining = (
  expiresAt: string | null | undefined,
  now = Date.now(),
) => {
  if (!expiresAt) return FINAL_CHOICE_DURATION_SECONDS
  const deadline = Date.parse(expiresAt)
  if (!Number.isFinite(deadline)) return FINAL_CHOICE_DURATION_SECONDS
  return Math.max(0, Math.ceil((deadline - now) / 1_000))
}

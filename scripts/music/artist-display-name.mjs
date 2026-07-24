const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null

/**
 * The curated input is the public/stage identity selected for the game.
 * External display fields may contain a translated civil name, so they stay
 * searchable aliases instead of replacing the player's expected answer.
 */
export const chooseArtistDisplayNames = ({ inputName, canonicalName, displayRu, displayEn, artistKey }) => {
  const input = clean(inputName)
  const canonical = clean(canonicalName)
  const ru = clean(displayRu)
  const en = clean(displayEn)
  const fallback = clean(artistKey) ?? 'Неизвестный артист'

  return {
    titleRu: input ?? canonical ?? ru ?? en ?? fallback,
    titleOriginal: canonical ?? en ?? input ?? ru ?? fallback,
    aliases: [...new Set([ru, en, canonical, input].filter(Boolean))],
  }
}

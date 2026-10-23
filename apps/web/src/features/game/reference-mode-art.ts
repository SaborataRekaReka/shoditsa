import { publicAssetUrl } from '../../app/public-asset'

/** The same thematic illustrations as the home cards, never catalog answer imagery. */
export function referenceModeIllustration(mode: string): string {
  const illustration = mode === 'danetki' ? 'yes-no' : mode === 'connections' || mode === 'territory' ? 'associations' : mode
  return publicAssetUrl(`images/home-doodle/${illustration}.webp`)
}

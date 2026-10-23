import type { ImgHTMLAttributes } from 'react'
import { publicAssetUrl } from '../../app/public-asset'
import { ThemedArtwork } from './ThemedArtwork'

/** Appearance-specific artwork follows the app switch, including saved games. */
export function GameArtwork({ mode, className = '', ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { mode: string }) {
  const name = mode === 'danetki' ? 'yes-no' : mode
  return <ThemedArtwork {...props} className={`game-artwork ${className}`.trim()} src={publicAssetUrl(`images/home-doodle/${name}.webp`)} />
}

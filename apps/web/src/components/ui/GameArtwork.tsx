import type { ImgHTMLAttributes } from 'react'
import { publicAssetUrl } from '../../app/public-asset'
import { ThemedArtwork } from './ThemedArtwork'

/** Appearance-specific artwork follows the app switch, including saved games. */
export function GameArtwork({ mode, className = '', ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { mode: string }) {
  if (mode === 'word') return <img {...props} className={`game-artwork ${className}`.trim()} src={publicAssetUrl('images/word-art.svg')} />
  const name = mode === 'danetki' ? 'yes-no' : mode
  return <ThemedArtwork {...props} className={`game-artwork ${className}`.trim()} src={publicAssetUrl(`images/home-doodle/${name}.webp`)} />
}

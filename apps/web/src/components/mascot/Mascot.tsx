import type { ImgHTMLAttributes } from 'react'
import { publicAssetUrl } from '../../app/public-asset'
import './Mascot.css'

/** One illustrated character, with a small set of reusable poses. */
const mascotFiles = {
  heroScene: 'hero-scene-v1.webp',
  think: 'think-v1.webp',
  welcome: 'welcome-v1.webp',
  peek: 'peek-v1.webp',
  sleep: 'sleep-v1.webp',
  club: 'club-invitation-v1.webp',
  celebrate: 'celebrate-v1.webp',
  victory: 'victory-seated-v3.webp',
} as const

export type MascotPose = keyof typeof mascotFiles

export const mascotAsset = (pose: MascotPose) => publicAssetUrl(`images/mascot/${mascotFiles[pose]}`)

export function Mascot({ pose, className = '', alt = '', width = 1024, height = 1024, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { pose: MascotPose }) {
  return <img className={`mascot ${className}`.trim()} src={mascotAsset(pose)} width={width} height={height} alt={alt} {...props} />
}

import type { ImgHTMLAttributes } from 'react'
import { publicAssetUrl } from '../../app/public-asset'
import { useStudyTheme } from '../../dev/quest-game/StudyTheme'

/** Opaque pastel category art for charcoal surfaces, plus the larger scenes. */
const nightV2Files = new Set(['movie', 'series', 'anime', 'game', 'city', 'music', 'diagnosis', 'animal', 'book', 'character', 'associations', 'yes-no', 'connections', 'svoyak', 'territory'])
const nightFiles = new Set([...nightV2Files, 'anime-hero', 'sleeping-cat'])

export function ThemedArtwork({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [theme] = useStudyTheme()
  const match = src?.match(/\/images\/home-doodle\/([^/]+)\.webp$/)
  const vector = src === publicAssetUrl('images/home-doodle/together.svg')
  const corporate = src?.match(/\/images\/corporate\/(corporate-hero|format-team|format-comms|format-event)\.webp$/)
  const night = theme === 'dark' && Boolean(vector || corporate || (match && nightFiles.has(match[1])))
  let themedSrc = src
  if (night && src) {
    if (vector) themedSrc = src.replace('/together.svg', '/dark/together-v1.svg')
    else if (match && nightV2Files.has(match[1])) themedSrc = src.replace(/\/([^/]+)\.webp$/, '/dark-v2/$1.webp')
    else themedSrc = src.replace(/\/([^/]+)\.webp$/, '/dark/$1-v1.webp')
  }
  return <img {...props} src={themedSrc} data-night-art={night || undefined} />
}

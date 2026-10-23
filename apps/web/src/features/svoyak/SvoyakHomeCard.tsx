import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { publicAssetUrl } from '../../app/public-asset'
import { svoyakHref } from './contracts'
import { ArrowRight } from 'lucide-react'
import { GeneratedShoditsaGlyph as Glyph } from '../../dev/quest-game/GeneratedShoditsaArt'

export const SVOYAK_ENABLED = import.meta.env.MODE !== 'yandex'
export function SvoyakHomeCard() {
  if (!SVOYAK_ENABLED) return null
  return <a className="hs-game hs-game--svoyak" data-game="svoyak" href={svoyakHref.title}>
    <span className="hs-game-art"><ThemedArtwork src={publicAssetUrl('images/home-doodle/svoyak.webp')} alt="" width="88" height="88" loading="lazy" /></span>
    <div className="hs-game-copy"><h3>Своя игра</h3><p>Выбирай темы, отвечай первым и набирай очки. Игра с ведущим.</p></div>
    <span className="hs-game-access"><Glyph name="medal" size={20} />Клуб ведущему</span>
    <span className="hs-game-link">Об игре<ArrowRight size={17} aria-hidden="true" /></span>
  </a>
}

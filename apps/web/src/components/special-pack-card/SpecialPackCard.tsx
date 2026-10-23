import { ArrowRight, Check } from 'lucide-react'
import { ThemedArtwork } from '../ui/ThemedArtwork'
import { QuestProgress } from '../ui/QuestPrimitives'
import { localPresentationLink } from '../../app/local-presentation'
import { hasSpecialAccess, specialDestination } from '../../app/special-navigation'
import { INDEXABLE_GAME_SEO } from '../../app/seo-content'
import { GeneratedShoditsaGlyph as Glyph } from '../../dev/quest-game/GeneratedShoditsaArt'
import { clubLibraryCover } from '../../dev/quest-game/club-library-covers'
import type { ClubLibraryItem } from '../../dev/quest-game/club-library-model'
import './SpecialPackCard.css'

/** The same cover, progress and launch card in the Club and public specials. */
export function SpecialPackCard({ pack, headingLevel = 3 }: { pack: ClubLibraryItem; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const access = hasSpecialAccess(pack.access)
  const progress = access && pack.cadence === 'collection' && pack.completedItems !== null
  const finished = progress && pack.completedItems! >= pack.totalItems && pack.totalItems > 0
  const started = progress && pack.completedItems! > 0 && !finished
  const plural = new Intl.PluralRules('ru').select(pack.totalItems)
  const count = `${pack.totalItems} ${plural === 'one' ? 'загадка' : plural === 'few' ? 'загадки' : 'загадок'}`
  return <article className="club-library-pack" data-pack-id={pack.id}>
    <div className="club-library-pack-art" data-mode={pack.mode} aria-hidden="true"><ThemedArtwork src={clubLibraryCover(pack)} width="240" height="160" alt="" loading="lazy" /></div>
    <div className="club-library-pack-body">
      <div className="club-library-pack-meta"><span>{pack.mode === 'music' ? 'Музыка' : pack.mode === 'game' ? 'Видеоигры' : INDEXABLE_GAME_SEO.find(game => game.mode === pack.mode)?.shortName}</span><span>{pack.cadence === 'daily' ? 'Каждый день' : count}</span></div>
      <Heading>{pack.title}</Heading><p>{pack.cadence === 'daily' ? 'Один артист в день. Проверь, насколько хорошо ты знаешь K-pop.' : pack.id === 'dtf-game-comments-25-v1' ? 'Узнай игру по настоящим комментариям с DTF.' : (pack.subtitle || pack.description).replace(/\s*[\u00b7\u2022]\s*/g, ', ')}</p>
      {progress ? <div className="club-library-pack-progress"><QuestProgress value={Math.min(pack.completedItems!, pack.totalItems)} max={Math.max(1, pack.totalItems)} label={`Прогресс спецпоказа ${pack.title}`} tone="blue" caption={`${pack.completedItems} из ${pack.totalItems}`} /></div> : <div className="club-library-pack-note">{pack.cadence === 'daily' ? <><Glyph name="flame" size={20} />Новая загадка каждый день</> : <><Glyph name="medal" size={20} />Входит в клубный билет</>}</div>}
      <a className={`quest-button quest-button--${started ? 'primary' : 'outline'}`} href={localPresentationLink(specialDestination(pack.id, pack.access))}>{!access ? 'Открыть с Клубом' : finished ? <><Check size={17} aria-hidden="true" />Посмотреть</> : started ? 'Продолжить' : 'Открыть спецпоказ'}<ArrowRight size={17} aria-hidden="true" /></a>
    </div>
  </article>
}

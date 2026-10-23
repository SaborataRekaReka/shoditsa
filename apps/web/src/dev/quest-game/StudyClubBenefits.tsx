import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { ArrowRight } from 'lucide-react'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { publicAssetUrl } from '../../app/public-asset'
import type { ClubPageViewModel } from '../../features/commerce/club-page-model'
import { localPresentationLink } from '../../app/local-presentation'
import { GeneratedShoditsaGlyph as Glyph } from './GeneratedShoditsaArt'
import './study-club-benefits.css'
import { useServerRuntime } from '../../hooks/use-server-runtime'

const plural = (value: number, forms: [string, string, string]) => {
  const tens = Math.abs(value) % 100, digit = tens % 10
  return forms[tens > 10 && tens < 20 ? 2 : digit === 1 ? 0 : digit > 1 && digit < 5 ? 1 : 2]
}

export function StudyClubBenefits({ stats, active, homeHref, archiveHref, onLockedFeature }: {
  stats: ClubPageViewModel['stats']
  active: boolean
  homeHref: string
  archiveHref: string
  onLockedFeature: (message: string) => void
}) {
  const runtime = useServerRuntime()
  const togetherDescription = `Викторина по категориям и совместные Данетки${runtime.meta?.features.territoryEnabled ? ', а ещё дуэль «Захват»' : ''}. Друзья играют по приглашению бесплатно.`
  const perks = [
    { id: 'archive', value: 'Весь', unit: 'архив загадок', title: 'Выбирай любой день', description: 'Возвращайся к прошлым загадкам, когда захочешь.', art: 'archive', tone: 'lilac', href: archiveHref, action: 'Открыть архив' },
    { id: 'freeplay', value: '∞', unit: 'свободных партий', title: 'Играй сколько хочется', description: `${stats.freePlayModes} ${plural(stats.freePlayModes, ['режим', 'режима', 'режимов'])} без списания билетиков.`, art: 'game', tone: 'mint', href: `${homeHref}#home-games`, action: 'Выбрать игру' },
    { id: 'danetki', value: String(stats.danetkiPerDay), unit: `${plural(stats.danetkiPerDay, ['история', 'истории', 'историй'])} в сутки`, title: 'Больше Данеток', description: 'Задавай вопросы и раскрывай необычные истории.', art: 'yes-no', tone: 'yellow', href: '/games/danetki', action: 'К Данеткам' },
    { id: 'friends', value: String(stats.friendRoomRoundLimit), unit: `${plural(stats.friendRoomRoundLimit, ['раунд', 'раунда', 'раундов'])} в комнате`, title: 'Собирайтесь вместе', description: togetherDescription, art: 'associations', tone: 'blue', href: active ? localPresentationLink('/games/together?new=1') : undefined, action: 'Создать комнату' },
  ]
  return <section className="study-club-section study-club-perks-section" id="club-content" aria-labelledby="club-content-title">
    <header><h2 id="club-content-title" tabIndex={-1}>С Клубом можно больше</h2></header>
    <div className="study-club-perks">
      {perks.map(perk => <article className="study-club-perk" data-perk={perk.id} data-tone={perk.tone} key={perk.id}>
        <div className="study-club-perk-top">
          <div className="study-club-perk-value"><strong>{perk.id === 'friends' && <small>до </small>}{perk.value}</strong><span>{perk.unit}</span></div>
          <div className="study-club-perk-art" aria-hidden="true">{perk.art === 'archive' ? <Glyph name="archive" size={80} /> : <ThemedArtwork src={publicAssetUrl(`images/home-doodle/${perk.art}.webp`)} alt="" width="80" height="80" />}</div>
        </div>
        <h3>{perk.title}</h3><p>{perk.description}</p>
        {perk.href ? <a className="quest-button quest-button--footer study-club-perk-action" href={perk.href}>{perk.action}<ArrowRight size={16} aria-hidden="true" /></a> : <QuestButton kind="footer" className="study-club-perk-action" onClick={() => onLockedFeature('Создание комнаты и совместные Данетки входят в клубный билет. Участникам по приглашению клуб не нужен.')}>{perk.action}<ArrowRight size={16} aria-hidden="true" /></QuestButton>}
      </article>)}
      <article className="study-club-perk-specials"><ThemedArtwork src={publicAssetUrl('images/home-doodle/movie.webp')} alt="" width="60" height="60" /><div><h3>И все клубные спецпоказы</h3><p>Тематические подборки загадок входят в билет.</p></div><Glyph name="medal" size={30} /></article>
    </div>
  </section>
}

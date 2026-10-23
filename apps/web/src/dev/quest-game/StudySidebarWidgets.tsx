import { QuestProgress } from '../../components/ui/QuestPrimitives'
import { GeneratedShoditsaGlyph as Glyph } from './GeneratedShoditsaArt'
import { studyAccountHref } from './account-routing'
import { studyProfileAsset } from './StudyProfileArt'
import { useStudyPlayer } from './study-player'
import './study-section-aside.css'
import type { MeResponse } from '@shoditsa/contracts'
import { queryKeys } from '../../api/client'
import { useStudyAccountCache } from './study-account-cache'
import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { publicAssetUrl } from '../../app/public-asset'
import { LOBBY_HREF } from '../../features/rooms/room-navigation'
import { SVOYAK_ENABLED } from '../../features/svoyak/SvoyakHomeCard'
import { ApplicationContinueLink } from '../../features/application/ApplicationContinueLink'
export { StudyTodayWidget } from './StudyTodayWidget'

export function StudyRoomsWidget() {
  return <section className="qg-card study-section-widget" data-study-widget="rooms"><div className="qg-side-head"><h2>Собери компанию</h2><ThemedArtwork src={publicAssetUrl('images/home-doodle/together.svg')} alt="" width="48" height="48" /></div><p>{SVOYAK_ENABLED ? 'Викторина, Данетки или Своя игра — выбирайте, во что сыграть вместе.' : 'Викторина или Данетки — выбирайте, во что сыграть вместе.'}</p><a className="quest-button quest-button--outline study-widget-action" href={LOBBY_HREF}>В лобби</a></section>
}

/** Reusable widgets own their copy. Pages choose widgets, never rename them. */
export function StudyAccountWidget() {
  const account = useStudyAccountCache<MeResponse>(queryKeys.me)
  if (account?.user && !account.user.isAnonymous) return null
  return <section className="qg-card study-section-widget study-section-widget--account" data-study-widget="account">
    <h2>Сохрани свой прогресс</h2>
    <p>Войди, чтобы продолжать свои игры на любом устройстве.</p>
    <a className="quest-button quest-button--primary study-widget-action" href={studyAccountHref('login')}>Войти в аккаунт</a>
    <a className="study-widget-link" href={studyAccountHref('register')}>Создать аккаунт</a>
  </section>
}

export function StudyGuestPlayWidget() {
  const account = useStudyAccountCache<MeResponse>(queryKeys.me)
  if (account?.user && !account.user.isAnonymous) return null
  return <section className="qg-card study-section-widget hs-guest-note" data-study-widget="guest-play">
    <div className="hs-guest-note-heading"><h2>Можно просто играть</h2><img className="hs-guest-note-illustration" src={studyProfileAsset('guest-welcome-v1')} width="96" height="80" alt="" /></div>
    <p>Играй без регистрации. Аккаунт сохранит прогресс, серию дней и билеты на всех устройствах.</p>
    <a className="quest-button quest-button--outline hs-guest-note-action" href={studyAccountHref('register')}>Создать аккаунт</a>
  </section>
}

export function StudyStreakWidget({ homeHref }: { homeHref: string }) {
  const player = useStudyPlayer()
  const plural = new Intl.PluralRules('ru').select(player.streak)
  const unit = plural === 'one' ? 'день подряд' : plural === 'few' ? 'дня подряд' : 'дней подряд'
  return <section className="qg-card study-section-widget study-section-widget--series" data-study-widget="streak">
    <div className="qg-side-head"><h2>Твоя серия</h2><Glyph name="flame" size={47} /></div>
    <div className="study-widget-number"><strong>{player.streak}</strong><span>{unit}</span></div>
    <p>{player.streak ? 'Ещё одна разгадка поможет продолжить серию.' : 'Разгадай первую загадку и начни свою серию.'}</p>
    <a className="quest-button quest-button--outline study-widget-action" href={homeHref}>Выбрать игру</a>
  </section>
}

export function StudyTasksWidget({ goalsDone }: { goalsDone: number }) {
  return <section className="qg-card study-section-widget" data-study-widget="tasks">
    <div className="qg-side-head"><h2>Твой прогресс</h2><Glyph name="quests" size={50} /></div>
    <p>Выполнено {goalsDone} из 3 заданий.</p>
    <QuestProgress value={goalsDone} max={3} label="Прогресс заданий дня" tone="green" />
    <ApplicationContinueLink className="quest-button--outline study-widget-action" />
  </section>
}

export function StudyNextBadgeWidget({ factsFound }: { factsFound: number }) {
  const found = Math.min(5, factsFound)
  return <section className="qg-card study-section-widget study-section-widget--badge" data-study-widget="next-badge">
    <Glyph name="medal" size={90} /><span className="study-widget-kicker">Следующий значок</span><h2>Мастер деталей</h2>
    <p>Собери пять разных признаков загаданного аниме.</p>
    <QuestProgress value={found} max={5} label="Признаки для следующего значка" />
    <small>Найдено {found} из 5 признаков</small>
  </section>
}

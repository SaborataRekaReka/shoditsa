import { PageHeading } from '../../components/ui/PageHeading'
import { InlineAlert } from '../../components/ui'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { useApplicationGames } from './useApplicationGames'
import { StudyProfileIllustration } from '../../dev/quest-game/StudyProfileArt'
import { GeneratedShoditsaGlyph as Glyph } from '../../dev/quest-game/GeneratedShoditsaArt'
import { useStudyPlayer } from '../../dev/quest-game/study-player'
import { studyAccountHref } from '../../dev/quest-game/account-routing'
import { RatingProfileSummary } from '../leaderboard/RatingProfileSummary'
import './application-pages.css'
import type { GlyphName } from '../../dev/quest-game/QuestArt'

export function ApplicationProfile() {
  const { games, user, loading, error, retry } = useApplicationGames()
  const player = useStudyPlayer()
  const signedIn = !!user && !user.isAnonymous
  const completed = games.filter(game => ['won', 'lost'].includes(game.status))
  return <section className="application-profile" aria-labelledby="application-profile-title">
    <PageHeading id="application-profile-title" title={signedIn ? user.name || 'Игрок' : 'Гость'} description={signedIn ? 'Твой профиль и результаты игр.' : 'Прогресс сохраняется в этом браузере.'} illustration={<StudyProfileIllustration />} />
    {error && <InlineAlert tone="danger"><span>Не удалось обновить статистику.</span><QuestButton kind="text" onClick={retry}>Повторить загрузку</QuestButton></InlineAlert>}
    <div className="application-stat-grid">{[
      { icon: 'flame', value: player.streak, label: 'Дней подряд' },
      { icon: 'medal', value: completed.filter(game => game.status === 'won').length, label: 'Побед' },
      { icon: 'play', value: completed.length, label: 'Завершённых игр' },
      { icon: 'ticket', value: player.balance, label: 'Билетиков' },
    ].map(stat => <article className="qg-card" key={stat.label}><Glyph name={stat.icon as GlyphName} size={38} /><strong>{loading || error ? '—' : stat.value}</strong><span>{stat.label}</span></article>)}</div>
    {!signedIn && <section className="qg-card application-profile-save"><h2>Продолжай на любом устройстве</h2><p>Войди, чтобы привязать прогресс к аккаунту.</p><div><a className="quest-button quest-button--primary" href={studyAccountHref('login')}>Войти</a><a className="quest-button quest-button--outline" href={studyAccountHref('register')}>Создать аккаунт</a></div></section>}
    <RatingProfileSummary signedIn={signedIn} userId={user?.id} />
    <div className="application-profile-links"><a className="quest-button quest-button--outline" href="/archive"><Glyph name="archive" size={26} />История игр</a><a className="quest-button quest-button--outline" href="/settings">Настройки аккаунта</a></div>
  </section>
}

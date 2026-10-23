import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { PageHeading } from '../../components/ui/PageHeading'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronRight, ExternalLink, Infinity as InfinityIcon, LockKeyhole, UsersRound } from 'lucide-react'
import { ECONOMY_RULE_SET } from '@shoditsa/contracts'
import { api, queryKeys } from '../../api/client'
import { localPresentationLink } from '../../app/local-presentation'
import { publicAssetUrl } from '../../app/public-asset'
import { INDEXABLE_GAME_SEO } from '../../app/seo-content'
import { QuestButton, QuestDialog } from '../../components/ui/QuestPrimitives'
import { InlineAlert } from '../../components/ui'
import { SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'
import type { ClubPageViewModel } from '../../features/commerce/club-page-model'
import { supportsClubFreePlay } from '../quest-home/game-availability'
import { STUDY_CLUB_OFFER_HREF } from './account-routing'
import { clubDanetkiRemaining, clubLibraryFilter, clubLibraryItems, type ClubLibraryFilter } from './club-library-model'
import { GeneratedShoditsaGlyph as Glyph } from './GeneratedShoditsaArt'
import { StudyHeader } from './StudyHeader'
import { StudyRightSidebar } from './StudyRightSidebar'
import { StudySidebar } from './StudySidebar'
import { StudyAccountWidget, StudyStreakWidget } from './StudySidebarWidgets'
import { StudyFooter } from './StudyTheme'
import { resolveClubLibraryAccess } from './club-library-access'
import { SpecialPackCard } from '../../components/special-pack-card/SpecialPackCard'
import { StudyClubGate } from './StudyClubGate'
import { StudyClubLockedPreviews } from './StudyClubLockedPreviews'
import './study-club-library.css'

type Props = {
  view: ClubPageViewModel
  heroStatus: string
  homeHref: string
  archiveHref: string
  profileHref: string
  onFreePlay: () => void
}
type Feature = 'freeplay' | 'danetki' | 'friends'
const games = INDEXABLE_GAME_SEO.filter(game => supportsClubFreePlay(game.mode))
const art = (mode: string) => publicAssetUrl(`images/home-doodle/${mode === 'danetki' ? 'yes-no' : mode}.webp`)
const count = (value: number, forms: [string, string, string]) => {
  const ending = new Intl.PluralRules('ru').select(value)
  return `${value} ${forms[ending === 'one' ? 0 : ending === 'few' ? 1 : 2]}`
}
const filters: Array<{ id: ClubLibraryFilter; label: string }> = [
  { id: 'all', label: 'Все' }, { id: 'in-progress', label: 'Начаты' }, { id: 'completed', label: 'Готово' },
]
const featureCopy = {
  freeplay: { title: 'Ещё одну партию?', description: 'Выбирай любимую игру. С клубным билетом свободные партии не расходуют билетики.', href: '', label: '' },
  danetki: { title: 'История ждёт разгадки', description: 'Задавай вопросы и найди объяснение необычной истории. Можно разгадывать одному или вместе с друзьями.', href: '/games/danetki', label: 'К Данеткам' },
  friends: { title: 'Во что сыграем вместе?', description: 'Викторина по категориям или совместные Данетки. Создай комнату и отправь друзьям приглашение — им клубный билет не нужен.', href: '/games/together?new=1', label: 'Создать комнату' },
} as const

/** Member library with a public explanation of the Club's specials. */
export function StudyClubLibrary({ view, heroStatus, homeHref, archiveHref, profileHref, onFreePlay }: Props) {
  const runtime = useServerRuntime()
  const queryClient = useQueryClient()
  const packs = useQuery({ queryKey: queryKeys.packs, queryFn: api.packs, enabled: SERVER_RUNTIME, retry: 1 })
  const [filter, setFilter] = useState<ClubLibraryFilter>('all')
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null)
  const active = view.membership.status === 'active'
  // A development-only visual review flag never changes the membership or launch checks.
  const memberPreview = import.meta.env.DEV && !SERVER_RUNTIME && new URLSearchParams(window.location.hash.split('?')[1]).get('memberPreview') === '1'
  const libraryAccess = memberPreview ? 'member' : resolveClubLibraryAccess({ connected: SERVER_RUNTIME, loading: runtime.loading, error: Boolean(runtime.error), authenticated: view.user.isAuthenticated, membership: view.membership.status })
  const canSeeLibrary = libraryAccess === 'member'
  const library = clubLibraryItems(SERVER_RUNTIME ? packs.data?.items ?? [] : null)
  const visiblePacks = clubLibraryFilter(library, canSeeLibrary ? filter : 'all')
  const rules = runtime.dashboard?.economyRules ?? ECONOMY_RULE_SET
  const remaining = clubDanetkiRemaining(runtime.dashboard?.danetkiAccess ?? null, active, rules)
  const isLoading = SERVER_RUNTIME && packs.isPending
  const catalogError = SERVER_RUNTIME && packs.isError
  const onlineHref = (path: string) => SERVER_RUNTIME ? localPresentationLink(path) : `https://shoditsa.ru${path}`
  const onlineProps = !SERVER_RUNTIME ? { target: '_blank', rel: 'noopener noreferrer' } : {}
  const currentFeature = selectedFeature ? featureCopy[selectedFeature] : null
  const showFeature = (feature: Feature) => {
    if (feature === 'freeplay' && SERVER_RUNTIME && active) onFreePlay()
    else setSelectedFeature(feature)
  }
  const retryAccess = () => {
    void Promise.all([queryKeys.me, queryKeys.dashboard, queryKeys.commerce].map(queryKey => queryClient.invalidateQueries({ queryKey })))
  }

  return <div className="qg-app study-club club-library" data-public-theme="quest-study" data-quest-skin="shoditsa">
    <a className="study-club-skip" href="#study-club-main" onClick={event => { event.preventDefault(); document.getElementById('study-club-main')?.focus() }}>Перейти к содержимому</a>
    <StudySidebar view="kit" currentPage="club" clubActive={active} shoditsa homeHref={homeHref} Glyph={Glyph} />
    <div className="qg-layout study-layout">
      <StudyHeader Glyph={Glyph} currentPage="club" profileHref={profileHref} />
      <main className="qg-main club-library-main" id="study-club-main" tabIndex={-1}>
        <PageHeading title="Клуб" />

        {!canSeeLibrary && <section className="club-library-welcome" aria-label="Твой Клуб"><StudyClubGate access={libraryAccess} onRetry={retryAccess} /></section>}

        <section className="club-library-section" aria-labelledby="club-play-title"><header className="club-library-section-heading"><div><h2 id="club-play-title">Играй в своём ритме</h2><p>На пять минут или на целый вечер.</p></div></header>
          <div className="club-library-activities">
            <article className="club-library-activity" data-tone="mint"><ThemedArtwork src={art('game')} alt="" width="64" height="64" /><div><h3>Ещё одну партию</h3><p>Любимые режимы без списания билетиков.</p></div><QuestButton kind="footer" onClick={() => showFeature('freeplay')}>Выбрать игру<InfinityIcon size={18} aria-hidden="true" /></QuestButton></article>
            <article className="club-library-activity" data-tone="yellow"><ThemedArtwork src={art('danetki')} alt="" width="64" height="64" /><div><h3>Раскрыть Данетку</h3><p>{remaining === null ? `${count(view.stats.danetkiPerDay, ['история', 'истории', 'историй'])} в сутки входят в билет.` : `${count(remaining, ['история осталась', 'истории осталось', 'историй осталось'])} на сегодня.`}</p></div><QuestButton kind="footer" onClick={() => showFeature('danetki')}>К историям<ArrowRight size={17} aria-hidden="true" /></QuestButton></article>
            <article className="club-library-activity" data-tone="blue"><ThemedArtwork src={art('associations')} alt="" width="64" height="64" /><div><h3>Собрать друзей</h3><p>Викторина по категориям и совместные Данетки. Друзья играют по приглашению бесплатно.</p></div><QuestButton kind="footer" onClick={() => showFeature('friends')}>Создать комнату<UsersRound size={17} aria-hidden="true" /></QuestButton></article>
            <article className="club-library-activity" data-tone="lilac"><Glyph name="archive" size={64} /><div><h3>Заглянуть в архив</h3><p>Выбирай любую прошедшую загадку.</p></div><a className="quest-button quest-button--footer" href={archiveHref}>Открыть архив<ArrowRight size={17} aria-hidden="true" /></a></article>
          </div>
        </section>

        <section className="club-library-section club-library-specials" aria-labelledby="club-specials-title">
          <header className="club-library-section-heading"><div><h2 id="club-specials-title">Клубные спецпоказы</h2><p>Тематические подборки загадок — только для участников Клуба.</p></div><Glyph name="archive" size={44} /></header>
          {canSeeLibrary ? <>
          <div className="club-library-filters" role="group" aria-label="Показать спецпоказы"><div>{filters.map(item => <QuestButton key={item.id} kind="choice" selected={filter === item.id} aria-label={item.id === 'completed' ? 'Пройденные спецпоказы' : item.id === 'in-progress' ? 'Начатые спецпоказы' : 'Все спецпоказы'} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</QuestButton>)}</div></div>
          <div className="club-library-results" aria-live="polite" aria-busy={isLoading}>
            {isLoading ? <div className="club-library-state"><Glyph name="archive" size={52} /><p>Собираем твою библиотеку…</p></div> : catalogError ? <InlineAlert tone="warning"><div><strong>Не удалось загрузить спецпоказы</strong><p>Попробуй ещё раз. Твой прогресс сохраняется.</p><QuestButton kind="text" onClick={() => void packs.refetch()}>Попробовать ещё раз</QuestButton></div></InlineAlert> : visiblePacks.length ? <div className="club-library-packs">{visiblePacks.map(pack => <SpecialPackCard key={pack.id} pack={pack} />)}</div> : <div className="club-library-state"><Glyph name={filter === 'completed' ? 'medal' : 'archive'} size={58} /><h3>{!SERVER_RUNTIME && filter !== 'all' ? 'Здесь будет твоё прохождение' : filter === 'completed' ? 'Всё интересное ещё впереди' : filter === 'in-progress' ? 'Выбирай, с чего начать' : 'Готовим новые спецпоказы'}</h3><p>{!SERVER_RUNTIME && filter !== 'all' ? 'Войди на основном сайте, чтобы увидеть свой прогресс в подборках.' : filter === 'all' ? 'Как только подборка появится, ты найдёшь её здесь.' : 'Начатые и пройденные подборки будут появляться здесь. У ежедневных спецпоказов своя новая загадка каждый день.'}</p>{filter !== 'all' && <QuestButton kind="outline" onClick={() => setFilter('all')}>Все спецпоказы</QuestButton>}</div>}
          </div>
          </> : <StudyClubLockedPreviews previews={library} state={isLoading ? 'loading' : catalogError ? 'error' : 'ready'} onRetry={() => void packs.refetch()} />}
        </section>
        <div className="club-library-endnote"><Glyph name="ticket" size={34} /><p>Билетики остаются с тобой.<br /><span>Клубные партии их не расходуют.</span></p><a href={STUDY_CLUB_OFFER_HREF}>Все возможности Клуба<ChevronRight size={16} aria-hidden="true" /></a></div>
      </main>
      <StudyRightSidebar className="club-library-aside" label="Твой клубный билет и прогресс">
        {!view.user.isAuthenticated && <StudyAccountWidget />}
        <section className="qg-card club-library-membership">{canSeeLibrary && <ThemedArtwork className="club-library-mascot" src={publicAssetUrl('images/mascot/club-v1.webp')} alt="" width="124" height="124" />}<h2>{active ? 'Всё готово для игры' : 'Больше поводов играть'}</h2><p>{active ? heroStatus : 'Спецпоказы, свободные партии и вечера с друзьями — с одним клубным билетом.'}</p><a className="quest-button quest-button--outline study-widget-action" href={active ? profileHref : STUDY_CLUB_OFFER_HREF}>{active ? 'Управление билетом' : 'О клубном билете'}</a></section>
        <StudyStreakWidget homeHref={`${homeHref}#home-games`} />
        {SERVER_RUNTIME && runtime.error && <InlineAlert tone="warning">Не удалось обновить данные аккаунта. Обнови страницу, чтобы проверить доступ и остаток историй.</InlineAlert>}
        <StudyFooter><a href={homeHref}>Все игры</a><a href={STUDY_CLUB_OFFER_HREF}>О Клубе</a><a href={localPresentationLink('/legal/terms')}>Оферта</a></StudyFooter>
      </StudyRightSidebar>
    </div>

    {currentFeature && <QuestDialog title={currentFeature.title} description={currentFeature.description} onClose={() => setSelectedFeature(null)} footer={selectedFeature !== 'freeplay' ? <a className="quest-button quest-button--primary" href={onlineHref(currentFeature.href)} {...onlineProps}>{currentFeature.label}{!SERVER_RUNTIME && <ExternalLink size={16} aria-hidden="true" />}</a> : undefined}>
      {selectedFeature === 'freeplay' ? <div className="club-library-mode-grid">{games.map(game => <a key={game.mode} href={onlineHref(game.canonicalPath)} {...onlineProps}><ThemedArtwork src={art(game.mode)} alt="" width="48" height="48" /><span>{game.shortName}</span><ChevronRight size={16} aria-hidden="true" /></a>)}<p className="club-library-detail-note">Выбери игру, затем начни свободную партию на её странице.</p></div> : <div className="club-library-feature-detail"><ThemedArtwork src={art(selectedFeature === 'friends' ? 'associations' : 'danetki')} alt="" width="120" height="120" /><p>{selectedFeature === 'friends' ? `В комнате — до ${view.stats.friendRoomRoundLimit} раундов. Одного клубного билета хватит на всю компанию.` : `${count(view.stats.danetkiPerDay, ['история', 'истории', 'историй'])} в сутки входят в клубный билет.`}</p>{!SERVER_RUNTIME && <p className="club-library-detail-note">Этот формат доступен на shoditsa.ru.</p>}{!active && SERVER_RUNTIME && <p className="club-library-detail-note"><LockKeyhole size={16} />Доступ проверяется по твоему клубному билету.</p>}</div>}
    </QuestDialog>}
  </div>
}

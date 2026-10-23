import { PageHeading } from '../../components/ui/PageHeading'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Crown, HelpCircle, RefreshCw } from 'lucide-react'
import { LEADERBOARD_REFRESH_INTERVAL_MS, RATING_RULES, type LeaderboardEntry, type LeaderboardPeriod, type MeResponse } from '@shoditsa/contracts'
import { api, queryKeys } from '../../api/client'
import { QuestButton, QuestDialog } from '../../components/ui/QuestPrimitives'
import { studyAccountHref } from '../../dev/quest-game/account-routing'
import { useStudyAccountCache } from '../../dev/quest-game/study-account-cache'
import { GeneratedShoditsaGlyph as Glyph } from '../../dev/quest-game/GeneratedShoditsaArt'
import { Mascot } from '../../components/mascot/Mascot'
import './LeaderboardScreen.css'

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value)
const pluralRules = new Intl.PluralRules('ru')
const count = (value: number, forms: [string, string, string]) => `${number(value)} ${forms[pluralRules.select(value) === 'one' ? 0 : pluralRules.select(value) === 'few' ? 1 : 2]}`
const periods: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'week', label: 'За неделю' }, { id: 'all', label: 'За всё время' },
]
const PAGE_SIZE = 5
const initialQuery = () => {
  const query = new URLSearchParams(location.search)
  const page = Number(query.get('page') ?? 1)
  return {
    period: query.get('period') === 'all' ? 'all' as const : 'week' as const,
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page - 1, 200_000) : 0,
  }
}

function PlayerAvatar({ entry }: { entry: LeaderboardEntry }) {
  const [failed, setFailed] = useState(false)
  const initials = entry.displayName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('ru') || '?'
  return <span className={`rating-avatar${entry.isClubMember ? ' rating-avatar--club' : ''}`} aria-hidden="true">
    {entry.avatarUrl && !failed ? <img src={entry.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{initials}</span>}
    {entry.isClubMember && <i><Crown size={11} strokeWidth={2.5} /></i>}
  </span>
}

function ClubMark() {
  return <span className="rating-club" title="Действующая клубная подписка"><Crown size={12} />Клуб</span>
}

function PlayerRow({ entry, onSelect }: { entry: LeaderboardEntry; onSelect: () => void }) {
  return <li className={`rating-row${entry.isCurrentUser ? ' is-current' : ''}${entry.isClubMember ? ' is-club' : ''}`}>
    <QuestButton kind="row" className="rating-row__button" onClick={onSelect} aria-label={`${entry.rank} место, ${entry.displayName}${entry.isClubMember ? ', участник клуба' : ''}${entry.isCurrentUser ? ', это ты' : ''}, ${count(entry.score, ['очко', 'очка', 'очков'])}`}>
      <span className={`rating-place rating-place--${Math.min(entry.rank, 4)}`}><b>{entry.rank}</b></span>
      <PlayerAvatar entry={entry} />
      <span className="rating-person"><strong>{entry.displayName}{entry.isCurrentUser && <em>Ты</em>}</strong><span>{entry.isClubMember && <ClubMark />}{count(entry.games, ['игра', 'игры', 'игр'])}, {count(entry.wins, ['победа', 'победы', 'побед'])}</span></span>
      <span className="rating-points"><b>{number(entry.score)}</b><small>очков</small></span>
    </QuestButton>
  </li>
}

function RatingJoinBanner({ guest, period }: { guest: boolean; period: LeaderboardPeriod }) {
  return <section className="rating-join" aria-labelledby="rating-join-title">
    <div className="rating-join__copy">
      <h3 id="rating-join-title">{guest ? 'Твой ход!' : 'Начни с одной разгадки'}</h3>
      <p>{guest ? 'Играй каждый день, набирай очки и поднимайся в рейтинге.' : 'Выбери ежедневную игру и заработай первые очки.'}</p>
      <a className="quest-button quest-button--primary" href={guest ? studyAccountHref('login', `/leaderboard?period=${period}`) : '/'}>{guest ? 'Войти и участвовать' : 'Выбрать игру'}<ArrowRight size={17} /></a>
    </div>
    <div className="rating-join__art" aria-hidden="true"><Mascot pose="celebrate" width={160} height={160} /></div>
  </section>
}

export function LeaderboardScreen() {
  const account = useStudyAccountCache<MeResponse>(queryKeys.me)
  const viewerKey = account?.user && !account.user.isAnonymous ? account.user.id : 'guest'
  const [selection, setSelection] = useState(initialQuery)
  const { period, page } = selection
  const [rulesOpen, setRulesOpen] = useState(false)
  const [player, setPlayer] = useState<LeaderboardEntry | null>(null)
  const list = useRef<HTMLOListElement>(null)
  const result = useQuery({
    queryKey: ['leaderboard', viewerKey, period, PAGE_SIZE, page],
    queryFn: () => api.leaderboard({ period, offset: page * PAGE_SIZE, limit: PAGE_SIZE }),
    placeholderData: previous => previous?.period === period ? previous : undefined,
    staleTime: LEADERBOARD_REFRESH_INTERVAL_MS, gcTime: LEADERBOARD_REFRESH_INTERVAL_MS,
    refetchInterval: LEADERBOARD_REFRESH_INTERVAL_MS, refetchOnWindowFocus: false, retry: 1,
  })
  const data = result.data
  const entries = data?.entries ?? []
  const pageCount = Math.max(1, Math.ceil((data?.participantCount ?? 0) / PAGE_SIZE))
  const displayedPage = result.isPlaceholderData && entries.length ? Math.floor((entries[0].rank - 1) / PAGE_SIZE) : page
  const title = period === 'week' ? 'Рейтинг за неделю' : 'Общий рейтинг'
  const viewer = data?.viewerEntry
  const changePage = (next: number) => setSelection({ period, page: next })
  useEffect(() => {
    if (data && !result.isPlaceholderData && page >= pageCount) changePage(pageCount - 1)
  }, [data, result.isPlaceholderData, page, pageCount])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('period', period)
    if (page) url.searchParams.set('page', String(page + 1))
    else url.searchParams.delete('page')
    url.searchParams.delete('league')
    url.searchParams.delete('group')
    const href = `${url.pathname}${url.search}${url.hash}`
    if (href !== `${location.pathname}${location.search}${location.hash}`) {
      window.history.replaceState(window.history.state, '', href)
    }
  }, [period, page])
  useEffect(() => {
    if (!data || result.isPlaceholderData) return
    const nextUpdate = Math.min(Date.parse(data.updatedAt) + LEADERBOARD_REFRESH_INTERVAL_MS, Date.parse(data.week.endsAt))
    const remaining = nextUpdate - Date.parse(data.serverTime)
    if (remaining <= 0) return
    const timer = setTimeout(() => { void result.refetch() }, Math.min(remaining + 250, 2_147_483_647))
    return () => clearTimeout(timer)
  }, [data?.updatedAt, data?.week.endsAt, data?.serverTime, result.isPlaceholderData])

  return <section className="rating-page" aria-labelledby="rating-title">
    <PageHeading id="rating-title" title="Рейтинг" description="Каждая разгадка имеет значение." actions={<QuestButton kind="icon" aria-label="Как устроен рейтинг" onClick={() => setRulesOpen(true)}><HelpCircle size={23} /></QuestButton>} />
    <nav className="rating-tabs" aria-label="Период рейтинга">{periods.map(item => <QuestButton key={item.id} kind="tab" selected={period === item.id} aria-pressed={period === item.id} onClick={() => setSelection({ period: item.id, page: 0 })}>{item.label}</QuestButton>)}</nav>

    {result.isPending && <div className="rating-loading" role="status" aria-label="Загружаем рейтинг"><div className="rating-skeleton rating-skeleton--hero" />{[0, 1, 2, 3, 4].map(key => <div className="rating-skeleton" key={key} />)}<span>Собираем результаты игроков…</span></div>}
    {result.isError && !data && <div className="rating-error" role="alert"><RefreshCw size={28} /><h2>Рейтинг пока недоступен</h2><p>Не удалось обновить результаты. Попробуй ещё раз.</p><QuestButton kind="outline" onClick={() => void result.refetch()} disabled={result.isFetching}>Повторить загрузку</QuestButton></div>}

    {data && <>
      <div className="rating-round">
        <Glyph name={period === 'week' ? 'medal' : 'league'} size={80} className="rating-illustration" />
        <div><h2>{title}</h2><p>{period === 'all' ? 'Все твои зачётные очки остаются с тобой.' : 'Новая неделя — новый шанс стать первым.'}</p></div>
      </div>

      {data.viewerState !== 'ranked' ? <RatingJoinBanner guest={data.viewerState === 'guest'} period={period} />
          : viewer ? <div className="rating-your-place"><span><Check size={18} />Твоё место <b>№ {viewer.rank}</b></span><strong>{number(viewer.score)} очков</strong>{data.pointsToNextRank !== null && <small>Ещё {number(data.pointsToNextRank)} очков до следующего места</small>}<QuestButton kind="text" onClick={() => { changePage(Math.floor((viewer.rank - 1) / PAGE_SIZE)); list.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }) }}>Найти себя</QuestButton></div> : null}

      {entries.length > 0 ? <>
        <div className="rating-list-heading"><span>Игрок</span><span>{period === 'all' ? 'Рейтинг' : 'Очки недели'}</span></div>
        <ol className="rating-list" ref={list} aria-label={title} aria-busy={result.isFetching}>{entries.map(entry => <PlayerRow key={entry.playerKey} entry={entry} onSelect={() => setPlayer(entry)} />)}</ol>
        {pageCount > 1 && <nav className="rating-pagination" aria-label="Страницы рейтинга">
          <QuestButton kind="outline" disabled={displayedPage === 0 || result.isFetching} onClick={() => changePage(displayedPage - 1)}><ArrowLeft size={17} />Назад</QuestButton>
          <span aria-live="polite">{displayedPage + 1} из {pageCount}</span>
          <QuestButton kind="outline" disabled={displayedPage + 1 >= pageCount || result.isFetching} onClick={() => changePage(displayedPage + 1)}>Вперёд<ArrowRight size={17} /></QuestButton>
        </nav>}
      </> : <div className="rating-empty"><Glyph name="league" size={96} /><h3>{period === 'week' ? 'Начни неделю первым' : 'Здесь пока тихо'}</h3><p>Первые результаты появятся после завершения ежедневных игр.</p><a className="quest-button quest-button--outline" href="/">К играм<ArrowRight size={18} /></a></div>}
    </>}

    {rulesOpen && <QuestDialog title="Как устроен рейтинг" onClose={() => setRulesOpen(false)}><div className="rating-rules"><p>Играй в ежедневные загадки. Результаты проверяет сервер. Таблица обновляется автоматически раз в 24 часа; завершённые игры учитываются при следующем обновлении.</p><div className="rating-rule"><span><Glyph name="play" size={24} />Завершение игры</span><b>+{RATING_RULES.completion}</b></div><div className="rating-rule"><span><Glyph name="league" size={24} />Победа</span><b>+{RATING_RULES.victory}</b></div><div className="rating-rule"><span><Glyph name="bolt" size={24} />Каждая неиспользованная попытка</span><b>+{RATING_RULES.unusedAttempt}</b></div><p>Например, победа с третьей попытки: 10 + 20 + 7 × 2 = <strong>44 очка</strong>. За победу в финальном выборе, «Данетках» и «Связях» — 30 очков, без бонуса за попытки.</p><h3>Что идёт в зачёт</h3><p>Первый завершённый результат в каждом режиме за дату загадки. Завершить игру нужно в тот же день по Москве. Дополнительные сложности и наборы не дают повторных очков. Открытие ответа, просроченные игры, архив, свободная игра, спецпоказы и комнаты с друзьями не приносят очков.</p><h3>Два зачёта</h3><p>«За неделю» — очки всех игроков за текущую неделю. Каждый понедельник в 00:00 МСК начинается новый зачёт, и у всех снова есть шанс стать первым.</p><p>«За всё время» — все заработанные очки. Они накапливаются и не обнуляются при смене недели. При равных очках выше тот, у кого больше побед, затем тот, кто раньше закончил последнюю зачётную игру.</p><h3><Crown size={19} /> Участники клуба</h3><p>Золотая рамка аватара и корона выделяют действующих подписчиков. Правила начисления очков одинаковы для всех.</p></div></QuestDialog>}
    {player && <QuestDialog title={player.isCurrentUser ? 'Твой результат' : 'Результат игрока'} onClose={() => setPlayer(null)}><div className="rating-player-card"><PlayerAvatar key={player.playerKey} entry={player} /><h3>{player.displayName}</h3>{player.isClubMember && <ClubMark />}<dl><div><dt>Общий рейтинг</dt><dd>{number(player.totalRating)}</dd></div><div><dt>За эту неделю</dt><dd>{number(player.weeklyRating)}</dd></div><div><dt>Игр в этом зачёте</dt><dd>{number(player.games)}</dd></div><div><dt>Побед в этом зачёте</dt><dd>{number(player.wins)}</dd></div></dl><p>Место в выбранном зачёте: <strong>№ {player.rank}</strong></p></div></QuestDialog>}
  </section>
}

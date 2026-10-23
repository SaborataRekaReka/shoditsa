import { useId } from 'react'
import type { PackLeaderboardEntry, PackLeaderboardResponse } from '@shoditsa/contracts'
import { UserAvatar } from '../../components/ui/UserAvatar'
import { GeneratedShoditsaGlyph as Glyph } from '../../dev/quest-game/GeneratedShoditsaArt'
import './DtfLeaderboard.css'

type DtfLeaderboardProps = { data?: PackLeaderboardResponse; loading?: boolean; error?: boolean }
const number = new Intl.NumberFormat('ru-RU')
const plural = new Intl.PluralRules('ru-RU')
const participants = (count: number) => `${number.format(count)} ${plural.select(count) === 'one' ? 'участник' : plural.select(count) === 'few' ? 'участника' : 'участников'}`
const countLabel = (count: number, forms: [string, string, string]) => `${count} ${forms[plural.select(count) === 'one' ? 0 : plural.select(count) === 'few' ? 1 : 2]}`

function PlayerRow({ entry, separated = false }: { entry: PackLeaderboardEntry; separated?: boolean }) {
  return <li value={entry.rank} className={`dtf-board-row${entry.isCurrentUser ? ' is-current' : ''}${separated ? ' is-separated' : ''}`} aria-current={entry.isCurrentUser ? 'true' : undefined}>
    <span className="dtf-board-place" data-place={Math.min(entry.rank, 4)} aria-label={`${entry.rank} место`}>{entry.rank}</span>
    <UserAvatar className="dtf-board-avatar" name={entry.displayName} src={entry.avatarUrl} />
    <div className="dtf-board-person">
      <div className="dtf-board-name"><strong>{entry.displayName}</strong>{entry.isCurrentUser && <span>Ты</span>}</div>
      <div className="dtf-board-stats"><span>{entry.completedItems}/{entry.totalItems} игр</span><span>{countLabel(entry.wins, ['победа', 'победы', 'побед'])}</span><span>{countLabel(entry.totalAttempts, ['попытка', 'попытки', 'попыток'])}</span></div>
    </div>
    <div className="dtf-board-points"><strong>{number.format(entry.score)}</strong><span>очков</span></div>
  </li>
}

export function DtfLeaderboard({ data, loading = false, error = false }: DtfLeaderboardProps) {
  const titleId = useId()
  const entries = data?.entries ?? []
  const viewer = data?.viewerEntry && !entries.some(entry => entry.rank === data.viewerEntry?.rank) ? data.viewerEntry : null
  return <section className="dtf-leaderboard" aria-labelledby={titleId} aria-busy={loading}>
    <header className="dtf-board-intro">
      <Glyph name="league" size={64} />
      <div><span className="dtf-board-eyebrow">Спецпоказ DTF</span><h2 id={titleId}>Игры по комментариям</h2><p>{loading ? 'Собираем результаты…' : participants(data?.participantCount ?? 0)}</p></div>
    </header>
    <div className="dtf-board-rules" aria-label="Как начисляются очки">
      <div><strong>+100</strong><span>за игру</span></div><div><strong>+50</strong><span>за победу</span></div><div><strong>+10</strong><span>за попытку в запасе</span></div>
    </div>
    <p className="dtf-board-rule-note">Бонус за оставшиеся попытки начисляется при победе.</p>
    {loading && <div className="dtf-board-state" role="status">Загружаем общий зачёт…</div>}
    {error && <div className="dtf-board-state" role="alert">Пока не удалось загрузить рейтинг. Попробуй открыть его чуть позже.</div>}
    {!loading && !error && <>
      {entries.length > 0 ? <><div className="dtf-board-columns" aria-hidden="true"><span>Игрок</span><span>Очки</span></div><ol className="dtf-board-list" aria-label="Рейтинг игроков">
        {entries.map(entry => <PlayerRow key={entry.rank} entry={entry} />)}
        {viewer && <PlayerRow entry={viewer} separated />}
      </ol></> : <div className="dtf-board-state">Здесь появятся участники спецпоказа. Сыграй первым!</div>}
    </>}
  </section>
}

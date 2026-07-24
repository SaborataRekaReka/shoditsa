import { Crown, Medal, Trophy, Users } from 'lucide-react'
import type { PackLeaderboardEntry, PackLeaderboardResponse } from '@shoditsa/contracts'
import './DtfLeaderboard.css'

type DtfLeaderboardProps = {
  data?: PackLeaderboardResponse
  loading?: boolean
  error?: boolean
}

const initials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toLocaleUpperCase('ru-RU') ?? '')
  .join('') || 'DT'

const finishLabel = (entry: PackLeaderboardEntry) => entry.completedAt
  ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(entry.completedAt))
  : null

function PlayerAvatar({ entry }: { entry: PackLeaderboardEntry }) {
  return <span className="dtf-leaderboard__avatar" aria-hidden="true">
    {entry.avatarUrl
      ? <img src={entry.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
      : initials(entry.displayName)}
  </span>
}

function PodiumCard({ entry }: { entry: PackLeaderboardEntry }) {
  const Icon = entry.rank === 1 ? Crown : Medal
  return <article className={`dtf-podium-card dtf-podium-card--${entry.rank}${entry.isCurrentUser ? ' is-current' : ''}`}>
    <span className="dtf-podium-card__place"><Icon /> {entry.rank}</span>
    <PlayerAvatar entry={entry} />
    <div>
      <strong>{entry.displayName}</strong>
      {entry.isCurrentUser && <small>Это вы</small>}
    </div>
    <b>{entry.completedItems}<small>/{entry.totalItems}</small></b>
    <span>{entry.wins} побед · {entry.totalAttempts || '—'} попыток</span>
  </article>
}

export function DtfLeaderboard({ data, loading = false, error = false }: DtfLeaderboardProps) {
  const entries = data?.entries ?? []
  const top = entries.slice(0, 3)
  const viewerOutsideTop = data?.viewerEntry ?? null

  return <section className="dtf-leaderboard" aria-labelledby="dtf-leaderboard-title">
    <header className="dtf-leaderboard__header">
      <div className="dtf-leaderboard__emblem" aria-hidden="true"><Trophy /></div>
      <div>
        <span>DTF COMMUNITY · ОБЩИЙ ЗАЧЁТ</span>
        <h2 id="dtf-leaderboard-title">Таблица игроков</h2>
        <p>Выше тот, кто прошёл больше игр, чаще победил и потратил меньше попыток.</p>
      </div>
      <strong><Users /> {data?.participantCount ?? 0}<small>участников</small></strong>
    </header>

    {loading && <div className="dtf-leaderboard__state" role="status">Собираем результаты сообщества…</div>}
    {error && <div className="dtf-leaderboard__state dtf-leaderboard__state--error" role="alert">Таблица временно недоступна. Игра продолжит работать.</div>}

    {!loading && !error && <>
      {top.length > 0 && <div className="dtf-leaderboard__podium">
        {top.map((entry) => <PodiumCard key={entry.rank} entry={entry} />)}
      </div>}

      <div className="dtf-leaderboard__table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Место</th>
              <th scope="col">Игрок</th>
              <th scope="col">Игры</th>
              <th scope="col">Победы</th>
              <th scope="col">Попытки</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => <tr key={entry.rank} className={entry.isCurrentUser ? 'is-current' : undefined}>
              <td><span className={`dtf-leaderboard__rank dtf-leaderboard__rank--${Math.min(entry.rank, 4)}`}>{entry.rank <= 3 ? <Medal /> : '#'}{entry.rank}</span></td>
              <td>
                <div className="dtf-leaderboard__player">
                  <PlayerAvatar entry={entry} />
                  <span><strong>{entry.displayName}</strong><small>{entry.isCurrentUser ? 'Вы · DTF' : entry.completedAt ? `Финиш: ${finishLabel(entry)}` : 'Участник DTF'}</small></span>
                </div>
              </td>
              <td><b>{entry.completedItems}</b><small> / {entry.totalItems}</small></td>
              <td>{entry.wins}</td>
              <td>{entry.totalAttempts || '—'}</td>
            </tr>)}
            {viewerOutsideTop && <tr className="is-current is-separated">
              <td><span className="dtf-leaderboard__rank">#{viewerOutsideTop.rank}</span></td>
              <td><div className="dtf-leaderboard__player"><PlayerAvatar entry={viewerOutsideTop} /><span><strong>{viewerOutsideTop.displayName}</strong><small>Вы · DTF</small></span></div></td>
              <td><b>{viewerOutsideTop.completedItems}</b><small> / {viewerOutsideTop.totalItems}</small></td>
              <td>{viewerOutsideTop.wins}</td>
              <td>{viewerOutsideTop.totalAttempts || '—'}</td>
            </tr>}
          </tbody>
        </table>
      </div>
      {!entries.length && <div className="dtf-leaderboard__state">Пока никто не занял место. Начните первым.</div>}
    </>}
  </section>
}

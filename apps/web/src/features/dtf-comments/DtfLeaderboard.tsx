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

const formatScore = (score: number) => new Intl.NumberFormat('ru-RU').format(score)

function PlayerAvatar({ entry }: { entry: PackLeaderboardEntry }) {
  return <span className="dtf-leaderboard__avatar" aria-hidden="true">
    {entry.avatarUrl
      ? <img src={entry.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
      : initials(entry.displayName)}
  </span>
}

function DtfBadge() {
  return <span className="dtf-leaderboard__badge" title="Участник DTF">DTF</span>
}

function PodiumCard({ entry }: { entry: PackLeaderboardEntry }) {
  const Icon = entry.rank === 1 ? Crown : Medal
  return <article className={`dtf-podium-card dtf-podium-card--${entry.rank}${entry.isCurrentUser ? ' is-current' : ''}`}>
    <span className="dtf-podium-card__place"><Icon /> {entry.rank}</span>
    <PlayerAvatar entry={entry} />
    <div>
      <strong>{entry.displayName}</strong>
      <span className="dtf-podium-card__identity"><DtfBadge />{entry.isCurrentUser && <small>Это вы</small>}</span>
    </div>
    <b>{formatScore(entry.score)}<small> баллов</small></b>
    <span>Прогресс {entry.completedItems}/{entry.totalItems} · {entry.wins} побед · {entry.totalAttempts || '—'} попыток</span>
  </article>
}

function PlayerCell({ entry }: { entry: PackLeaderboardEntry }) {
  return <div className="dtf-leaderboard__player">
    <PlayerAvatar entry={entry} />
    <span>
      <strong>{entry.displayName}</strong>
      <small><DtfBadge />{entry.isCurrentUser && <em>Вы</em>}</small>
    </span>
  </div>
}

function LeaderboardRow({ entry, separated = false }: { entry: PackLeaderboardEntry; separated?: boolean }) {
  return <tr className={`${entry.isCurrentUser ? 'is-current' : ''}${separated ? ' is-separated' : ''}`.trim() || undefined}>
    <td><span className={`dtf-leaderboard__rank dtf-leaderboard__rank--${Math.min(entry.rank, 4)}`}>{entry.rank <= 3 ? <Medal /> : '#'}{entry.rank}</span></td>
    <td><PlayerCell entry={entry} /></td>
    <td className="dtf-leaderboard__progress"><b>{entry.completedItems}</b><small> / {entry.totalItems}</small></td>
    <td className="dtf-leaderboard__score"><b>{formatScore(entry.score)}</b></td>
  </tr>
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
        <p>+100 за завершённую игру · +50 за победу · +10 за каждую сохранённую попытку</p>
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
              <th scope="col">Ник и бейдж</th>
              <th scope="col">Прогресс</th>
              <th scope="col">Баллы</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => <LeaderboardRow key={entry.rank} entry={entry} />)}
            {viewerOutsideTop && <LeaderboardRow entry={viewerOutsideTop} separated />}
          </tbody>
        </table>
      </div>
      {!entries.length && <div className="dtf-leaderboard__state">Участники появятся здесь сразу после регистрации по ссылке DTF.</div>}
    </>}
  </section>
}

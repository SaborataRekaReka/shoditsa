import { ArrowDown, ArrowUp, BarChart3, Check } from 'lucide-react'
import type { CityHint, CityRanks } from './city-game'

const CITY_RANK_METRICS: Array<{ key: keyof CityRanks; label: string }> = [
  { key: 'economy', label: 'Экономика' },
  { key: 'humanCapital', label: 'Человеческий капитал' },
  { key: 'qualityOfLife', label: 'Качество жизни' },
  { key: 'ecology', label: 'Экология' },
  { key: 'governance', label: 'Работа властей' },
]

const rankStrength = (rank: number | null) => rank == null
  ? 0
  : Math.max(1, Math.min(100, Math.round(((1001 - rank) / 1000) * 100)))

const comparisonLabel = (hint: CityHint | undefined) => {
  if (!hint || hint.status === 'unknown') return 'Нет данных'
  if (hint.status === 'match') return 'Совпало'
  if (hint.direction === 'up') return hint.status === 'close' ? 'Искомый выше · близко' : 'Искомый выше'
  if (hint.direction === 'down') return hint.status === 'close' ? 'Искомый ниже · близко' : 'Искомый ниже'
  return 'Сравните место'
}

export function CityRankProfile({ ranks, hints }: { ranks: CityRanks; hints: CityHint[] }) {
  const hintsByKey = new Map(hints.map((hint) => [hint.key, hint]))

  return <section className="city-rank-profile" aria-label="Рейтинговый профиль города">
    <header className="city-rank-profile__heading">
      <span><BarChart3 /> Городской профиль</span>
      <small>Длиннее шкала — выше место в рейтинге</small>
    </header>
    <div className="city-rank-profile__grid">
      {CITY_RANK_METRICS.map(({ key, label }) => {
        const rank = ranks[key]
        const hint = hintsByKey.get(key)
        const strength = rankStrength(rank)
        return <div className={`city-rank-meter city-rank-meter--${hint?.status ?? 'unknown'}`} key={key}>
          <span className="city-rank-meter__label" title={label}>{label}</span>
          <strong>{rank == null ? '—' : `№ ${rank}`}</strong>
          <i
            className="city-rank-meter__track"
            role="progressbar"
            aria-label={`${label}: ${rank == null ? 'нет данных' : `место ${rank} из 1000`}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={strength}
          >
            <b style={{ width: `${strength}%` }} />
          </i>
          <small className="city-rank-meter__comparison">
            {hint?.status === 'match' ? <Check /> : hint?.direction === 'up' ? <ArrowUp /> : hint?.direction === 'down' ? <ArrowDown /> : null}
            {comparisonLabel(hint)}
          </small>
        </div>
      })}
    </div>
  </section>
}

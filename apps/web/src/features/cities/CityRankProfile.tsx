import { ArrowDown, ArrowUp, Check, Coins, HeartPulse, Landmark, Leaf, MapPinned, Minus, UsersRound, type LucideIcon } from 'lucide-react'
import type { CityHint, CityRanks } from './city-game'

const CITY_RANK_METRICS: Array<{ key: keyof CityRanks; label: string; icon: LucideIcon }> = [
  { key: 'economy', label: 'Экономика', icon: Coins },
  { key: 'humanCapital', label: 'Человеческий капитал', icon: UsersRound },
  { key: 'qualityOfLife', label: 'Качество жизни', icon: HeartPulse },
  { key: 'ecology', label: 'Экология', icon: Leaf },
  { key: 'governance', label: 'Работа властей', icon: Landmark },
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

export function CityRankProfile({ ranks, hints, compact = false }: { ranks: CityRanks; hints: CityHint[]; compact?: boolean }) {
  const hintsByKey = new Map(hints.map((hint) => [hint.key, hint]))

  return <section className={`city-rank-profile ${compact ? 'city-rank-profile--header' : ''}`} aria-label="Рейтинговый профиль города">
    <header className="city-rank-profile__heading">
      <span className="city-rank-profile__mark"><MapPinned /></span>
      <strong>Городской профиль</strong>
    </header>
    <div className="city-rank-profile__grid">
      {CITY_RANK_METRICS.map(({ key, label, icon: MetricIcon }) => {
        const rank = ranks[key]
        const hint = hintsByKey.get(key)
        const strength = rankStrength(rank)
        return <div className={`city-rank-meter city-rank-meter--${hint?.status ?? 'unknown'}`} key={key}>
          <MetricIcon className="city-rank-meter__icon" aria-hidden="true" />
          <span className="city-rank-meter__label">{label}</span>
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
          <strong>{rank == null ? '—' : `№ ${rank}`}</strong>
          <span className="city-rank-meter__comparison" title={comparisonLabel(hint)} aria-label={comparisonLabel(hint)}>
            {hint?.status === 'match' ? <Check /> : hint?.direction === 'up' ? <ArrowUp /> : hint?.direction === 'down' ? <ArrowDown /> : <Minus />}
          </span>
        </div>
      })}
    </div>
  </section>
}

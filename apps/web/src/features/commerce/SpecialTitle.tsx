import { ArrowRight, CalendarDays, ChevronDown, Trophy } from 'lucide-react'
import { KPOP_ARTISTS_PACK_ID } from '@shoditsa/contracts'
import type { api } from '../../api/client'
import { QuestTitleHero } from '../../dev/quest-game/QuestTitleLayout'
import { StudyGlyph } from '../../dev/quest-game/ShoditsaPresentation'
import { GameLaunchButton, GameLaunchControls, GameOptionAction } from '../../components/game-launch-controls/GameLaunchControls'
import { InlineAlert } from '../../components/ui'
import { KPOP_GENERATION_RANGES } from '../../game'
import './SpecialTitle.css'

type Pack = Awaited<ReturnType<typeof api.pack>>['pack']

export function SpecialTitle({ pack, starting, canStart, error, onStart, onLeaderboard }: {
  pack: Pack; starting: boolean; canStart: boolean; error: string; onStart: () => void; onLeaderboard?: () => void
}) {
  const kpop = pack.id === KPOP_ARTISTS_PACK_ID
  const mode = kpop ? 'music' : 'game'
  const steps = kpop ? [
    'Предложите K-pop артиста: солиста или группу.',
    'Сравните поколение, состав, пол и другие признаки.',
    'Уточняйте версию — у вас десять попыток на артиста дня.',
  ] : [
    'Прочитайте первый комментарий и предложите видеоигру.',
    'Сравните признаки: жанры, платформы, год и создателей.',
    'После каждой попытки откроется ещё комментарий. Всего шесть попыток.',
  ]
  const finished = !kpop && pack.completedItems >= pack.totalItems
  const action = starting ? 'Запускаем…' : kpop ? 'Играть сегодня' : finished ? 'Подборка пройдена' : pack.completedItems > 0 ? 'Продолжить' : 'Начать игру'
  return <div className={`qt-title qt-title--${mode} special-game-title`}>
    <QuestTitleHero mode={mode} kicker={kpop ? 'Клубный спецпоказ · K-pop' : `Клубный спецпоказ · DTF · ${pack.totalItems} игр`} title={pack.title} lead={kpop ? 'Угадайте K-pop артиста дня за десять попыток' : 'Узнайте видеоигру по комментариям за шесть попыток'}>
      <div className="qt-connected-launch"><GameLaunchControls mode={mode}
        action={<GameLaunchButton disabled={!canStart || starting} onClick={onStart}>{action}</GameLaunchButton>}
        option={onLeaderboard ? <GameOptionAction label="Общий зачёт" labelIcon={<Trophy />} value="Рейтинг игроков" onClick={onLeaderboard} /> : undefined}
      /></div>
    </QuestTitleHero>
    {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    <div className="qt-content">
      <section className="qg-card special-game-progress" aria-labelledby="special-progress-title">
        <div><StudyGlyph name={kpop ? 'archive' : 'medal'} size={44} /><span><h2 id="special-progress-title">{kpop ? 'Новый артист каждый день' : finished ? 'Подборка завершена' : 'Твой прогресс'}</h2><p>{kpop ? 'Загадка обновляется в 00:00 МСК' : `${pack.completedItems} из ${pack.totalItems} игр сыграно`}</p></span>{!kpop && <strong>{pack.completedItems}<small> / {pack.totalItems}</small></strong>}</div>
        {!kpop && <><progress aria-label="Прогресс подборки" value={pack.completedItems} max={pack.totalItems} /><p className="special-game-progress__stats"><span><b>{pack.wonItems ?? 0}</b> угадано</span><span><b>{pack.lostItems ?? 0}</b> не угадано</span></p></>}
      </section>
      <section className="qt-route" aria-labelledby="special-steps-title">
        <div className="qt-section-heading"><span>{kpop ? 'Знакомые правила' : 'Комментарии вместо первого кадра'}</span><h2 id="special-steps-title">{kpop ? 'Как найти артиста' : 'Как угадать игру'}</h2></div>
        <ol>{steps.map((step, index) => <li className="qg-card qt-route-card" key={step}><div className="qt-route-art"><StudyGlyph name={(['play','hint','medal'] as const)[index]} size={62} /><span aria-hidden="true">{String(index + 1).padStart(2,'0')}</span></div><div><p>{step}</p></div></li>)}</ol>
      </section>
      <details className="qg-card qt-disclosure">
        <summary><StudyGlyph name="archive" size={42} /><span><small>{kpop ? 'Пять поколений сцены' : 'Специальная подборка'}</small><h2>{kpop ? 'Как считаются поколения' : 'О спецпоказе DTF'}</h2></span><ChevronDown size={20} /></summary>
        <div className="qt-disclosure-body"><p>{pack.description}</p>{kpop && <ol className="special-generation-list">{KPOP_GENERATION_RANGES.map(entry => <li key={entry.generation}><strong>{entry.label}</strong><span>{entry.years}</span></li>)}</ol>}</div>
      </details>
      <a className="special-game-related" href={`/games/${mode}`}>{kpop ? <CalendarDays size={20} /> : <StudyGlyph name="play" size={28} />}<span>{kpop ? 'Ежедневная игра «Музыка»' : 'Ежедневная игра «Видеоигры»'}</span><ArrowRight size={18} /></a>
    </div>
  </div>
}

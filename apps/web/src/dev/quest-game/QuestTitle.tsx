import { useRef, useState } from 'react'
import { DIFFICULTIES, DIFFICULTY_ORDER, PERIODS, getMoscowDate } from '@shoditsa/game-core'
import { GAME_MODE_MANIFEST, type DifficultyKey, type PeriodKey } from '@shoditsa/contracts'
import { ArrowRight, Check, ChevronDown } from 'lucide-react'
import { QuestButton, QuestDialog } from '../../components/ui/QuestPrimitives'
import { DANETKI_RULES, GAME_RULES, type SeoGameMode } from '../../app/seo-content'
import { StudyGlyph } from './ShoditsaPresentation'
import { QuestTitleLayout } from './QuestTitleLayout'
import { dayNumber } from '../../game/day-number'

const periods: PeriodKey[] = ['all', 'from_2020', 'from_2010', 'from_2000', 'from_1990', 'from_1980', 'from_1960']
export type QuestPeriod = PeriodKey
export type QuestLaunchSelection = { difficulty: DifficultyKey; variant: string; room: 'solo' | 'group' }
const standardHint = 'Перед пятой и восьмой попытками можно открыть по одной из трёх дополнительных подсказок.'

export function QuestTitle({ mode = 'anime', onStart, allGamesHref = '#games' }: { mode?: SeoGameMode; onStart: (period: QuestPeriod, selection: QuestLaunchSelection) => void; allGamesHref?: string }) {
  const params = new URLSearchParams(location.search)
  const requested = params.get('period')
  const [period, setPeriod] = useState<QuestPeriod>(periods.find(id => id === requested || id === `from_${requested}`) ?? 'all')
  const [difficulty, setDifficulty] = useState<DifficultyKey>(DIFFICULTY_ORDER.find(id => id === params.get('difficulty')) ?? 'medium')
  const [variant, setVariant] = useState<string>(GAME_MODE_MANIFEST.city.variants.find(item => item.id === params.get('variant'))?.id ?? GAME_MODE_MANIFEST.city.variants[0].id)
  const [room, setRoom] = useState<'solo' | 'group'>('solo')
  const [showOptions, setShowOptions] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const hostedOnly = mode === 'danetki' || mode === 'connections'
  const periodOption = GAME_MODE_MANIFEST[mode].periodPolicy === 'year'
  const hasOption = periodOption || mode === 'music' || mode === 'city' || mode === 'danetki'
  const optionLabel = periodOption ? 'Период' : mode === 'music' ? 'Сложность' : mode === 'city' ? 'Набор городов' : 'Формат игры'
  const optionValue = periodOption ? PERIODS[period].label : mode === 'music' ? DIFFICULTIES[difficulty].label : mode === 'city' ? GAME_MODE_MANIFEST.city.variants.find(item => item.id === variant)!.label : room === 'solo' ? 'Одному' : 'Вместе'
  const rules = mode === 'danetki' ? DANETKI_RULES : GAME_RULES[mode]
  const closeOptions = () => { setShowOptions(false); requestAnimationFrame(() => trigger.current?.focus()) }

  return <><QuestTitleLayout mode={mode} allGamesHref={allGamesHref}>
      <div className={`qt-launch${hasOption ? '' : ' qt-launch--single'}`}>
        <QuestButton id="qt-start" disabled={hostedOnly} onClick={() => onStart(period, { difficulty, variant, room })}>Начать игру<ArrowRight size={20} /></QuestButton>
        {hasOption && <QuestButton ref={trigger} kind="choice" aria-label={`${optionLabel}: ${optionValue}`} aria-haspopup="dialog" aria-expanded={showOptions} onClick={() => setShowOptions(true)}><StudyGlyph name={mode === 'danetki' ? 'profile' : 'archive'} size={32} /><span className="qt-period-copy"><small>{optionLabel}</small><strong>{optionValue}</strong></span><ChevronDown size={18} /></QuestButton>}
      </div>
      {hostedOnly && <p className="qt-local-note">В этом локальном просмотре доступно оформление. {mode === 'danetki' ? 'Расследовать истории' : 'Решать «Связи»'} можно <a href={`https://shoditsa.ru/games/${mode}`} target="_blank" rel="noreferrer">на основном сайте ↗</a>.</p>}
    </QuestTitleLayout>

    {showOptions && <QuestDialog title={optionLabel} description={rules.modeNote} onClose={closeOptions}>
      <div className="qt-period-options">
        {periodOption && periods.map(id => <QuestButton kind="choice" key={id} selected={period === id} aria-pressed={period === id} onClick={() => { setPeriod(id); closeOptions() }}><span><strong>{PERIODS[id].label}</strong></span>{period === id && <Check size={22} />}</QuestButton>)}
        {mode === 'music' && DIFFICULTY_ORDER.map(id => <QuestButton kind="choice" key={id} selected={difficulty === id} aria-pressed={difficulty === id} onClick={() => { setDifficulty(id); closeOptions() }}><span><strong>{DIFFICULTIES[id].label}</strong><small>{DIFFICULTIES[id].hint}</small></span>{difficulty === id && <Check size={22} />}</QuestButton>)}
        {mode === 'city' && GAME_MODE_MANIFEST.city.variants.map(item => <QuestButton kind="choice" key={item.id} selected={variant === item.id} aria-pressed={variant === item.id} onClick={() => { setVariant(item.id); closeOptions() }}><span><strong>{item.label}</strong><small>{item.description}</small></span>{variant === item.id && <Check size={22} />}</QuestButton>)}
        {mode === 'danetki' && (['solo', 'group'] as const).map(id => <QuestButton kind="choice" key={id} selected={room === id} aria-pressed={room === id} onClick={() => { setRoom(id); closeOptions() }}><span><strong>{id === 'solo' ? 'Одному' : 'Вместе'}</strong><small>{id === 'solo' ? 'С ведущим' : 'До 4 игроков'}</small></span>{room === id && <Check size={22} />}</QuestButton>)}
      </div>
    </QuestDialog>}
  </>
}

export function QuestTitleAside({ mode = 'anime', showDate = true }: { mode?: SeoGameMode; showDate?: boolean }) {
  const rules = mode === 'danetki' ? DANETKI_RULES : GAME_RULES[mode]
  const connections = mode === 'connections', danetki = mode === 'danetki'
  return <>
    {showDate && <div className="qt-side-date"><StudyGlyph name="flame" size={28} /><span>Игра дня №{dayNumber(getMoscowDate())}</span></div>}
    <section className={`qg-card qt-daily${danetki ? ' qt-daily--host' : ''}`} aria-label={connections ? 'Группы слов' : danetki ? 'Ответы ведущего' : 'Попытки'}>
      <div><span><strong>{connections ? '4' : danetki ? 'Да / нет' : '10'}</strong>{connections ? 'группы' : danetki ? 'ответы ведущего' : 'попыток'}</span><StudyGlyph name={connections ? 'quests' : danetki ? 'hint' : 'heart'} size={80} /></div>
      {!danetki && <div className="qt-attempt-dots" aria-hidden="true">{Array.from({ length: connections ? 4 : 10 }, (_, index) => <i key={index} />)}</div>}
      <p>{rules.searchInstruction}</p>
    </section>
    <section className="qg-card qt-side-note" aria-label="Подсказки">
      <div className="qt-side-note-head"><StudyGlyph name={danetki ? 'profile' : 'hint'} size={54} />{!danetki && <span className="qt-checkpoints" aria-hidden="true"><b>{connections ? '1' : '5'}</b><b>{connections ? '3' : '8'}</b></span>}</div>
      <p>{connections ? rules.directionInstruction : danetki || mode === 'music' ? rules.modeNote : standardHint}</p>
    </section>
  </>
}

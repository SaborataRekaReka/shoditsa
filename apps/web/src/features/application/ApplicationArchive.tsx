import { GameArtwork } from '../../components/ui/GameArtwork'
import { PageHeading } from '../../components/ui/PageHeading'
import { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { INDEXABLE_GAME_SEO } from '../../app/seo-content'
import { useApplicationGames } from './useApplicationGames'
import { GeneratedShoditsaGlyph as Glyph } from '../../dev/quest-game/GeneratedShoditsaArt'
import { InlineAlert, SelectControl } from '../../components/ui'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { ApplicationArchiveCalendar } from './ApplicationArchiveCalendar'
import './application-pages.css'
const attemptsLabel = (value: number) => `${value} ${new Intl.PluralRules('ru').select(value) === 'one' ? 'попытка' : new Intl.PluralRules('ru').select(value) === 'few' ? 'попытки' : 'попыток'}`

export function ApplicationArchive() {
  const { games, loading, error, retry } = useApplicationGames()
  const [filter, setFilter] = useState('all')
  const [section, setSection] = useState<'calendar' | 'history'>('calendar')
  const visible = games.filter(game => (game.attempts > 0 || ['won', 'lost'].includes(game.status)) && (filter === 'all' || game.mode === filter))
  return <section className="application-archive" aria-labelledby="application-archive-title">
    <PageHeading id="application-archive-title" title="Архив" description="Выбирай загадку по дате или продолжай начатую партию." />
    {error && <InlineAlert tone="danger"><span>Не удалось обновить историю игр.</span><QuestButton kind="text" onClick={retry}>Повторить загрузку</QuestButton></InlineAlert>}
    <div className="application-archive-tabs" role="group" aria-label="Раздел архива"><QuestButton kind="choice" selected={section === 'calendar'} aria-pressed={section === 'calendar'} onClick={() => setSection('calendar')}>По дням</QuestButton><QuestButton kind="choice" selected={section === 'history'} aria-pressed={section === 'history'} onClick={() => setSection('history')}>Мои партии</QuestButton></div>
    {section === 'calendar' ? <ApplicationArchiveCalendar games={games} /> : <>
    <label className="application-archive-filter">Игра<SelectControl variant="soft" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Все игры</option>{INDEXABLE_GAME_SEO.map(game => <option value={game.mode} key={game.mode}>{game.shortName}</option>)}</SelectControl></label>
    {loading ? <p role="status">Загружаем историю…</p> : visible.length ? <div className="application-archive-list">{visible.map(game => <a className="qg-card application-archive-game" href={game.href} key={game.id}><GameArtwork mode={game.mode} alt="" width="56" height="56" /><div><strong>{game.title}</strong><span>{game.date.split('-').reverse().join('.')}, {attemptsLabel(game.attempts)}</span><small>{game.status === 'won' ? 'Разгадано' : game.status === 'lost' ? 'Завершено' : 'В процессе'}</small></div>{['won', 'lost'].includes(game.status) ? <Check size={22} /> : <ArrowRight size={22} />}</a>)}</div> : !error && <div className="qg-card application-empty"><Glyph name="archive" size={100} /><h2>Пока нет сохранённых партий</h2><p>Начни любую игру — здесь появится её история.</p><a className="quest-button quest-button--primary" href="/">Выбрать игру</a></div>}
    </>}
  </section>
}

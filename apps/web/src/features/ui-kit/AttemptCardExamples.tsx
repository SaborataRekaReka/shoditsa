import { useState } from 'react'
import type { Attempt, TitleItem, TitleMode } from '../../types'
import { FormField, SelectControl } from '../../components/ui'
import { ComparisonAttemptCard, AttemptMetadata, type AttemptPresentation } from '../game-session/ComparisonAttemptCard'

const examples: Array<{ label: string; mode: TitleMode; title: string; original: string }> = [
  { label: 'Диагнозы', mode: 'diagnosis', title: 'Вульвовагинальный кандидоз', original: 'Vulvovaginal candidiasis' },
  { label: 'Кино', mode: 'movie', title: 'Интерстеллар', original: 'Interstellar' },
  { label: 'Сериалы', mode: 'series', title: 'Очень странные дела', original: 'Stranger Things' },
  { label: 'Аниме', mode: 'anime', title: 'Унесённые призраками', original: 'Sen to Chihiro no kamikakushi' },
  { label: 'Видеоигры', mode: 'game', title: 'Ведьмак 3: Дикая Охота', original: 'The Witcher 3: Wild Hunt' },
  { label: 'Музыка', mode: 'music', title: 'Кино', original: 'Kino' },
  { label: 'Города', mode: 'city', title: 'Санкт-Петербург', original: 'Saint Petersburg' },
  { label: 'Животные', mode: 'animal', title: 'Амурский тигр', original: 'Panthera tigris altaica' },
  { label: 'Книги', mode: 'book', title: 'Мастер и Маргарита', original: 'Михаил Булгаков' },
  { label: 'Персонажи', mode: 'character', title: 'Шерлок Холмс', original: 'Sherlock Holmes' },
]

export function AttemptCardExamples() {
  const [mode, setMode] = useState<TitleMode>('diagnosis')
  const [summary, setSummary] = useState<AttemptPresentation['summary']>('compact')
  const [state, setState] = useState('mixed')
  const example = examples.find(item => item.mode === mode)!
  const item: TitleItem = {
    id: mode === 'diagnosis' ? 'dx_vulvovaginal_candidiasis' : `ui-kit-${mode}`,
    mode, titleRu: example.title, titleOriginal: example.original, alternativeTitles: [], popularityScore: 1,
  }
  // Deliberately synthetic comparison states, independent of a hidden answer or account.
  const hints: Attempt['hints'] = Array.from({ length: 10 }, (_, index) => ({
    key: `example_${index}`, label: `Признак ${index + 1}`, value: 'Пример', direction: null,
    status: state === 'won' ? 'match' : state === 'unknown' ? 'unknown' : state === 'miss' ? 'miss' : index === 0 ? 'match' : index < 3 ? 'partial' : 'miss',
  }))
  return <>
    <div className="ui-kit-form-grid">
      <FormField label="Игра" htmlFor="attempt-example-mode"><SelectControl id="attempt-example-mode" value={mode} onChange={event => setMode(event.target.value as TitleMode)}>{examples.map(example => <option key={example.mode} value={example.mode}>{example.label}</option>)}</SelectControl></FormField>
      <FormField label="Совпадения" htmlFor="attempt-example-summary"><SelectControl id="attempt-example-summary" value={summary} onChange={event => setSummary(event.target.value as AttemptPresentation['summary'])}><option value="compact">Значки и числа</option><option value="labels">С подписями</option><option value="bar">Только шкала</option></SelectControl></FormField>
      <FormField label="Состояние" htmlFor="attempt-example-state"><SelectControl id="attempt-example-state" value={state} onChange={event => setState(event.target.value)}><option value="mixed">Точное и частичные</option><option value="miss">Нет совпадений</option><option value="won">Угадано</option><option value="unknown">Нет данных</option></SelectControl></FormField>
    </div>
    <ComparisonAttemptCard item={item} attempt={{ titleId: item.id, hints }} index={0} isCorrectAttempt={state === 'won'} presentation={{ summary }} subtitle={item.titleOriginal} metadata={mode === 'diagnosis' ? <AttemptMetadata label="МКБ">B37.3</AttemptMetadata> : undefined}>
      {null}
    </ComparisonAttemptCard>
  </>
}

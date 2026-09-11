import { BookOpen } from 'lucide-react'
import { ControlButton } from '../../components/ui'
import './CharacterFirstMove.css'

const CHARACTER_EXAMPLES = ['Шерлок Холмс', 'Золушка', 'Граф Дракула'] as const

export type CharacterFirstMoveProps = {
  onExample: (query: string) => void
  variant?: 'intro' | 'empty-search'
  disabled?: boolean
}

/** Examples fill the search input; selecting an actual search result remains a separate action. */
export function CharacterFirstMove({ onExample, variant = 'intro', disabled = false }: CharacterFirstMoveProps) {
  const emptySearch = variant === 'empty-search'

  return <div className={`character-first-move${emptySearch ? ' character-first-move--empty' : ''}`}>
    <div className="character-first-move__intro">
      {!emptySearch && <BookOpen className="character-first-move__icon" aria-hidden="true" />}
      <div>
        <p className="character-first-move__title">{emptySearch ? 'Такого имени пока не нашли' : 'Начните со знакомого героя'}</p>
        <p className="character-first-move__description">{emptySearch
          ? 'Возможно, этого героя ещё нет в подборке. Здесь — персонажи классической литературы, сказок и мифов. Попробуйте другое имя или один из примеров.'
          : 'Здесь — персонажи классической литературы, сказок и мифов. Выберите героя, а сравнение признаков после ответа поможет найти загаданного.'}</p>
      </div>
    </div>
    <div className="character-first-move__examples" aria-label="Примеры персонажей для поиска">
      {CHARACTER_EXAMPLES.map((query) => <ControlButton
        key={query}
        type="button"
        className="character-first-move__example"
        disabled={disabled}
        onClick={() => onExample(query)}
      >{query}</ControlButton>)}
    </div>
    <p className="character-first-move__note">Пример подставит имя в поиск. Попытка начнётся, когда вы выберете героя из списка.</p>
  </div>
}

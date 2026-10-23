import type { Attempt } from '../../types'
import { ReferenceMatchSymbol } from './ReferenceMatchSymbol'

export function ReferenceClueState({ hint }: { hint: Attempt['hints'][number] }) {
  const partial = hint.status === 'close' || hint.status === 'partial'
  const kind = hint.direction === 'up' ? 'up' : hint.direction === 'down' ? 'down'
    : hint.status === 'match' ? 'match' : partial ? 'partial'
      : hint.status === 'miss' ? 'miss' : 'unknown'
  const label = hint.direction === 'up' ? 'Загаданное значение больше' : hint.direction === 'down' ? 'Загаданное значение меньше'
    : hint.status === 'match' ? 'Точное совпадение' : partial ? 'Частичное совпадение'
      : hint.status === 'miss' ? 'Не совпадает' : 'Нет данных'
  return <span className={`reference-clue-state reference-clue-state--${hint.status}`} aria-label={label} title={label}><ReferenceMatchSymbol kind={kind} /></span>
}

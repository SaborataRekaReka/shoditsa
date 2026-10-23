import { ArrowRight, Check, Globe2, CirclePlus } from 'lucide-react'
import type { GameAvailability } from './game-availability'

export const AVAILABILITY_PRESENTATION = {
  new: { label: 'Новая', detail: 'Новая загадка доступна', Icon: CirclePlus },
  'in-progress': { label: 'В процессе', detail: 'Загадка уже начата', Icon: ArrowRight },
  completed: { label: 'Завершено', detail: 'Сегодняшняя загадка уже завершена', Icon: Check },
  online: { label: 'Онлайн', detail: 'Игра доступна онлайн', Icon: Globe2 },
} as const

export function GameAvailabilityBadge({ state }: { state: GameAvailability }) {
  const { label, detail, Icon } = AVAILABILITY_PRESENTATION[state]
  return <span className={`hs-availability hs-availability--${state}`} title={detail}>
    {state !== 'new' && <Icon size={13} strokeWidth={3} aria-hidden="true" />}<span>{label}</span>
  </span>
}

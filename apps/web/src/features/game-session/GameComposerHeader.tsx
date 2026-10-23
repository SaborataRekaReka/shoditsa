import { Lightbulb } from 'lucide-react'
import { SegmentedProgress } from '../../components/ui/Progress'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import './GameComposerHeader.css'

export function GameComposerHeader({ attempts, max = 10, pending = false, hintLabel = 'Подсказка', onHint }: {
  attempts: number; max?: number; pending?: boolean; hintLabel?: string; onHint?: () => void
}) {
  return <div className="game-composer-header">
    <SegmentedProgress variant="composer" value={attempts} max={max} label="Твоя версия" valueLabel={<span role="status" aria-live="polite">{pending ? 'Проверяем…' : `Попытка ${Math.min(attempts + 1, max)} из ${max}`}</span>} ariaLabel={`Использовано попыток: ${attempts} из ${max}`} />
    {onHint && <QuestButton kind="outline" size="compact" onClick={onHint}><Lightbulb size={17} />{hintLabel}</QuestButton>}
  </div>
}

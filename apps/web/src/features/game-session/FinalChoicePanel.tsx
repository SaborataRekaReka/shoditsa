import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { FinalChoiceSnapshot } from '@shoditsa/contracts'
import { TitlePoster } from '../../components/title-poster/TitlePoster'
import { ActionButton, ControlButton, DialogSurface, InlineAlert, StatusBadge, TextButton } from '../../components/ui'
import type { TitleMode } from '../../types'
import { finalChoiceCandidateLabel, finalChoiceCandidateTitleItem } from './final-choice-presentation'
import './FinalChoicePanel.css'

export type FinalChoicePanelProps = {
  mode: TitleMode
  snapshot: FinalChoiceSnapshot
  selectedItemId: string | null
  secondsRemaining?: number
  pending?: boolean
  error?: string
  autoFocus?: boolean
  onSelect: (itemId: string, position: number) => void
  onSubmit: () => void
  onReveal: () => void
  onRevealDialogOpen?: () => void
  onRevealDialogCancel?: () => void
}

export function FinalChoicePanel({
  mode,
  snapshot,
  selectedItemId,
  secondsRemaining,
  pending = false,
  error,
  autoFocus = true,
  onSelect,
  onSubmit,
  onReveal,
  onRevealDialogOpen,
  onRevealDialogCancel,
}: FinalChoicePanelProps) {
  const [revealOpen, setRevealOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([])
  const dragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const selectedIndex = snapshot.candidates.findIndex((candidate) => candidate.item.id === selectedItemId)

  useEffect(() => {
    if (!autoFocus) return
    headingRef.current?.focus({ preventScroll: true })
    headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [autoFocus, snapshot])

  const openReveal = () => {
    if (pending) return
    setRevealOpen(true)
    onRevealDialogOpen?.()
  }
  const cancelReveal = () => {
    if (pending) return
    setRevealOpen(false)
    onRevealDialogCancel?.()
  }
  const confirmReveal = () => {
    setRevealOpen(false)
    onReveal()
  }
  const selectAt = (index: number) => {
    const normalized = (index + snapshot.candidates.length) % snapshot.candidates.length
    const candidate = snapshot.candidates[normalized]
    onSelect(candidate.item.id, normalized)
    const card = cardRefs.current[normalized]
    card?.focus({ preventScroll: true })
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
  }
  const onCardKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') selectAt(0)
    else if (event.key === 'End') selectAt(snapshot.candidates.length - 1)
    else selectAt(index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1))
  }
  const onGridPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || pending) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    }
  }
  const onGridPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientX - drag.startX
    if (!drag.moved && Math.abs(delta) < 5) return
    if (!drag.moved) {
      drag.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
    }
    event.preventDefault()
    event.currentTarget.scrollLeft = drag.startScrollLeft - delta
  }
  const onGridPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag && drag.pointerId === event.pointerId && !drag.moved) {
      dragRef.current = null
    }
  }
  const finishGridDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.moved) {
      suppressClickRef.current = true
      window.setTimeout(() => { suppressClickRef.current = false }, 0)
    }
    dragRef.current = null
    setDragging(false)
  }

  return <>
    <section className="final-choice-panel" aria-labelledby="final-choice-title">
      <div className="final-choice-panel__head">
        <div>
          <span className="final-choice-panel__kicker">Почти сошлось</span>
          <h2 id="final-choice-title" ref={headingRef} tabIndex={-1}>Последний выбор</h2>
          <p>Все сравнительные подсказки уже на экране. Сопоставьте их с вариантами и выберите один.</p>
        </div>
        <StatusBadge tone={secondsRemaining != null && secondsRemaining <= 3 ? 'danger' : 'warning'}>
          {secondsRemaining == null
            ? '1 выбор'
            : <span
                className="final-choice-panel__timer"
                role="timer"
                aria-label={`Осталось ${secondsRemaining} секунд`}
              >
                00:{String(secondsRemaining).padStart(2, '0')}
              </span>}
        </StatusBadge>
      </div>

      <div
        ref={gridRef}
        className={`final-choice-grid${dragging ? ' is-dragging' : ''}`}
        role="radiogroup"
        aria-label="Варианты финального выбора"
        aria-describedby="final-choice-swipe-hint"
        aria-busy={pending}
        onPointerDown={onGridPointerDown}
        onPointerMove={onGridPointerMove}
        onPointerLeave={onGridPointerLeave}
        onPointerUp={finishGridDrag}
        onPointerCancel={finishGridDrag}
        onDragStart={(event) => event.preventDefault()}
      >
        {snapshot.candidates.map((candidate, index) => {
          const selected = candidate.item.id === selectedItemId
          const item = finalChoiceCandidateTitleItem(mode, candidate)
          return <ControlButton
            key={candidate.item.id}
            ref={(node) => { cardRefs.current[index] = node }}
            role="radio"
            aria-checked={selected}
            aria-label={finalChoiceCandidateLabel(candidate)}
            tabIndex={selectedIndex >= 0 ? (selected ? 0 : -1) : index === 0 ? 0 : -1}
            className={`final-choice-card${selected ? ' is-selected' : ''}`}
            disabled={pending}
            onClick={() => {
              if (suppressClickRef.current) return
              selectAt(index)
            }}
            onKeyDown={(event) => onCardKeyDown(event, index)}
          >
            <span className="final-choice-card__summary">
              <span className="final-choice-card__poster"><TitlePoster item={item} /></span>
              <span className="final-choice-card__identity">
                <strong>{candidate.item.titleRu}</strong>
                {candidate.item.titleOriginal && candidate.item.titleOriginal !== candidate.item.titleRu
                  ? <small>{candidate.item.titleOriginal}</small>
                  : null}
                <em>{candidate.primaryMeta}</em>
              </span>
            </span>
            <span className="final-choice-card__facts">
              {candidate.facts.map((fact) => <span title={fact.ariaLabel} key={fact.key}>{fact.value}</span>)}
            </span>
          </ControlButton>
        })}
      </div>
      <p id="final-choice-swipe-hint" className="final-choice-panel__swipe-hint">Листайте свайпом или перетаскивайте</p>

      {error && <InlineAlert tone="danger" className="final-choice-panel__error">{error}</InlineAlert>}
      <div className="final-choice-panel__actions">
        <ActionButton onClick={onSubmit} disabled={!selectedItemId || pending}>
          {pending ? 'Проверяем…' : 'Это мой ответ'}
        </ActionButton>
        <TextButton onClick={openReveal} disabled={pending}>Не знаю ни одного</TextButton>
      </div>
    </section>

    {revealOpen && <DialogSurface
      className="final-choice-dialog"
      backdropClassName="final-choice-dialog-backdrop"
      onClose={cancelReveal}
      ariaLabelledBy="final-choice-reveal-title"
      closeOnBackdrop={!pending}
    >
      <h2 id="final-choice-reveal-title">Открыть правильный ответ?</h2>
      <p>Финальная сверка завершится, вернуться к выбору уже не получится.</p>
      <div>
        <ActionButton variant="secondary" onClick={cancelReveal} disabled={pending}>Остаться и выбрать</ActionButton>
        <ActionButton variant="danger" onClick={confirmReveal} disabled={pending}>
          {pending ? 'Открываем…' : 'Открыть ответ'}
        </ActionButton>
      </div>
    </DialogSurface>}
  </>
}

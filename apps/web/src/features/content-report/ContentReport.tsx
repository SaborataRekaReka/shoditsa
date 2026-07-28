import { useState } from 'react'
import { trackClientEvent } from '../../app/client-events'
import { ControlButton, InlineAlert, TextArea, TextInput } from '../../components/ui'
import type { TitleMode } from '../../types'
import './ContentReport.css'

export const CONTENT_REPORT_REASONS = [
  ['wrong_fact', 'Неправильный факт'],
  ['disputed_comparison', 'Спорное сравнение'],
  ['title_not_found', 'Не находится название'],
  ['bad_hint', 'Плохая или слишком явная подсказка'],
  ['bad_image', 'Неверное или битое изображение'],
  ['duplicate_card', 'Дубликат карточки'],
  ['typo_or_translation', 'Опечатка или плохой перевод'],
  ['ambiguous_group', 'Неоднозначная группа'],
  ['wrong_group_title', 'Неверное название группы'],
  ['word_does_not_fit', 'Слово не подходит'],
  ['duplicate_word', 'Слово повторяется'],
  ['technical_error', 'Техническая ошибка'],
  ['other', 'Другое'],
] as const

export type ContentReportReason = typeof CONTENT_REPORT_REASONS[number][0]

const CONNECTIONS_ONLY_REASONS = new Set<ContentReportReason>([
  'ambiguous_group',
  'wrong_group_title',
  'word_does_not_fit',
  'duplicate_word',
])

export const contentReportReasonsForMode = (mode?: TitleMode | 'connections') => (
  mode === 'connections'
    ? CONTENT_REPORT_REASONS
    : CONTENT_REPORT_REASONS.filter(([reason]) => !CONNECTIONS_ONLY_REASONS.has(reason))
)

export function ContentReport({
  onSubmit,
  mode,
  prompt = 'Нашли ошибку в подсказке?',
  thanks = 'Спасибо, проверим подсказку.',
}: {
  onSubmit: (reason: ContentReportReason, comment: string) => void | Promise<void>
  mode?: TitleMode | 'connections'
  prompt?: string
  thanks?: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ContentReportReason>('wrong_fact')
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  if (sent) return <p className="content-report__thanks" role="status">{thanks}</p>
  return <div className="content-report">
    <ControlButton type="button" className="content-report__toggle" onClick={() => setOpen((value) => { if (!value) trackClientEvent('report_form_opened'); return !value })} aria-expanded={open}>{prompt}</ControlButton>
    {open && <form onSubmit={async (event) => {
      event.preventDefault()
      if (sending) return
      setSending(true)
      setError('')
      try {
        await onSubmit(reason, comment.trim())
        setSent(true)
      } catch (value) {
        trackClientEvent('report_submit_failed', { reason, message: value instanceof Error ? value.message.slice(0, 500) : 'unknown' })
        setError(value instanceof Error ? value.message : 'Не удалось отправить отчёт.')
      } finally {
        setSending(false)
      }
    }}>
      <fieldset>
        <legend>Что случилось?</legend>
        {contentReportReasonsForMode(mode).map(([value, label]) => <label key={value}>
          <TextInput type="radio" name="content-report-reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
          <span>{label}</span>
        </label>)}
      </fieldset>
      <TextArea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий — необязательно" maxLength={500} />
      {error && <InlineAlert tone="danger" className="server-error">{error}</InlineAlert>}
      <ControlButton type="submit" disabled={sending}>{sending ? 'Отправляем…' : 'Отправить'}</ControlButton>
    </form>}
  </div>
}

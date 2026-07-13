import { useState } from 'react'
import { trackClientEvent } from '../../app/client-events'

export const CONTENT_REPORT_REASONS = [
  ['wrong_fact', 'Неправильный факт'],
  ['disputed_comparison', 'Спорное сравнение'],
  ['title_not_found', 'Не находится название'],
  ['bad_hint', 'Плохая или слишком явная подсказка'],
  ['bad_image', 'Неверное или битое изображение'],
  ['duplicate_card', 'Дубликат карточки'],
  ['typo_or_translation', 'Опечатка или плохой перевод'],
  ['technical_error', 'Техническая ошибка'],
  ['other', 'Другое'],
] as const

export type ContentReportReason = typeof CONTENT_REPORT_REASONS[number][0]

export function ContentReport({ onSubmit }: { onSubmit: (reason: ContentReportReason, comment: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ContentReportReason>('wrong_fact')
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  if (sent) return <p className="content-report__thanks" role="status">Спасибо, проверим подсказку.</p>
  return <div className="content-report">
    <button type="button" className="content-report__toggle" onClick={() => setOpen((value) => { if (!value) trackClientEvent('report_form_opened'); return !value })} aria-expanded={open}>Нашли ошибку в подсказке?</button>
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
        {CONTENT_REPORT_REASONS.map(([value, label]) => <label key={value}>
          <input type="radio" name="content-report-reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
          <span>{label}</span>
        </label>)}
      </fieldset>
      <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий — необязательно" maxLength={500} />
      {error && <p className="server-error" role="alert">{error}</p>}
      <button type="submit" disabled={sending}>{sending ? 'Отправляем…' : 'Отправить'}</button>
    </form>}
  </div>
}

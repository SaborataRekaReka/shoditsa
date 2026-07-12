import { useState } from 'react'

export const CONTENT_REPORT_REASONS = [
  ['wrong_fact', 'Неправильный факт'],
  ['disputed_comparison', 'Спорное сравнение'],
  ['title_not_found', 'Не находится название'],
  ['bad_hint', 'Плохая или слишком явная подсказка'],
  ['other', 'Другое'],
] as const

export type ContentReportReason = typeof CONTENT_REPORT_REASONS[number][0]

export function ContentReport({ onSubmit }: { onSubmit: (reason: ContentReportReason, comment: string) => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ContentReportReason>('wrong_fact')
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)

  if (sent) return <p className="content-report__thanks" role="status">Спасибо, проверим подсказку.</p>
  return <div className="content-report">
    <button type="button" className="content-report__toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>Нашли ошибку в подсказке?</button>
    {open && <form onSubmit={(event) => { event.preventDefault(); onSubmit(reason, comment.trim()); setSent(true) }}>
      <fieldset>
        <legend>Что случилось?</legend>
        {CONTENT_REPORT_REASONS.map(([value, label]) => <label key={value}>
          <input type="radio" name="content-report-reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
          <span>{label}</span>
        </label>)}
      </fieldset>
      <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий — необязательно" maxLength={500} />
      <button type="submit">Отправить</button>
    </form>}
  </div>
}

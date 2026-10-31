import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink } from 'lucide-react'
import type { SvoyakMediaRecoveryReport } from '@shoditsa/contracts/svoyak'
import { request } from '../api'

const confidenceLabel = { high: 'Высокая', medium: 'Средняя', low: 'Низкая' }
const kindLabel = { image: 'Изображение', audio: 'Аудио', video: 'Видео' }
const csvCell = (value: unknown) => {
  let text = String(value ?? '')
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text
  return '"' + text.replace(/"/g, '""') + '"'
}
export function SvoyakMediaRecoveryPanel({ onOpenQuestion }: { onOpenQuestion: (id: string) => void }) {
  const [report, setReport] = useState<SvoyakMediaRecoveryReport | null>(null),
    [error, setError] = useState('')
  const [open, setOpen] = useState(new URLSearchParams(location.search).get('mediaRecovery') === 'unresolved'),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0)
  useEffect(() => {
    let active = true
    void request<SvoyakMediaRecoveryReport | null>('/admin/svoyak/library/media-recovery')
      .then((value) => {
        if (active) setReport(value)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Не удалось загрузить список')
      })
    return () => {
      active = false
    }
  }, [])
  const unresolved = useMemo(() => report?.items.filter((i) => i.status === 'unresolved') ?? [], [report])
  const filtered = useMemo(
    () =>
      unresolved.filter(
        (i) =>
          !query ||
          [
            i.questionId,
            i.packTitle,
            i.theme,
            i.prompt,
            i.reference,
            i.reason,
            i.context?.answerKey ?? '',
            i.context?.expectedContent ?? '',
          ]
            .join(' ')
            .toLocaleLowerCase('ru')
            .includes(query.toLocaleLowerCase('ru'))
      ),
    [unresolved, query]
  )
  const pages = Math.max(1, Math.ceil(filtered.length / 20)),
    safePage = Math.min(page, pages - 1)
  const download = () => {
    const rows = [
      [
        'Вопрос ID',
        'Пак',
        'Тема',
        'Условие',
        'Медиа',
        'Показ',
        'Исходная ссылка',
        'HTTP',
        'Причина',
        'Ожидаемое содержимое (вывод из контекста)',
        'Уверенность в назначении',
        'Ключ исходного вопроса',
        'Что неизвестно',
        'Подсказка для отдельной замены',
        'Дата проверки',
      ],
      ...unresolved.map((i) => [
        i.questionId,
        i.packTitle,
        i.theme,
        i.prompt,
        kindLabel[i.kind],
        i.phase === 'answer' ? 'После ответа' : 'В вопросе',
        i.reference,
        i.httpStatus,
        i.reason,
        i.context?.expectedContent ?? '',
        i.context ? confidenceLabel[i.context.confidence] : '',
        i.context?.answerKey ?? '',
        i.context?.unknowns ?? '',
        i.context?.replacementBrief ?? '',
        i.checkedAt,
      ]),
    ]
    const url = URL.createObjectURL(
        new Blob(['\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], {
          type: 'text/csv;charset=utf-8',
        })
      ),
      a = document.createElement('a')
    a.href = url
    a.download = 'svoyak-unresolved-media.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (error)
    return (
      <p className="svoyak-admin__error" role="alert">
        Список невосстановленных медиа: {error}
      </p>
    )
  if (!report) return null
  return (
    <section className="admin-panel svoyak-admin__recovery" aria-label="Невосстановленные медиа">
      <button className="admin-btn admin-btn--secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Не удалось восстановить медиа: {report.summary.unresolved}
      </button>
      {open && (
        <>
          <header>
            <div>
              <h2>Невосстановленные медиа</h2>
              <p>
                Проверено: {report.summary.total}. Восстановлено: {report.summary.recovered}. Не восстановлено:{' '}
                {report.summary.unresolved}.
              </p>
              <p>Проверка {new Date(report.checkedAt).toLocaleString('ru')}. Вопросы и их допуск к игре сохранены.</p>
              {report.contextualizedAt && (
                <p>Описания содержимого выведены из тем и ключей. Точные исходные файлы не установлены.</p>
              )}
            </div>
            <button className="admin-btn admin-btn--secondary" onClick={download}>
              <Download size={17} />
              Скачать CSV
            </button>
          </header>
          <label className="admin-field">
            <span>Поиск в невосстановленных медиа</span>
            <input
              value={query}
              placeholder="Пак, вопрос, ключ, ссылка или причина"
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(0)
              }}
            />
          </label>
          <p>
            Найдено вложений: {filtered.length}. Вопросов: {new Set(filtered.map((i) => i.questionId)).size}.
          </p>
          <div className="svoyak-admin__recovery-rows">
            {filtered.slice(safePage * 20, (safePage + 1) * 20).map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{item.packTitle}</strong>
                  <p>{item.theme}</p>
                  <p>{item.prompt || 'Условие задано медиа'}</p>
                  <small>{item.questionId}</small>
                  {item.context && (
                    <div className="svoyak-admin__recovery-context">
                      <strong>Что ожидалось по контексту</strong>
                      <p>{item.context.expectedContent}</p>
                      <p>
                        Уверенность в назначении: {confidenceLabel[item.context.confidence].toLocaleLowerCase('ru')}.
                        Оригинальный файл не установлен.
                      </p>
                      <details>
                        <summary>Основание и ограничения</summary>
                        <p>Ключ: {item.context.answerKey}</p>
                        <p>{item.context.basis}</p>
                        <p>{item.context.unknowns}</p>
                        <p>{item.context.replacementBrief}</p>
                      </details>
                    </div>
                  )}
                </div>
                <div>
                  <strong>{kindLabel[item.kind]}</strong>
                  <p>{item.phase === 'answer' ? 'После раскрытия ответа' : 'В вопросе'}</p>
                  <p className="svoyak-admin__recovery-reason">{item.reason}</p>
                  <a
                    href={/^https?:\/\//i.test(item.reference) ? item.reference : undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} />
                    {item.reference}
                  </a>
                </div>
                <button
                  className="admin-btn admin-btn--secondary"
                  onClick={() => {
                    onOpenQuestion(item.questionId)
                    setOpen(false)
                  }}
                >
                  Открыть вопрос
                </button>
              </article>
            ))}
          </div>
          {!filtered.length && <p>Невосстановленных медиа по этому запросу нет.</p>}
          <footer className="svoyak-admin__actions">
            <button
              className="admin-btn"
              aria-label="Предыдущая страница медиа"
              disabled={!safePage}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              {safePage + 1} / {pages}
            </span>
            <button
              className="admin-btn"
              aria-label="Следующая страница медиа"
              disabled={safePage + 1 >= pages}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </footer>
        </>
      )}
    </section>
  )
}

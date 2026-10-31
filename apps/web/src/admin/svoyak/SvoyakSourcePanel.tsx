import { useState } from 'react'
import type { EditableQuestion, SvoyakSourceQuestion } from '@shoditsa/contracts/svoyak'
import { request } from '../api'

export const questionSourceId = (id: string) => id.replace(/^(\d+):[a-f0-9]{8,64}:/, '$1:')
export const sourceStatusLabel = (status: string) =>
  ({
    approved: 'Принят в исходной редакции',
    needs_review: 'Нужна проверка',
    unreviewed: 'Не проверен',
    rejected: 'Отклонён',
    draft: 'Черновик',
  })[status] ?? status
const blockerLabels: Record<string, string> = {
  review_required: 'Нет редакторского допуска',
  incomplete_review: 'Не завершены проверки',
  missing_answer: 'Нет ответа',
  source_changed: 'Исходник изменился',
  standalone_text_adaptation_required: 'Нужна самостоятельная текстовая версия',
  external_or_missing_media: 'Есть недоступные медиа',
  media_technical_check_required: 'Нужна техническая проверка медиа',
  media_semantic_review_required: 'Нужно проверить содержание медиа',
}
const checks = [
  ['facts', 'Факты или задумка шутки'],
  ['clarity', 'Понятность и однозначность'],
  ['style', 'Формулировка и авторский стиль'],
  ['answers', 'Ответ и варианты зачёта'],
  ['category', 'Тема, жанр и сложность'],
  ['safety', 'Возраст и предупреждения'],
  ['duplicates', 'Дубли'],
  ['media', 'Медиа, звук и отсутствие спойлера'],
] as const

export function SvoyakSourcePanel({ source, id }: { source: SvoyakSourceQuestion; id: string }) {
  const [detail, setDetail] = useState<SvoyakSourceQuestion | null>(null),
    [error, setError] = useState('')
  const load = async () => {
    if (detail) return
    try {
      setDetail(await request<SvoyakSourceQuestion>('/admin/svoyak/library/source/' + encodeURIComponent(id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить историю')
    }
  }
  return (
    <section className="admin-panel svoyak-admin__source">
      <h2>Исходник и проверка</h2>
      <p>
        <strong>{sourceStatusLabel(source.reviewStatus)}</strong>
        <span>Редакция {source.revision}</span>
        <span>{source.media.length} медиа</span>
      </p>
      {source.blockers.length > 0 && (
        <div className="svoyak-admin__warning">
          <strong>Замечания исходной редакции</strong>
          {source.blockers.map((b) => (
            <p key={b}>{blockerLabels[b] ?? b}</p>
          ))}
        </div>
      )}
      {source.media.some((m) => m.status !== 'available') && (
        <div className="svoyak-admin__warning">
          <strong>Не все исходные медиа доступны</strong>
          <p>В превью показаны сохранённые файлы. Недоступные ссылки перечислены ниже и остаются в библиотеке.</p>
        </div>
      )}
      <details>
        <summary>Оригинал вопроса и медиа</summary>
        <h3>Условие</h3>
        <p className="svoyak-admin__original-text">{source.originalPrompt || 'В исходнике нет текстового условия.'}</p>
        <h3>Ответ</h3>
        <p className="svoyak-admin__original-text">{source.originalAnswer || 'В исходнике нет текстового ответа.'}</p>
        {source.originalMedia.map((m, i) => (
          <div key={i} className="svoyak-admin__source-media">
            <strong>
              {m.kind === 'image' ? 'Изображение' : m.kind === 'audio' ? 'Аудио' : 'Видео'},{' '}
              {m.phase === 'answer' ? 'после ответа' : 'в вопросе'}
            </strong>
            <span>{m.status === 'available' ? 'Файл сохранён' : 'Файл недоступен'}</span>
            {m.reference && <code>{m.reference}</code>}
            {m.url && (
              <a href={m.url} target="_blank" rel="noreferrer">
                Открыть оригинальный файл
              </a>
            )}
          </div>
        ))}
      </details>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open) void load()
        }}
      >
        <summary>Источники проверки и история редакции</summary>
        {error && <p role="alert">{error}</p>}
        {detail ? (
          <>
            <p>{detail.reviewNote}</p>
            <pre>
              {JSON.stringify(
                {
                  evidence: detail.evidence,
                  checks: detail.checks,
                  edition: detail.edition,
                  history: detail.history,
                  originalAtoms: detail.originalAtoms,
                },
                null,
                2
              )}
            </pre>
          </>
        ) : (
          <p role="status">Загружаем историю…</p>
        )}
      </details>
    </section>
  )
}

export function SvoyakAdmissionReview({
  question,
  onChange,
}: {
  question: EditableQuestion
  onChange: (review: NonNullable<EditableQuestion['review']>) => void
}) {
  const value = question.review ?? { checks: {}, textOnlyAdaptation: false, missingMediaResolved: false }
  return (
    <section className="svoyak-admin__review">
      <h2>Проверки перед допуском</h2>
      <p>
        Отмечайте только выполненные проверки. Просмотр карточки не допускает её к игре. Изменение содержания сбрасывает
        проверки и допуск.
      </p>
      <div className="svoyak-admin__field-grid">
        {checks.map(([id, label]) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={Boolean(value.checks[id])}
              onChange={(e) => onChange({ ...value, checks: { ...value.checks, [id]: e.target.checked } })}
            />
            {label}
          </label>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={value.textOnlyAdaptation}
          onChange={(e) => onChange({ ...value, textOnlyAdaptation: e.target.checked })}
        />
        Без медиа подготовлена самостоятельная текстовая версия
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.missingMediaResolved}
          onChange={(e) => onChange({ ...value, missingMediaResolved: e.target.checked })}
        />
        Недоступные исходные медиа заменены или больше не нужны условию
      </label>
    </section>
  )
}

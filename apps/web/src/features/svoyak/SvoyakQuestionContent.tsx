import { useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import type { ActiveQuestion } from '@shoditsa/contracts/svoyak'
import './question-content.css'

function Media({ item }: { item: NonNullable<ActiveQuestion['media']>[number] }) {
  const [failed, setFailed] = useState(false)
  return (
    <figure className="svoyak-question-media">
      {failed ? (
        <p role="alert">Не удалось загрузить медиа. Проверьте файл или ссылку.</p>
      ) : item.kind === 'image' ? (
        <img src={item.url} alt={item.caption || 'Изображение к вопросу'} onError={() => setFailed(true)} />
      ) : item.kind === 'audio' ? (
        <audio controls preload="metadata" src={item.url} onError={() => setFailed(true)} />
      ) : (
        <video controls playsInline preload="metadata" src={item.url} onError={() => setFailed(true)} />
      )}
      {item.caption && <figcaption>{item.caption}</figcaption>}
    </figure>
  )
}

/** Shared by the live room and the editorial preview. Answer media arrives only after resolution. */
export function SvoyakQuestionContent({ current, host = false }: { current: ActiveQuestion; host?: boolean }) {
  return (
    <section className="svoyak-question" aria-label="Вопрос игроку">
      <h2 className="svoyak-question__text" tabIndex={-1}>
        {current.prompt}
      </h2>
      {current.media
        ?.filter((m) => m.phase === 'question')
        .map((item, i) => (
          <Media key={`${item.url}:${i}`} item={item} />
        ))}
      {current.answer && (
        <div className={`svoyak-answer${current.phase !== 'resolved' ? ' svoyak-answer--private' : ''}`}>
          <span>
            {current.phase !== 'resolved' && <LockKeyhole size={14} />}
            {current.phase === 'resolved' ? 'Правильный ответ' : 'Ответ для ведущего'}
          </span>
          <strong>
            <span>{current.answer.text}</span>
          </strong>
          {current.phase === 'resolved' &&
            current.media
              ?.filter((m) => m.phase === 'answer')
              .map((item, i) => <Media key={`${item.url}:${i}`} item={item} />)}
          {host && (current.answer.aliases.length > 0 || current.answer.note) && (
            <details className="svoyak-answer__variants">
              <summary>Зачёт и примечание</summary>
              <p>{current.answer.aliases.join(', ')}</p>
              {current.answer.note && <p>{current.answer.note}</p>}
            </details>
          )}
        </div>
      )}
    </section>
  )
}

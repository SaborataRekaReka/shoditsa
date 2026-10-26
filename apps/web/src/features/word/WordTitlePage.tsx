import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Lightbulb, Infinity } from 'lucide-react'
import { useServerRuntime } from '../../hooks/use-server-runtime'
import { api } from '../../api/client'
import { ApplicationFrame } from '../application/ApplicationFrame'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { GameArtifactSeoDetails } from '../../components/seo-content/SeoContent'
import './word.css'

export default function WordTitlePage({ onNavigate }: { onNavigate: (href: string) => Promise<void> }) {
  const runtime = useServerRuntime()
  const date = runtime.meta?.moscowDate
  const [key] = useState(() => crypto.randomUUID())
  const start = useMutation({ mutationFn: () => api.start({ mode: 'word', kind: 'daily', period: 'all' }, key), onSuccess: async response => { await onNavigate(`/sessions/${response.session.id}`) } })
  return <ApplicationFrame pathname="/games/word"><main className="word-page" aria-labelledby="word-title"><section className="qg-card word-title word-hero"><span className="word-eyebrow">Новая загадка каждый день{date && <time dateTime={date}>{new Date(`${date}T12:00:00+03:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</time>}</span><h1 id="word-title">Угадай слово<br />по ассоциациям</h1><p>Что общего у моря, ветра и путешествия?<br />Проверяй слова и приближайся к ответу по смыслу.</p><div className="word-example" aria-label="Пример рангов, не сегодняшняя загадка"><span>облако <strong>1 284</strong></span><span>берег <strong>76</strong></span><span>волна <strong>12</strong></span></div><p className="word-muted">Пример. Меньше номер — ближе ответ. Твоя цель — № 1.</p><QuestButton disabled={!runtime.me || start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Открываем загадку…' : 'Играть в слово дня'}<ArrowRight size={19} /></QuestButton>{runtime.error && <p role="alert">Не удалось подключиться к игре. Обнови страницу.</p>}{start.error && <p role="alert">{start.error instanceof Error ? start.error.message : 'Не удалось открыть загадку. Попробуй ещё раз.'}</p>}<div className="word-title-features"><span><Infinity size={19} />Попытки без ограничений</span><span><Lightbulb size={19} />Три подсказки</span><a href="/archive?mode=word">Архив слов</a></div></section><GameArtifactSeoDetails mode="word" /></main></ApplicationFrame>
}

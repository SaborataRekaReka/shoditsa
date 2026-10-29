import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useServerRuntime } from '../../hooks/use-server-runtime'
import { api } from '../../api/client'
import { trackConfirmedServerStart } from '../../app/game-analytics'
import { trackMetrikaGoal } from '../../app/metrics'
import { ApplicationFrame } from '../application/ApplicationFrame'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { QuestTitleLayout } from '../../dev/quest-game/QuestTitleLayout'

export default function WordTitlePage({ onNavigate }: { onNavigate: (href: string) => Promise<void> }) {
  const runtime = useServerRuntime()
  const date = runtime.meta?.moscowDate
  const [key] = useState(() => crypto.randomUUID())
  const start = useMutation({ mutationFn: () => api.start({ mode: 'word', kind: 'daily', period: 'all' }, key), onSuccess: async response => {
    trackMetrikaGoal('start_session', { mode: 'word', period: 'all', kind: 'daily' })
    trackConfirmedServerStart(response.session.id, { mode: 'word', period: 'all', kind: 'daily', state: response.session.attemptsCount > 0 || response.session.status !== 'playing' ? 'resumed' : 'new' })
    await onNavigate(`/sessions/${response.session.id}`)
  } })
  return <ApplicationFrame pathname="/games/word"><main><QuestTitleLayout mode="word" date={date}>
    <div className="qt-launch qt-launch--single"><QuestButton id="qt-start" disabled={!runtime.me || start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Открываем загадку…' : 'Играть в слово дня'}<ArrowRight size={20} /></QuestButton></div>
    {runtime.error && <p role="alert">Не удалось подключиться к игре. Обнови страницу.</p>}
    {start.error && <p role="alert">{start.error instanceof Error ? start.error.message : 'Не удалось открыть загадку. Попробуй ещё раз.'}</p>}
  </QuestTitleLayout></main></ApplicationFrame>
}

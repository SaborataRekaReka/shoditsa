import { useEffect, useRef, type CSSProperties, type MouseEvent } from 'react'
import { BookOpen, CheckCircle2, HelpCircle, Home, Lightbulb } from 'lucide-react'
import type { GameCompletionType } from '@shoditsa/contracts'
import type { TitleMode } from '../../types'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { trackNextGameStart } from '../../app/game-analytics'
import { ControlButton } from '../../components/ui'
import { ResultActionBar } from '../result/ResultActionBar'
import { DanetkiRegistrationOffer } from './DanetkiRegistrationOffer'

const NEXT_MODE_PRIORITY = ['diagnosis', 'character', 'animal'] as const satisfies readonly TitleMode[]
const NEXT_MODE_LABEL: Record<(typeof NEXT_MODE_PRIORITY)[number], string> = {
  diagnosis: 'Угадайте диагноз',
  character: 'Угадайте персонажа',
  animal: 'Угадайте животное',
}

type Props = {
  status: 'won' | 'lost'
  completionType?: GameCompletionType | null
  questionCount: number
  questionWord: string
  hintLevel: number
  sessionId: string
  story: string
  completedModes?: readonly string[]
  onPlayNext: (mode: TitleMode) => void
  onHome: () => void
}

export function DanetkiResult({
  status,
  completionType,
  questionCount,
  questionWord,
  hintLevel,
  sessionId,
  story,
  completedModes = [],
  onPlayNext,
  onHome,
}: Props) {
  const viewTracked = useRef(false)
  const nextMode = NEXT_MODE_PRIORITY.find((mode) => !completedModes.includes(mode)) ?? NEXT_MODE_PRIORITY[0]
  const nextPresentation = MODE_PRESENTATION[nextMode]
  const alternateModes = NEXT_MODE_PRIORITY.filter((mode) => mode !== nextMode)
  const won = status === 'won'

  useEffect(() => {
    if (viewTracked.current) return
    viewTracked.current = true
    const payload = {
      mode: 'danetki',
      outcome: status,
      attempts: questionCount,
      completionType: completionType ?? 'standard',
      nextMode,
    }
    trackClientEvent('danetki_result_view', payload, { gameSessionId: sessionId })
    trackMetrikaGoal('danetki_result_view', payload)
  }, [completionType, nextMode, questionCount, sessionId, status])

  const playNext = (mode: TitleMode) => {
    const payload = { outcome: status, placement: 'result', story, questionCount }
    trackNextGameStart('danetki', mode, payload)
    trackClientEvent('danetki_cross_game_clicked', { fromMode: 'danetki', toMode: mode, ...payload }, { gameSessionId: sessionId })
    onPlayNext(mode)
  }

  const followLink = (event: MouseEvent<HTMLAnchorElement>, mode: TitleMode) => {
    event.preventDefault()
    playNext(mode)
  }

  return <section
    className={`danetki-outcome danetki-outcome--${status}`}
    aria-labelledby="danetki-outcome-title"
    aria-live="polite"
    style={{ '--result-next-color': nextPresentation.color } as CSSProperties}
  >
    <div className="danetki-outcome__hero">
      <span className="danetki-outcome__mark" aria-hidden="true"><CheckCircle2 /></span>
      <div className="danetki-outcome__copy">
        <span>{won ? 'Версия подтверждена' : completionType === 'answer_revealed' ? 'Вы сдались' : 'Разгадка открыта'}</span>
        <h2 id="danetki-outcome-title">Дело закрыто</h2>
        <p>{won ? 'Вы восстановили цепочку событий.' : completionType === 'answer_revealed' ? 'Расследование завершено по вашему решению.' : 'Расследование завершено.'} Полная разгадка сохранена в протоколе выше.</p>
      </div>
    </div>

    <section className="danetki-outcome__metrics" aria-label="Итоги расследования">
      <article><span aria-hidden="true"><HelpCircle /></span><div><strong>{questionCount}</strong><small>{questionWord}</small></div></article>
      <article><span aria-hidden="true"><Lightbulb /></span><div><strong>{hintLevel}/3</strong><small>{hintLevel > 0 ? 'подсказок открыто' : 'без подсказок'}</small></div></article>
      <article><span aria-hidden="true"><CheckCircle2 /></span><div><strong>{won ? 'Раскрыто' : 'Открыто'}</strong><small>итог дела</small></div></article>
    </section>

    <ResultActionBar
      nextLabel={`Играть дальше: ${NEXT_MODE_LABEL[nextMode]}`}
      nextDestination={NEXT_MODE_LABEL[nextMode]}
      nextArtworkUrl={nextPresentation.watermarkUrl}
      nextTicketNumber="СЕАНС"
      nextActionLabel="Играть"
      configureLabel=""
      copied={false}
      onNext={() => playNext(nextMode)}
      onConfigure={onHome}
      compactNext
      persistence={<DanetkiRegistrationOffer placement="result" sessionId={sessionId} questionCount={questionCount} story={story} />}
    />

    <nav className="danetki-outcome__alternatives" aria-label="Другие игры после данетки">
      <span>Или выберите другой маршрут</span>
      <div>
        {alternateModes.map((mode) => {
          const presentation = MODE_PRESENTATION[mode]
          const Icon = presentation.icon
          return <a href={`/games/${mode}`} key={mode} onClick={(event) => followLink(event, mode)}>
            <Icon aria-hidden="true" /><span><strong>{NEXT_MODE_LABEL[mode]}</strong><small>{presentation.description}</small></span>
          </a>
        })}
      </div>
    </nav>

    <div className="danetki-outcome__utility">
      <a href="/danetki"><BookOpen aria-hidden="true" /> Все данетки с ответами</a>
      <ControlButton type="button" onClick={onHome}><Home aria-hidden="true" /> Все игры</ControlButton>
    </div>
  </section>
}

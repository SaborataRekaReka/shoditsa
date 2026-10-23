import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { useEffect, useState } from 'react'
import { ArrowRight, CalendarDays } from 'lucide-react'
import { ActionButton } from '../../components/ui'
import { ReferenceIcon } from '../../components/ui/ReferenceIcon'
import { publicAssetUrl } from '../../app/public-asset'
import type { GameStatus, TitleMode } from '../../types'
import { ReferenceMatchSymbol } from './ReferenceMatchSymbol'
import './ReferenceGameSidebar.css'

const thematicRiddles: Record<TitleMode, string> = {
  movie: 'Я умею останавливать время,\nпереносить в другие миры\nи рассказывать целую жизнь\nза пару часов.\nКто я?',
  series: 'Моя история не заканчивается\nза один вечер.\nКаждое прощание обещает\nновую встречу.\nКто я?',
  anime: 'Я рождаюсь в рисунках,\nоживаю в звуках.\nМир — моя сцена,\nа эмоции — моё топливо.\nКто я?',
  game: 'Мои миры ждут твоего решения.\nЗдесь можно начать сначала,\nа каждый шаг\nменяет историю.\nКто я?',
  city: 'Во мне встречаются дороги,\nу каждой улицы — своя история.\nЯ стою на месте,\nно никогда не стою на месте.\nКто я?',
  music: 'Меня нельзя увидеть,\nно можно почувствовать.\nЯ живу между нотами\nи остаюсь в памяти.\nЧто я?',
  diagnosis: 'Я собираю детали,\nсопоставляю признаки\nи задаю новые вопросы,\nпока картина не станет ясной.\nЧто я делаю?',
  animal: 'Следы расскажут, где я был,\nа повадки — как я живу.\nУ каждого из нас\nсвоя роль в природе.\nКто я?',
  book: 'Со мной можно путешествовать,\nне выходя из дома.\nМежду двумя обложками\nпомещается целый мир.\nКто я?',
  character: 'Я живу в чужой истории,\nно у меня есть свой характер.\nТы помнишь мои поступки,\nдаже закрыв последнюю страницу.\nКто я?',
}

const MOSCOW_OFFSET = 3 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

function secondsUntilMoscowMidnight() {
  const now = Date.now()
  const midnight = (Math.floor((now + MOSCOW_OFFSET) / DAY) + 1) * DAY - MOSCOW_OFFSET
  return Math.ceil((midnight - now) / 1000)
}

function PuzzleCountdown() {
  const [remaining, setRemaining] = useState(secondsUntilMoscowMidnight)

  useEffect(() => {
    const update = () => setRemaining(secondsUntilMoscowMidnight())
    const interval = window.setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  const hours = Math.floor(remaining / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)
  const seconds = remaining % 60

  return <section className="reference-game-sidebar__countdown" aria-labelledby="reference-countdown-heading">
    <h2 id="reference-countdown-heading">До новой загадки</h2>
    <div className="reference-game-sidebar__countdown-row">
      <div className="reference-game-sidebar__timer" role="timer" aria-live="off" aria-label={`До новой загадки: ${hours} часов, ${minutes} минут, ${seconds} секунд`}>
        <CalendarDays className="reference-game-sidebar__timer-icon" size={34} aria-hidden="true" />
        {[{ value: hours, label: 'часов' }, { value: minutes, label: 'минут' }, { value: seconds, label: 'секунд' }].map(({ value, label }) => <span key={label} className="reference-game-sidebar__timer-unit" aria-hidden="true"><strong>{String(value).padStart(2, '0')}</strong><small>{label}</small></span>)}
      </div>
      <ThemedArtwork src={publicAssetUrl('images/home-doodle/sleeping-cat.webp')} className="reference-game-sidebar__sleeping-cat" width={124} height={110} loading="lazy" alt="" />
    </div>
    <p className="reference-game-sidebar__update-note">Новая загадка — в 00:00 МСК</p>
    <p className="reference-game-sidebar__speech">Хорошие истории<br />всегда ждут <span aria-hidden="true">♡</span></p>
  </section>
}

export function ReferenceGameSidebar({ mode, puzzleDate, status, attemptsCount, onContinue, onHome }: {
  mode: TitleMode
  puzzleDate: string
  status: GameStatus
  attemptsCount: number
  onContinue: () => void
  onHome: () => void
}) {
  const finished = status === 'won' || status === 'lost' || status === 'expired'
  const dateLabel = new Date(`${puzzleDate}T12:00:00+03:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

  return <aside className="reference-game-sidebar" aria-label="Подсказки и следующая загадка">
    <section className="reference-game-sidebar__riddle" aria-labelledby="reference-sidebar-riddle-heading">
      <div className="reference-game-sidebar__riddle-head"><h2 id="reference-sidebar-riddle-heading">Разминка для ума</h2><time dateTime={puzzleDate}>{dateLabel}</time></div>
      <p className="reference-game-sidebar__riddle-text">{thematicRiddles[mode]}</p>
      <ActionButton className="reference-game-sidebar__continue" onClick={finished ? onHome : onContinue}>
        {finished ? 'Выбрать другую игру' : attemptsCount > 0 ? 'Продолжай угадывать' : 'Попробовать угадать'}<ArrowRight size={22} aria-hidden="true" />
      </ActionButton>
      <p className="reference-game-sidebar__riddle-note">{finished ? 'Ещё одна игра — ещё одно открытие!' : 'Каждая попытка приближает к разгадке!'}</p>
      <span className="reference-game-sidebar__scribble" aria-hidden="true" />
    </section>

    <section className="reference-game-sidebar__legend" aria-labelledby="reference-sidebar-legend-heading">
      <h2 id="reference-sidebar-legend-heading">Как читать подсказки?</h2>
      <p>Цвет показывает, насколько признак совпадает с загаданным ответом.</p>
      <ul>
        <li><span className="reference-game-sidebar__legend-mark reference-game-sidebar__legend-mark--match"><ReferenceMatchSymbol kind="match" /></span><div><strong>Точное совпадение</strong><span>Этот признак полностью совпадает</span></div></li>
        <li><span className="reference-game-sidebar__legend-mark reference-game-sidebar__legend-mark--partial"><ReferenceMatchSymbol kind="partial" /></span><div><strong>Частичное совпадение</strong><span>Есть что-то общее</span></div></li>
        <li><span className="reference-game-sidebar__legend-mark reference-game-sidebar__legend-mark--miss"><ReferenceMatchSymbol kind="miss" /></span><div><strong>Не совпадает</strong><span>Этот признак отличается</span></div></li>
      </ul>
    </section>

    <PuzzleCountdown />
  </aside>
}

export function ReferenceGameCommunity({ onHome }: { onHome: () => void }) {
  return <section className="reference-game-community" aria-label="Продолжить играть">
    <p className="reference-game-community__script">Больше, чем<br />просто игры</p>
    <span className="reference-game-community__globe" aria-hidden="true"><ReferenceIcon name="globe" size={52} /></span>
    <p className="reference-game-community__copy">Маленькие открытия каждый день.<br />Проверь логику, интуицию и любопытство.</p>
    <ActionButton className="reference-game-community__action" onClick={onHome}>Выбрать игру<ArrowRight size={18} aria-hidden="true" /></ActionButton>
  </section>
}

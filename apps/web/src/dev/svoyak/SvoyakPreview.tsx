import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BellRing, Check, ChevronRight, Eye, LockKeyhole, X } from 'lucide-react'
import { PageBackline } from '../../components/ui/PageBackline'
import { publicAssetUrl } from '../../app/public-asset'
import { QuestButton, QuestCountdown, QuestDialog } from '../../components/ui/QuestPrimitives'
import { QuestionPriceButton } from '../../components/ui/QuestionPriceButton'
import { StudySidebar } from '../quest-game/StudySidebar'
import { StudyHeader } from '../quest-game/StudyHeader'
import { StudyRightSidebar } from '../quest-game/StudyRightSidebar'
import { StudyAccountWidget, StudyStreakWidget } from '../quest-game/StudySidebarWidgets'
import { StudyFooter, useStudyTheme } from '../quest-game/StudyTheme'
import { StudySettings } from '../quest-game/StudySettings'
import { StudyGlyph } from '../quest-game/ShoditsaPresentation'
import type { StudyView } from '../quest-game/navigation'
import fixture from './questions.json'

type Role = 'player' | 'host'
type Phase = 'board' | 'reading' | 'buzzed' | 'timeout' | 'resolved'
type Panel = 'rules' | 'settings' | null
type Question = { id: string; question: string; answer: string; accepted_answers: string[]; price: number }
type Theme = { title: string; description: string; art: string; questions: Question[] }

const themes = fixture.themes as Theme[]
const home = '/shoditsa-home.html?variant=a#home-games'
const people = [{ name: 'Миша', initial: 'М' }, { name: 'Лена', initial: 'Л' }, { name: 'Даня', initial: 'Д' }, { name: 'Аня', initial: 'А' }]
const initialPlayed = [themes[0].questions[1].id, themes[1].questions[0].id, themes[2].questions[1].id]
const reviewPreview = new URLSearchParams(location.search).get('screen') === 'review'
const answerPreview = new URLSearchParams(location.search).get('screen') === 'answer'
const questionPreview = new URLSearchParams(location.search).get('screen') === 'question'

function menuHref(view: StudyView) {
  return view === 'games' || view === 'play' ? home : `/shoditsa-title.html#${view}`
}

function Company({ scores, role, phase, rejected }: { scores: number[]; role: Role; phase: Phase; rejected: boolean }) {
  return <div className="svoyak-company" aria-label="Игроки и очки">
    {people.map((person, index) => <div className={`svoyak-person${index === 0 && (phase === 'board' || phase === 'buzzed' || phase === 'resolved') ? ' svoyak-person--current' : ''}`} key={person.name}>
      <span className={`svoyak-person__portrait svoyak-person__portrait--${index}`} aria-hidden="true">{person.initial}</span>
      <span className="svoyak-person__name"><strong>{person.name}</strong>{index === 0 && <small>{role === 'player' ? 'Вы' : phase === 'buzzed' ? 'Отвечает' : rejected ? 'Уже отвечал' : ''}</small>}</span>
      <strong className="svoyak-person__score">{scores[index].toLocaleString('ru-RU')}</strong>
    </div>)}
  </div>
}

export function SvoyakPreview() {
  useStudyTheme()
  const [role, setRole] = useState<Role>(() => new URLSearchParams(location.search).get('role') === 'host' ? 'host' : 'player')
  const [phase, setPhase] = useState<Phase>(questionPreview ? 'reading' : answerPreview ? 'resolved' : reviewPreview ? 'timeout' : 'board')
  const [selected, setSelected] = useState<{ question: Question; theme: Theme } | null>(questionPreview ? { theme: themes[1], question: themes[1].questions[2] } : answerPreview ? { theme: themes[1], question: themes[1].questions[1] } : reviewPreview ? { theme: themes[0], question: themes[0].questions[3] } : null)
  const [played, setPlayed] = useState(answerPreview ? [...initialPlayed, themes[1].questions[1].id] : initialPlayed)
  const [scores, setScores] = useState([answerPreview ? 1000 : 800, 600, 300, 200])
  const [remainingMs, setRemainingMs] = useState(reviewPreview ? 0 : 30_000)
  const [durationMs, setDurationMs] = useState(30_000)
  const [answerVisible, setAnswerVisible] = useState(reviewPreview)
  const [rejected, setRejected] = useState(false)
  const [result, setResult] = useState<{ correct: boolean; price: number } | null>(answerPreview ? { correct: true, price: 200 } : null)
  const [message, setMessage] = useState('')
  const [panel, setPanel] = useState<Panel>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const clickedCell = useRef<HTMLButtonElement | null>(null)
  const deadline = useRef(questionPreview ? Date.now() + 30_000 : 0)

  useEffect(() => {
    if (phase !== 'reading') return
    const update = () => {
      const next = Math.max(0, deadline.current - Date.now())
      setRemainingMs(next)
      if (next === 0) { setPhase('timeout'); setMessage('Приём ответов завершён. Ведущий может открыть ответ.') }
    }
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || role !== 'player' || phase !== 'reading' || rejected || panel) return
      if (event.target instanceof Element && event.target.closest('button, input, textarea, select, a, [contenteditable]')) return
      event.preventDefault(); buzz()
    }
    document.addEventListener('keydown', keyboard)
    return () => document.removeEventListener('keydown', keyboard)
  }, [phase, role, rejected, panel])

  function choose(theme: Theme, question: Question, element: HTMLButtonElement) {
    clickedCell.current = element
    deadline.current = Date.now() + 30_000
    setSelected({ theme, question }); setDurationMs(30_000); setRemainingMs(30_000); setPhase('reading'); setAnswerVisible(false); setRejected(false); setResult(null)
    setMessage(`Открыт вопрос: ${theme.title}, ${question.price} очков.`)
    requestAnimationFrame(() => heading.current?.focus())
  }
  function returnToBoard() {
    setPhase('board'); setSelected(null); setResult(null); setAnswerVisible(false)
    const url = new URL(location.href)
    url.searchParams.delete('screen')
    history.replaceState(history.state, '', `${url.pathname}${url.search}`)
    requestAnimationFrame(() => {
      if (clickedCell.current?.isConnected && !clickedCell.current.disabled) clickedCell.current.focus()
      else document.querySelector<HTMLButtonElement>('.question-price-button:not(:disabled)')?.focus()
    })
  }
  function buzz() {
    if (phase !== 'reading' || rejected || Date.now() >= deadline.current) return
    setRemainingMs(Math.max(0, deadline.current - Date.now()))
    setPhase('buzzed'); setMessage('Миша нажал первым и отвечает.')
  }
  function finish(correct: boolean | null) {
    if (!selected || phase === 'resolved') return
    const price = selected.question.price
    if (correct !== null) setScores(values => values.map((value, index) => index === 0 ? value + (correct ? price : -price) : value))
    if (correct === false) {
      setRejected(true); setAnswerVisible(false); setPhase('reading'); deadline.current = Date.now() + 15_000; setDurationMs(15_000); setRemainingMs(15_000)
      setMessage(`У Миши минус ${price}. Ответить могут остальные игроки.`)
      return
    }
    setPlayed(values => values.includes(selected.question.id) ? values : [...values, selected.question.id])
    setResult(correct === null ? null : { correct, price }); setPhase('resolved'); setAnswerVisible(true)
    setMessage(correct ? `Верно! Миша получает ${price} очков.` : 'Вопрос закрыт. Правильный ответ открыт всем.')
  }
  function changeRole(next: Role) {
    setRole(next)
    const url = new URL(location.href)
    if (next === 'host') url.searchParams.set('role', 'host'); else url.searchParams.delete('role')
    history.replaceState(history.state, '', `${url.pathname}${url.search}`)
  }
  const answerShown = selected && (phase === 'resolved' || (role === 'host' && answerVisible))
  const status = phase === 'buzzed' ? role === 'host' && answerVisible ? 'Оцените ответ Миши' : 'Миша отвечает'
      : phase === 'resolved' ? result ? `Верно! +${result.price}` : 'Никто не ответил'
        : phase === 'reading' && rejected ? 'Миша уже отвечал' : null
  const canBuzz = phase === 'reading' && role === 'player' && !rejected
  const showActions = phase !== 'board' && (status || role === 'host' || canBuzz)

  return <div className="qg-app svoyak-preview">
    <StudySidebar view="games" shoditsa homeHref="/shoditsa-home.html?variant=a" Glyph={StudyGlyph} hrefFor={menuHref} />
    <div className="qg-layout study-layout">
      <StudyHeader Glyph={StudyGlyph} onSettings={() => setPanel('settings')} />
      <main id="quest-main" className="qg-main svoyak-main">
        <PageBackline href={home} label="Все игры" />
        <section className={`qg-card svoyak-room svoyak-room--${phase}`} aria-label="Своя игра">
          <header className="svoyak-room__head">
            <div className="svoyak-room__title"><ThemedArtwork src={publicAssetUrl('images/home-doodle/svoyak.webp')} width="48" height="48" alt="" /><div><h1>Своя игра</h1><p>Вопросы с историей</p></div></div>
            <span className="svoyak-role">{role === 'host' && <LockKeyhole size={14} />}{role === 'host' ? 'Вы ведущий' : 'Вы игрок'}</span>
          </header>
          <div className="svoyak-stage">
            <div className="svoyak-stage__head"><div>{phase === 'board' ? <h2>Раунд 1</h2> : <><span>{selected?.theme.title}</span><strong>{selected?.question.price} очков</strong></>}</div>{phase === 'board' && <span className="svoyak-progress" aria-label={`Разыграно ${played.length} из 15 вопросов`}>{played.length} / 15</span>}</div>
            {phase !== 'board' && phase !== 'resolved' && <div className="svoyak-countdown"><QuestCountdown remainingMs={remainingMs} durationMs={durationMs} paused={phase === 'buzzed'} /></div>}
          {phase === 'board' ? <div className="svoyak-board" aria-label="Темы и стоимость вопросов">
            {themes.map((theme, index) => <div key={theme.title} className={`svoyak-board__row svoyak-board__row--${index}`}>
              <div className="svoyak-board__theme"><ThemedArtwork src={publicAssetUrl(`images/home-doodle/${theme.art}.webp`)} width="45" height="45" alt="" /><h2>{theme.title}</h2></div>
              {theme.questions.map(question => <QuestionPriceButton key={question.id} price={question.price} played={played.includes(question.id)} aria-label={`${theme.title}, ${question.price} очков${played.includes(question.id) ? ', уже разыгран' : ''}`} title={played.includes(question.id) ? 'Этот вопрос уже разыгран' : `Вопрос за ${question.price}`} onClick={event => choose(theme, question, event.currentTarget)} />)}
            </div>)}
          </div> : selected && <section className="svoyak-question" aria-labelledby="svoyak-question-text">
            <h2 id="svoyak-question-text" ref={heading} tabIndex={-1} className="svoyak-question__text">{selected.question.question}</h2>
            {answerShown && <div className={`svoyak-answer${phase !== 'resolved' ? ' svoyak-answer--private' : ''}`}><span>{phase !== 'resolved' && <LockKeyhole size={14} aria-hidden="true" />}{phase === 'resolved' ? 'Правильный ответ' : 'Ответ для ведущего'}</span><strong><span>{selected.question.answer}</span></strong>{role === 'host' && selected.question.accepted_answers.length > 0 && <details className="svoyak-answer__variants"><summary>Варианты ответа</summary><p>{selected.question.accepted_answers.join(', ')}</p></details>}</div>}
          </section>}
          </div>
          {showActions && <div className={`svoyak-actionbar${canBuzz ? ' svoyak-actionbar--buzzer' : ''}`}>
            {status && <div className={`svoyak-turn${phase === 'resolved' && result ? ' svoyak-turn--correct' : ''}`} role="status"><span className="svoyak-turn__icon" aria-hidden="true">{phase === 'resolved' ? <Check size={24} /> : <span>М</span>}</span><div><strong>{status}</strong>{phase === 'buzzed' && role === 'player' ? <small>Назовите ответ вслух</small> : null}</div></div>}
            <div className="svoyak-actions">
              {phase === 'resolved' ? <QuestButton onClick={returnToBoard}>К полю<ArrowRight size={20} /></QuestButton>
                  : role === 'player' ? canBuzz ? <QuestButton size="buzzer" aria-keyshortcuts="Space" onClick={buzz}><BellRing size={25} aria-hidden="true" /><span>Отвечаю!</span><kbd>Пробел</kbd></QuestButton> : null
                    : !answerVisible ? <QuestButton onClick={() => setAnswerVisible(true)}><Eye size={19} />Открыть ответ</QuestButton>
                      : phase === 'buzzed' ? <><QuestButton kind="outline" onClick={() => finish(false)}><X size={19} />Неверно</QuestButton><QuestButton onClick={() => finish(true)}><Check size={19} />Верно +{selected?.question.price}</QuestButton></>
                        : <QuestButton onClick={() => finish(null)}>Закрыть вопрос<ArrowRight size={20} /></QuestButton>}
            </div>
          </div>}
          <div className="svoyak-room__players" tabIndex={0} role="region" aria-label="Карточки игроков"><Company scores={scores} role={role} phase={phase} rejected={rejected} /></div>
        </section>
        <StudyFooter><a href={home}>Игры</a><QuestButton kind="footer" onClick={() => setPanel('rules')}>Правила</QuestButton><QuestButton kind="footer" onClick={() => changeRole(role === 'host' ? 'player' : 'host')}>{role === 'host' ? 'Экран игрока' : 'Пульт ведущего'}<ChevronRight size={14} /></QuestButton><span>Локальный просмотр</span></StudyFooter>
      </main>
      <StudyRightSidebar label="Серия и аккаунт">
        <StudyStreakWidget homeHref={home} />
        <StudyAccountWidget />
      </StudyRightSidebar>
    </div>
    {panel && <QuestDialog title={panel === 'settings' ? 'Настройки' : 'Как играть в «Свою игру»'} onClose={() => setPanel(null)} footer={panel === 'rules' ? <QuestButton onClick={() => setPanel(null)}>Понятно, играем!</QuestButton> : undefined}>
      {panel === 'settings' ? <StudySettings /> : <div className="svoyak-rules"><p>Выберите тему и стоимость. На размышление даётся 30 секунд.</p><p>Знаете ответ — нажмите «Отвечаю!» или пробел и ответьте вслух.</p><p>Ведущий принимает ответ. Верный приносит стоимость вопроса, неверный отнимает её. После ошибки ответить могут остальные.</p></div>}
    </QuestDialog>}
    <div className="qg-live" role="status" aria-live="polite">{message}</div>
  </div>
}

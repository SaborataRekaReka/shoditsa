import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { wordTemperature, type GameResponse, type GameSessionSnapshot, type WordActionBody, type WordGuess } from '@shoditsa/contracts'
import { ArrowLeft, ArrowUp, BookOpen, Check, CircleHelp, Lightbulb, MoreHorizontal, Share2 } from 'lucide-react'
import { api, ApiClientError, queryKeys } from '../../api/client'
import { AnchoredMenu } from '../../components/ui/AnchoredMenu'
import { QuestButton, QuestInput, QuestDialog } from '../../components/ui/QuestPrimitives'
import { copyText } from '../../game/sharing'
import { trackGameCompleteOnce } from '../../app/game-analytics'
import { trackMetrikaGoal } from '../../app/metrics'
import { StudyThemeToggle } from '../../dev/quest-game/StudyTheme'
import { sortedWordGuesses, wordCountLabel, wordRankTone, wordRankWidth } from './word-presentation'
import './word.css'

type Props = { sessionId: string; session: Extract<GameSessionSnapshot, { engine: 'semantic_word' }> }
function WordRank({ guess, vocabularySize, latest = false }: { guess: WordGuess; vocabularySize: number; latest?: boolean }) {
  return <div className={`word-rank-row word-rank-row--${wordRankTone(guess.rank)}${latest ? ' word-rank-row--latest' : ''}`} style={{ '--word-rank-width': `${wordRankWidth(guess.rank, vocabularySize)}%` } as CSSProperties}>
    <span className="word-rank-fill" aria-hidden="true" /><span className="word-rank-name">{guess.source === 'hint' && <Lightbulb size={15} aria-label="Подсказка" />}<strong>{guess.word}</strong>{guess.rank === 1 && <Check size={18} aria-label="Угадано" />}</span>
    <span className="word-rank-number" aria-label={`Место ${guess.rank}, ${wordTemperature(guess.rank)}`}>{guess.rank.toLocaleString('ru-RU')}</span>
  </div>
}

export function WordGamePage({ sessionId, session }: Props) {
  const client = useQueryClient()
  const state = session.word
  const [input, setInput] = useState('')
  const [message, setMessage] = useState('')
  const [visibleMessage, setVisibleMessage] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingRequest = useRef<{ signature: string; key: string } | null>(null)
  const terminal = state.status !== 'playing'
  const focusInput = () => inputRef.current?.focus({ preventScroll: true })
  useEffect(() => { if (!terminal && window.matchMedia('(pointer: fine)').matches) focusInput() }, [sessionId, terminal])
  const action = useMutation({
    mutationFn: (body: WordActionBody) => {
      const signature = JSON.stringify(body)
      if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, key: crypto.randomUUID() }
      return api.wordAction(sessionId, body, pendingRequest.current.key)
    },
    onSuccess: async response => {
      pendingRequest.current = null
      client.setQueryData<GameResponse>(queryKeys.game(sessionId), { session: response.session })
      setConfirm(false)
      const latest = response.session.word.guesses.at(-1)
      const analytics = { mode: 'word', kind: session.kind, period: 'all', attempts: response.session.attemptsCount }
      if (response.result === 'guess' || response.result === 'won') trackMetrikaGoal('submit_attempt', analytics)
      if (response.result === 'hint') trackMetrikaGoal('reveal_hint', { ...analytics, hintKey: 'semantic_closer', checkpoint: response.session.word.hintsUsed })
      setVisibleMessage(response.result === 'duplicate')
      setMessage(response.result === 'duplicate' ? 'Это слово уже проверено. Попытка не потрачена.' : response.result === 'hint' ? `Подсказка: ${latest?.word}, место ${latest?.rank}.` : response.result === 'won' ? 'Сходится! Ты нашёл слово.' : response.result === 'given_up' ? 'Ответ открыт.' : latest ? `${latest.word}: место ${latest.rank}. ${wordTemperature(latest.rank)}.` : '')
      focusInput()
      if (response.session.word.status !== 'playing') {
        trackGameCompleteOnce(sessionId, { ...analytics, outcome: response.session.word.status }, { serverSession: true })
        await Promise.all([client.invalidateQueries({ queryKey: queryKeys.dashboard }), client.invalidateQueries({ queryKey: ['archive'] }), client.invalidateQueries({ queryKey: queryKeys.ledger })])
      }
    },
    onError: async (error, body) => {
      setVisibleMessage(true)
      setMessage(error instanceof Error ? error.message : 'Не удалось проверить слово. Повтори попытку.')
      if (body.action === 'guess') setInput(draft => draft || body.word)
      if (error instanceof ApiClientError && error.status > 0 && error.status < 500) pendingRequest.current = null
      requestAnimationFrame(() => { focusInput(); if (body.action === 'guess' && inputRef.current?.value === body.word) inputRef.current.select() })
      await client.invalidateQueries({ queryKey: queryKeys.game(sessionId) })
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!input.trim() || action.isPending) return
    const word = input.trim()
    setInput('')
    setVisibleMessage(false)
    action.mutate({ action: 'guess', word })
    focusInput()
  }
  const rows = sortedWordGuesses(state.guesses)
  const latest = state.guesses.at(-1)
  const date = new Date(`${session.puzzleDate}T12:00:00+03:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  const share = async () => {
    const status = state.status === 'won' ? '🟩 Слово найдено' : state.status === 'lost' ? '⬜ Ответ открыт' : '🔎 Ищу слово'
    const text = `Сходится! Слово по смыслу\n${session.puzzleDate}\n${status}\nПопыток: ${state.attemptsCount}\nПодсказок: ${state.hintsUsed}\nhttps://shoditsa.ru/games/word`
    const copied = await copyText(text)
    if (copied) trackMetrikaGoal('share_copy', { mode: 'word', kind: session.kind, status: state.status })
    setVisibleMessage(true)
    setMessage(copied ? 'Результат скопирован без ответа.' : 'Не удалось скопировать результат.')
  }
  const closeRules = () => { setRulesOpen(false); requestAnimationFrame(focusInput) }
  return <main className="word-game" aria-labelledby="word-heading">
    <header className="word-game-heading"><a className="word-back" href="/" aria-label="Все игры"><ArrowLeft size={20} /></a><h1 id="word-heading">Слово по смыслу</h1>
      <AnchoredMenu label="Меню игры" resetKey={sessionId} trigger={({ expanded, toggle, triggerRef }) => <QuestButton ref={triggerRef} kind="icon" aria-label="Меню игры" aria-haspopup="listbox" aria-expanded={expanded} onClick={toggle}><MoreHorizontal size={24} /></QuestButton>}>
        {close => <><QuestButton kind="row" role="option" aria-selected={false} onClick={() => { close(); setRulesOpen(true) }}><CircleHelp size={19} />Правила игры</QuestButton><QuestButton kind="row" role="option" aria-selected={false} onClick={() => { close(); window.location.assign('/archive?mode=word') }}><BookOpen size={19} />Архив слов</QuestButton>{!terminal && <QuestButton kind="row" role="option" aria-selected={false} onClick={() => { close(); setConfirm(true) }}>Сдаться</QuestButton>}</>}
      </AnchoredMenu>
    </header>
    <div className="word-toolbar">
      <QuestButton kind="icon" aria-label="Поделиться результатом" title="Поделиться результатом" onClick={() => void share()}><Share2 size={20} /></QuestButton>
      <div className="word-game-meta"><time dateTime={session.puzzleDate}>{session.kind === 'archive' ? 'Архив, ' : ''}{date}</time><div><span>{wordCountLabel(state.attemptsCount, ['попытка', 'попытки', 'попыток'])}</span>{state.hintsUsed > 0 && <span>{wordCountLabel(state.hintsUsed, ['подсказка', 'подсказки', 'подсказок'])}</span>}</div></div>
      {!terminal ? <QuestButton kind="outline" size="compact" className="word-hint" aria-label={`Подсказка, осталось ${state.hintsRemaining}`} disabled={!state.hintAvailable || action.isPending} title={state.bestRank != null && state.bestRank <= 2 ? 'Ближе осталось только загаданное слово' : state.hintsRemaining ? `Осталось подсказок: ${state.hintsRemaining}` : 'Все три подсказки использованы'} onClick={() => action.mutate({ action: 'hint' })}><Lightbulb size={18} />Подсказка<span className="word-hint-count">{state.hintsRemaining}</span></QuestButton> : <span className="word-terminal-mark"><Check size={20} />{state.status === 'won' ? 'Разгадано' : 'Завершено'}</span>}
    </div>
    {terminal ? <section className="qg-card word-result" aria-labelledby="word-result-heading"><p>{state.status === 'won' ? 'Сходится!' : 'Ответ открыт'}</p><h2 id="word-result-heading">{state.answer}</h2><p>{wordCountLabel(state.attemptsCount, ['попытка', 'попытки', 'попыток'])}{state.hintsUsed ? `, ${wordCountLabel(state.hintsUsed, ['подсказка', 'подсказки', 'подсказок'])}` : ', без подсказок'}. Новое слово в 00:00 МСК.</p><div className="word-result-actions"><QuestButton onClick={() => void share()}>Поделиться</QuestButton><a href="/archive?mode=word">Другие дни</a></div></section> :
      <form className="word-entry" aria-label="Проверка слова" onSubmit={submit}><label className="word-sr-only" htmlFor="word-input">Твоя ассоциация</label><QuestInput ref={inputRef} id="word-input" value={input} maxLength={60} onChange={event => setInput(event.target.value)} placeholder="Введи слово" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" aria-describedby="word-input-help" aria-controls="word-history" /><QuestButton type="submit" kind="icon" className="word-submit" aria-label={action.isPending ? 'Проверяем слово' : 'Проверить слово'} disabled={!input.trim() || action.isPending} onMouseDown={event => event.preventDefault()}><ArrowUp size={23} /></QuestButton><span className="word-sr-only" id="word-input-help">Введи русское слово и нажми Enter. Чем меньше его номер, тем ближе ответ. Подсказка добавит более близкое слово.</span></form>}
    <p className={visibleMessage && message ? 'word-feedback' : 'word-sr-only'} role="status" aria-live="polite">{message}</p>
    {latest && !terminal && <section className="word-last" aria-label="Последнее слово"><WordRank guess={latest} vocabularySize={state.vocabularySize} latest /></section>}
    <section className="word-history" id="word-history" aria-label="Твои слова">{rows.length ? <><div className="word-history-caption"><span>Твои слова</span><span>Ближе к № 1</span></div><ol className="word-guesses">{rows.map(row => <li key={row.position} className="word-guess" aria-label={`${row.word}, место ${row.rank}${row.source === 'hint' ? ', подсказка' : ''}`}><WordRank guess={row} vocabularySize={state.vocabularySize} /></li>)}</ol></> : <div className="word-empty"><h2>Какое слово мы загадали?</h2><p>Начни с любого слова, например «море».<br />Чем меньше номер, тем ближе ответ по смыслу.</p><div className="word-example" aria-label="Пример, не сегодняшняя загадка"><span>облако <strong>1 284</strong></span><span>берег <strong>76</strong></span><span>волна <strong>12</strong></span></div><p>Твоя цель — № 1. Попытки не ограничены.</p></div>}</section>
    <div className="word-bottom"><QuestButton kind="text" size="compact" onClick={() => setRulesOpen(true)}><CircleHelp size={16} />Как играть</QuestButton><a href="/archive?mode=word">Архив слов</a>{!terminal && <QuestButton kind="text" size="compact" onClick={() => setConfirm(true)}>Сдаться</QuestButton>}<StudyThemeToggle /></div>
    {rulesOpen && <QuestDialog title="Как играть в «Слово по смыслу»" onClose={closeRules}><div className="word-rules"><p>Найди загаданное русское слово. Вводи ассоциации и нажимай Enter — поле останется готовым к следующему слову.</p><p><strong>Меньше номер — ближе ответ.</strong> Все {state.vocabularySize.toLocaleString('ru-RU')} слов ранжированы по смысловой близости. № 1 занимает ответ. Полоса помогает сравнивать ранги, а не показывает вероятность победы.</p><p>История отсортирована от близких слов к далёким. Последнее слово вынесено над списком, чтобы его было легко найти.</p><p>Попытки не ограничены. Три бесплатные подсказки доступны сразу: каждая добавляет более близкое слово и не раскрывает ответ. Повторный и неизвестный ввод попыткой не считается.</p><p>Новая общая загадка появляется каждый день в 00:00 МСК. Прогресс сохраняется после перезагрузки. В архиве можно выбрать другой день.</p><details><summary>О смысловой близости и словаре</summary><p>Модель сравнивает контексты из текстов. Поэтому рядом бывают синонимы, противоположности и слова одной темы. Ранг — игровой ориентир, а не оценка твоих знаний.</p><p>Семантические данные: <a href="https://github.com/natasha/navec" target="_blank" rel="noreferrer">Navec</a>. Словарь: <a href="https://github.com/rspeer/wordfreq" target="_blank" rel="noreferrer">wordfreq (CC BY-SA 4.0)</a> и <a href="https://opencorpora.org/" target="_blank" rel="noreferrer">OpenCorpora (CC BY-SA 3.0)</a>.</p></details></div></QuestDialog>}
    {confirm && <QuestDialog title="Открыть ответ?" onClose={() => { setConfirm(false); requestAnimationFrame(focusInput) }}><p>Партия завершится. Попытки сохранятся, а продолжить отгадывать это слово уже не получится.</p><div className="word-result-actions"><QuestButton kind="outline" onClick={() => { setConfirm(false); requestAnimationFrame(focusInput) }}>Продолжить игру</QuestButton><QuestButton disabled={action.isPending} onClick={() => action.mutate({ action: 'give_up' })}>Открыть ответ</QuestButton></div></QuestDialog>}
  </main>
}

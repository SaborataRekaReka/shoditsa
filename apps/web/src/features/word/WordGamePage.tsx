import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { wordTemperature, type GameResponse, type GameSessionSnapshot, type WordActionBody } from '@shoditsa/contracts'
import { ArrowLeft, BookOpen, Lightbulb, Send } from 'lucide-react'
import { api, ApiClientError, queryKeys } from '../../api/client'
import { QuestButton, QuestInput, QuestDialog } from '../../components/ui/QuestPrimitives'
import { copyText } from '../../game/sharing'
import { trackGameCompleteOnce } from '../../app/game-analytics'
import { trackMetrikaGoal } from '../../app/metrics'
import './word.css'

type Props = { sessionId: string; session: Extract<GameSessionSnapshot, { engine: 'semantic_word' }> }

export function WordGamePage({ sessionId, session }: Props) {
  const client = useQueryClient()
  const state = session.word
  const [input, setInput] = useState('')
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Retain the request identity until an uncertain network outcome is resolved.
  const pendingRequest = useRef<{ signature: string; key: string } | null>(null)
  const terminal = state.status !== 'playing'
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
      setInput('')
      const latest = response.session.word.guesses.at(-1)
      const analytics = { mode: 'word', kind: session.kind, period: 'all', attempts: response.session.attemptsCount }
      if (response.result === 'guess' || response.result === 'won') trackMetrikaGoal('submit_attempt', analytics)
      if (response.result === 'hint') trackMetrikaGoal('reveal_hint', { ...analytics, hintKey: 'semantic_closer', checkpoint: response.session.word.hintsUsed })
      setMessage(response.result === 'duplicate' ? 'Это слово уже проверено. Попытка не потрачена.' : response.result === 'hint' ? `Подсказка: ${latest?.word}, место ${latest?.rank}.` : response.result === 'won' ? 'Сходится! Ты нашёл слово.' : response.result === 'given_up' ? 'Ответ открыт. Завтра будет новое слово.' : latest ? `${latest.word}: место ${latest.rank}. ${wordTemperature(latest.rank)}.` : '')
      if (response.session.word.status !== 'playing') {
        trackGameCompleteOnce(sessionId, { ...analytics, outcome: response.session.word.status }, { serverSession: true })
        await Promise.all([client.invalidateQueries({ queryKey: queryKeys.dashboard }), client.invalidateQueries({ queryKey: ['archive'] }), client.invalidateQueries({ queryKey: queryKeys.ledger })])
      }
      inputRef.current?.focus()
    },
    onError: async error => {
      setMessage(error instanceof Error ? error.message : 'Не удалось проверить слово. Повтори попытку.')
      if (error instanceof ApiClientError && error.status > 0 && error.status < 500) pendingRequest.current = null
      await client.invalidateQueries({ queryKey: queryKeys.game(sessionId) })
    },
  })
  const submit = (event: FormEvent) => { event.preventDefault(); if (input.trim() && !action.isPending) action.mutate({ action: 'guess', word: input.trim() }) }
  const attemptNumbers = new Map(state.guesses.filter(row => row.source === 'guess').map((row, index) => [row.position, index + 1]))
  const rows = [...state.guesses].sort((a, b) => a.rank - b.rank)
  const date = new Date(`${session.puzzleDate}T12:00:00+03:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const share = async () => {
    const text = `Сходится! Слово по смыслу\n${session.puzzleDate}\n${state.status === 'won' ? '🟩 Слово найдено' : '⬜ Ответ открыт'}\nПопыток: ${state.attemptsCount}\nПодсказок: ${state.hintsUsed}\nhttps://shoditsa.ru/games/word`
    const copied = await copyText(text)
    if (copied) trackMetrikaGoal('share_copy', { mode: 'word', kind: session.kind, status: state.status })
    setMessage(copied ? 'Результат скопирован без ответа.' : 'Не удалось скопировать результат.')
  }
  return <main className="word-page" aria-labelledby="word-heading">
    <a className="word-back" href="/games/word"><ArrowLeft size={18} />К игре</a>
    <section className="qg-card word-hero">
      <div className="word-eyebrow">Ежедневная загадка <time dateTime={session.puzzleDate}>{date}</time></div>
      <h1 id="word-heading">Слово по смыслу</h1>
      <p>Ищи ассоциации. Чем меньше номер, тем ближе ты к ответу.</p>
      <div className="word-metrics"><span>Попыток <strong>{state.attemptsCount}</strong></span><span>Лучшее место <strong>{state.bestRank ?? '—'}</strong></span><span>Лимита попыток нет</span></div>
    </section>
    {terminal ? <section className="qg-card word-result" aria-labelledby="word-result-heading">
      <p>{state.status === 'won' ? 'Сходится!' : 'Ответ на сегодня'}</p>
      <h2 id="word-result-heading">{state.answer}</h2>
      <p>{state.status === 'won' ? 'Ты нашёл загаданное слово.' : 'Эта партия завершена. Попытки сохранены.'} Новая загадка в 00:00 МСК.</p>
      <div className="word-actions"><QuestButton onClick={() => void share()}>Поделиться результатом</QuestButton><a href="/archive?mode=word">Открыть архив</a><a href="/">Другие игры</a></div>
    </section> : <section className="qg-card word-entry" aria-label="Проверка слова">
      <form onSubmit={submit}>
        <label htmlFor="word-input">Твоя ассоциация</label>
        <div className="word-input-row"><QuestInput ref={inputRef} id="word-input" value={input} maxLength={60} onChange={event => setInput(event.target.value)} placeholder="Например, море" autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={action.isPending} aria-describedby="word-input-help" /><QuestButton type="submit" disabled={!input.trim() || action.isPending}><Send size={18} />{action.isPending ? 'Проверяем…' : 'Проверить'}</QuestButton></div>
        <p id="word-input-help">Пиши одно русское слово в начальной форме.</p>
      </form>
      <div className="word-actions"><QuestButton kind="outline" disabled={!state.hintAvailable || action.isPending} onClick={() => action.mutate({ action: 'hint' })}><Lightbulb size={18} />Подсказка ({state.hintsRemaining})</QuestButton><QuestButton kind="text" disabled={action.isPending} onClick={() => setConfirm(true)}>Сдаться</QuestButton></div>
      {!state.hintAvailable && state.nextHintAt != null && <p className="word-muted">Следующая подсказка после {state.nextHintAt} попыток.</p>}
      {state.bestRank === 2 && <p className="word-muted">Ближе осталось только загаданное слово.</p>}
    </section>}
    <p className="word-feedback" role="status" aria-live="polite">{message}</p>
    <section className="qg-card word-history" aria-labelledby="word-history-heading"><h2 id="word-history-heading">Твои слова</h2><p className="word-muted">От близких к далёким. № 1 — загаданное слово.</p>
      {rows.length ? <ol className="word-guesses">{rows.map(row => <li key={row.position} className={row.rank <= 100 ? 'word-guess word-guess--hot' : 'word-guess'}><span className="word-guess-index">{row.source === 'hint' ? <Lightbulb size={16} aria-label="Подсказка" /> : attemptNumbers.get(row.position)}</span><strong>{row.word}</strong><span className="word-temperature">{wordTemperature(row.rank)}</span><span className="word-rank">{row.rank.toLocaleString('ru-RU')}</span></li>)}</ol> : <div className="word-empty"><BookOpen size={28} /><p>Начни с любого знакомого слова.<br />Его номер подскажет направление поиска.</p></div>}
    </section>
    <details className="qg-card word-rules"><summary>Как работает смысловая близость</summary><p>В словаре {state.vocabularySize.toLocaleString('ru-RU')} слов. Модель сравнивает контексты, в которых они встречались в текстах. Поэтому рядом могут оказаться синонимы, противоположности и слова одной темы.</p><p>Ранг показывает место слова в этом словаре. Это не процент совпадения и не оценка твоих знаний. Повторный и неизвестный ввод не увеличивает число попыток.</p><p>Три бесплатные подсказки открываются после 5, 10 и 15 попыток. Они дают более близкое слово и не раскрывают ответ.</p><p>Семантические данные: <a href="https://github.com/natasha/navec" target="_blank" rel="noreferrer">Navec</a>. Словарь и частоты: <a href="https://github.com/rspeer/wordfreq" target="_blank" rel="noreferrer">wordfreq (CC BY-SA 4.0)</a>, <a href="https://opencorpora.org/" target="_blank" rel="noreferrer">OpenCorpora (CC BY-SA 3.0)</a>. Игровая выборка и ранги подготовлены для «Сходится!».</p></details>
    {confirm && <QuestDialog title="Открыть ответ?" onClose={() => setConfirm(false)}><p>Партия завершится. Продолжить отгадывать это слово уже не получится.</p><div className="word-actions"><QuestButton kind="outline" onClick={() => setConfirm(false)}>Продолжить игру</QuestButton><QuestButton disabled={action.isPending} onClick={() => action.mutate({ action: 'give_up' })}>Открыть ответ</QuestButton></div></QuestDialog>}
  </main>
}

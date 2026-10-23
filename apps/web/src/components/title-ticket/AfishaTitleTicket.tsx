import type { CSSProperties, ReactNode } from 'react'
import { CalendarDays, Check, CircleHelp, Search, Ticket } from 'lucide-react'
import { AdmissionTitleTicket, TicketKicker } from './TitleTicket'
import { MODE_CONFIG } from '../../app/mode-config'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import type { TitleMode } from '../../types'
import './AfishaTitleTicket.css'

const criteria: Record<TitleMode, string[]> = {
  movie: ['Год', 'Жанры', 'Актёры', 'Страна', 'Рейтинг'],
  series: ['Период', 'Жанры', 'Создатели', 'Актёры', 'Рейтинг'],
  anime: ['Формат', 'Студия', 'Эпизоды', 'Сэйю', 'Рейтинг'],
  game: ['Год', 'Жанры', 'Категории', 'Место в топе', 'Рейтинг'],
  city: ['Страна', 'Континент', 'Население', 'Языки', 'Часовой пояс'],
  music: ['Страна', 'Дебют', 'Жанры', 'Тип артиста', 'Карьера'],
  diagnosis: ['Симптомы', 'Система органов', 'Диагностика', 'Код МКБ'],
  animal: ['Класс', 'Среда', 'Ареал', 'Питание', 'Размер'],
  book: ['Автор', 'Год', 'Жанры', 'Страна', 'Экранизации'],
  character: ['Эпоха', 'Источник', 'Природа', 'Роль', 'Способности'],
}

export function AfishaTitleTicket({ mode, date, posterUrl, dayNumber, launchControls, details, extra }: {
  mode: TitleMode
  date: string
  posterUrl: string
  dayNumber: number
  launchControls: ReactNode
  details: ReactNode
  extra?: ReactNode
}) {
  const meta = MODE_CONFIG[mode]
  const Icon = MODE_PRESENTATION[mode].icon
  const style = { '--afisha-mode': MODE_PRESENTATION[mode].color } as CSSProperties
  const dateLabel = new Date(`${date}T12:00:00+03:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

  return <div className="afisha-title" style={style}>
    <div className="afisha-title__edition"><span><Icon size={16} aria-hidden="true" /> {meta.plural}, сеанс № {dayNumber}</span><time dateTime={date}><CalendarDays size={15} aria-hidden="true" /> {dateLabel}</time></div>
    <AdmissionTitleTicket
      id={`afisha-ticket-${mode}`}
      mode={mode}
      className="afisha-title__ticket"
      posterUrl={posterUrl}
      stubLabel="СХОДИТСЯ!"
      stubTitle={meta.plural.toLocaleUpperCase('ru-RU')}
      stubMeta="БИЛЕТ НА ОДНО ОТКРЫТИЕ"
      stubEnd={dateLabel}
      details={details}
    >
      <TicketKicker title="Загадка дня" detail="Вход свободный" />
      <h1 id={`afisha-ticket-${mode}`}>Угадайте {meta.subject} <span>дня</span></h1>
      <p className="afisha-title__lead">Один ответ скрывается среди знакомых названий.<br />Найдите его за десять попыток — подсказки помогут.</p>
      <div className="afisha-title__criteria"><span>Каждый ответ сравнит</span><div>{criteria[mode].map((label) => <span key={label}>{label}</span>)}</div></div>
      {extra}
      {launchControls}
      <div className="afisha-title__footnote"><Check size={14} aria-hidden="true" /><span>Новая загадка каждый день, прогресс сохраняется</span></div>
    </AdmissionTitleTicket>
    <div className="afisha-title__guide" aria-label="Краткие правила">
      <article><Search aria-hidden="true" /><div><strong>Начните с любого ответа</strong><span>Знакомое название — хорошая первая догадка.</span></div></article>
      <article><CircleHelp aria-hidden="true" /><div><strong>Смотрите на совпадения</strong><span>Зелёный — совпало. Янтарный — близко.</span></div></article>
      <article><Ticket aria-hidden="true" /><div><strong>Завершите сеанс</strong><span>Получите билетики и откройте следующую тему.</span></div></article>
    </div>
  </div>
}

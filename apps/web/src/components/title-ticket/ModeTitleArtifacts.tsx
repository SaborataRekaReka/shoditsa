import type { ReactNode } from 'react'
import { ChevronRight, Music2, UserRound } from 'lucide-react'
import { ControlButton } from '../ui'
import './TitleArtifacts.css'

export function DiagnosisTitleCard({
  id,
  posterUrl,
  dayNumber,
  dateLabel,
  hasAnamnesis,
  onReadAnamnesis,
  launchControls,
  details,
}: {
  id: string
  posterUrl: string
  dayNumber: number
  dateLabel: string
  hasAnamnesis: boolean
  onReadAnamnesis: () => void
  launchControls: ReactNode
  details?: ReactNode
}) {
  return <section className="med-chart med-chart--dossier" aria-labelledby={id}>
    <div className="med-chart__stub med-chart__stub--poster" aria-hidden="true">
      <img className="med-chart__stub-art" src={posterUrl} alt="" decoding="async" />
      <span className="med-chart__cross"><i /><i /></span>
      <span>ПРИЁМ</span><strong>ОТКРЫТ</strong><small>Карта № {dayNumber}</small><em>{dateLabel}</em>
      <svg className="med-chart__pulse" viewBox="0 0 120 28" preserveAspectRatio="none">
        <path d="M0 14 H30 L37 14 L42 4 L49 24 L55 14 L61 9 L66 14 H120" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
    <div className="med-chart__body">
      <div className="med-chart__kicker"><span>Амбулаторная карта</span><i /> <small>анонимный пациент</small></div>
      <h2 id={id}>Игра «Угадай диагноз»</h2>
      <p>Угадайте болезнь по симптомам и поставьте игровой диагноз за <strong>10 попыток</strong>. Новый пациент каждый день.</p>
      {hasAnamnesis && <ControlButton className="med-chart__anamnesis" onClick={onReadAnamnesis}>
        <span className="med-chart__anamnesis-portrait" aria-hidden="true"><UserRound /></span>
        <span className="med-chart__anamnesis-copy"><strong>Анамнез пациента</strong><small>С чем пациент пришёл на приём</small></span>
        <ChevronRight aria-hidden="true" />
      </ControlButton>}
      {launchControls}
    </div>
    {details}
  </section>
}

export function MusicTitleTicket({
  id,
  posterUrl,
  dayNumber,
  dateLabel,
  launchControls,
  details,
}: {
  id: string
  posterUrl: string
  dayNumber: number
  dateLabel: string
  launchControls: ReactNode
  details?: ReactNode
}) {
  return <section className="concert-ticket concert-ticket--dossier" aria-labelledby={id}>
    <div className="concert-ticket__stub concert-ticket__stub--poster" aria-hidden="true">
      <img className="concert-ticket__stub-art" src={posterUrl} alt="" decoding="async" />
      <span className="concert-ticket__stub-kicker">Концерт дня</span>
      <strong>Артист дня</strong>
      <small>Главная сцена</small>
      <em>{dateLabel} · 21:45</em>
      <span className="concert-ticket__stub-no">№ {dayNumber}</span>
      <div className="concert-ticket__barcode concert-ticket__barcode--v" />
    </div>
    <div className="concert-ticket__main">
      <div className="concert-ticket__head">
        <div className="concert-ticket__brand">
          <span className="concert-ticket__kicker"><Music2 /> Концерт дня</span>
          <h2 id={id}>Игра «Угадай исполнителя»</h2>
          <p className="concert-ticket__venue">Главная сцена · сеанс №{dayNumber}</p>
        </div>
        <div className="concert-ticket__when"><strong>{dateLabel}</strong><small>21:45</small></div>
      </div>
      <p className="concert-ticket__lead">Каждый ответ сравнит страну, эпоху, формат и жанры. После пятой и восьмой попыток можно открыть известную песню, историю артиста или другой музыкальный факт.</p>
      <div className="concert-ticket__meta" aria-hidden="true">
        <span><i>GATE</i><b>10</b></span>
        <span><i>SEAT</i><b>A15</b></span>
        <span><i>ROW</i><b>07</b></span>
      </div>
      <div className="concert-ticket__barcode" aria-hidden="true" />
      {launchControls}
    </div>
    {details}
  </section>
}

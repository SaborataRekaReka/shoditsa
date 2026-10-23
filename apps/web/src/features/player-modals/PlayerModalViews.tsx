import { Check, HeartPulse, Minus, Stethoscope, Ticket, UserRound, X } from 'lucide-react'
import type { GameSessionSnapshot } from '@shoditsa/contracts'
import { MODE_CONFIG } from '../../app/mode-config'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import { GAME_RULES } from '../../app/seo-content'
import { ActionButton } from '../../components/app-shell/AppShell'
import { APPLICATION_DESIGN } from '../../app/application-design'
import { GameArtwork } from '../../components/ui/GameArtwork'
import { QuestButton, QuestDialog } from '../../components/ui/QuestPrimitives'
import { ControlButton, DialogSurface, DialogTitle, IconButton, StatsGrid } from '../../components/ui'
import { DIFFICULTIES, PERIODS, prettyDate } from '../../game'
import { dayNumber } from '../../game/day-number'
import { nextStreakMilestoneAt, nextStreakMilestoneReward } from '../economy/economy-rules'
import { toLegacyAttendance, toLegacyWallet } from '../server-runtime/adapters'
import { SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'
import { loadAttendanceStats, loadStats, loadWallet } from '../../storage'
import type { DifficultyKey, SavedGame, Stats, TitleMode } from '../../types'
import './PlayerModalViews.css'
import './AnamnesisDialog.css'

const modeMeta = (mode: TitleMode) => MODE_CONFIG[mode]
const modeIcon = (mode: TitleMode) => { const Icon = MODE_PRESENTATION[mode].icon; return <Icon /> }

export function EconomyAwardPanel({ award }: { award: { total: number; alreadyClaimed: boolean } }) {
  if (award.alreadyClaimed) {
    return <div className="ticket-award ticket-award--claimed">
      <Ticket />
      <span>Билеты уже начислены</span>
    </div>
  }

  return <div className="ticket-award">
    <Ticket />
    <strong>+{award.total}</strong>
  </div>
}

export function AnamnesisModal({ text, dayNo, onClose, onStart }: {
  text: string
  dayNo: number
  onClose: () => void
  onStart?: () => void
}) {
  if (APPLICATION_DESIGN) return <QuestDialog title={`Приём № ${dayNo}`} description="Амбулаторная карта, Анамнез" onClose={onClose}>
    <div className="study-anamnesis">
      <div className="study-anamnesis__patient">
        <GameArtwork mode="diagnosis" alt="" width="52" height="52" />
        <div><strong>Анонимный пациент</strong><span>Жалобы записаны со слов пациента</span></div>
      </div>
      <p className="study-anamnesis__text">{text}</p>
      <div className="study-anamnesis__note"><HeartPulse size={20} aria-hidden="true" /><span>Поставьте верный диагноз по симптомам за десять попыток.</span></div>
      <div className="study-anamnesis__actions"><QuestButton onClick={onStart ?? onClose}>{onStart ? <Stethoscope size={20} aria-hidden="true" /> : <Check size={20} aria-hidden="true" />}{onStart ? 'Взяться за дело' : 'Понятно'}</QuestButton></div>
    </div>
  </QuestDialog>
  return <DialogSurface backdropClassName="anamnesis-backdrop" className="anamnesis-modal" onClose={onClose} ariaLabelledBy="anamnesis-title">
      <div className="anamnesis-modal__head">
        <span><Stethoscope /> Амбулаторная карта, Анамнез</span>
        <IconButton onClick={onClose} label="Закрыть"><X /></IconButton>
      </div>
      <div className="anamnesis-modal__patient">
        <span className="anamnesis-modal__avatar" aria-hidden="true"><UserRound /></span>
        <div className="anamnesis-modal__patient-copy">
          <small>Анонимный пациент</small>
          <DialogTitle id="anamnesis-title">Приём № {dayNo}</DialogTitle>
          <em>Жалобы записаны со слов пациента</em>
        </div>
      </div>
      <p className="anamnesis-modal__text">{text}</p>
      <div className="anamnesis-modal__note"><HeartPulse /> Поставьте верный диагноз по симптомам за десять попыток.</div>
      <div className="anamnesis-modal__actions">
        {onStart
          ? <ActionButton className="anamnesis-modal__start" onClick={onStart}><Stethoscope /> Взяться за дело</ActionButton>
          : <ActionButton className="anamnesis-modal__start" onClick={onClose}><Check /> Понятно</ActionButton>}
      </div>
  </DialogSurface>
}


export function StatsView({ mode, difficulty }: { mode: TitleMode; difficulty?: DifficultyKey }) {
  const serverRuntime = useServerRuntime()
  const serverStats = serverRuntime.dashboard?.stats.find((entry) => entry.mode === mode && entry.difficultyKey === (mode === 'music' ? difficulty ?? 'medium' : '-'))
  const stats: Stats = SERVER_RUNTIME
    ? {
        played: serverStats?.played ?? 0,
        won: serverStats?.won ?? 0,
        currentStreak: serverStats?.currentStreak ?? 0,
        bestStreak: serverStats?.bestStreak ?? 0,
        distribution: serverStats?.distribution ?? Array.from({ length: 10 }, () => 0),
      }
    : loadStats(mode, mode === 'music' ? difficulty : undefined)
  const attendance = SERVER_RUNTIME ? toLegacyAttendance(serverRuntime.dashboard?.attendance) : loadAttendanceStats()
  const wallet = SERVER_RUNTIME ? toLegacyWallet(serverRuntime.dashboard) : loadWallet()
  const rate = stats.played ? Math.round(stats.won / stats.played * 100) : 0
  const max = Math.max(1, ...stats.distribution)
  return <>
    <StatsGrid variant="economy">
      <div><strong>{wallet.tickets}</strong><span>билетов</span></div>
      <div><strong>{attendance.currentDailyStreak}</strong><span>абонемент</span></div>
      <div><strong>+{nextStreakMilestoneReward(attendance.currentDailyStreak, serverRuntime.dashboard?.economyRules)}</strong><span>на {nextStreakMilestoneAt(attendance.currentDailyStreak)}-й день</span></div>
      <div><strong>{attendance.gracePasses}</strong><span>контрамарки</span></div>
    </StatsGrid>
    <h3 className="subheading">Статистика темы</h3>
    {mode === 'music' && difficulty && <p className="modal-lead">Сложность: <strong>{DIFFICULTIES[difficulty].label}</strong></p>}
    <StatsGrid>
      <div><strong>{stats.played}</strong><span>сеансов</span></div>
      <div><strong>{rate}%</strong><span>побед</span></div>
      <div><strong>{stats.currentStreak}</strong><span>серия побед</span></div>
      <div><strong>{stats.bestStreak}</strong><span>рекорд побед</span></div>
    </StatsGrid>
    <div className="attendance-line">
      <span>Активных дней: <strong>{attendance.totalActiveDays}</strong></span>
      <span>Полных залов: <strong>{attendance.fullHouseDays}</strong></span>
      <span>Рекорд абонемента: <strong>{attendance.bestDailyStreak}</strong></span>
    </div>
    <h3 className="subheading">Победы по попыткам</h3>
    <div className="distribution">{stats.distribution.map((count, index) => <div key={index}><span>{index + 1}</span><i style={{ width: `${Math.max(6, count / max * 100)}%` }}>{count}</i></div>)}</div>
  </>
}

export function RulesView({ mode }: { mode?: GameSessionSnapshot['mode'] } = {}) {
  if (mode === 'connections') return <div className="rules-list">
    <p><strong>Связи</strong> — найди четыре группы по четыре слова среди шестнадцати карточек.</p>
    <p>{GAME_RULES.connections.searchInstruction}</p>
    <p>{GAME_RULES.connections.comparisonInstruction}</p>
    <p>{GAME_RULES.connections.directionInstruction}</p>
    {GAME_RULES.connections.modeNote && <p>{GAME_RULES.connections.modeNote}</p>}
  </div>
  if (mode === 'danetki') return <div className="rules-list">
    <p><strong>Данетки</strong> — восстанови необычную историю с помощью вопросов ведущему.</p>
    <p>Прочитай условие. Задавай короткие вопросы, на которые можно ответить «да» или «нет», и сопоставляй ответы в журнале.</p>
    <p>«Неважно» означает, что эта деталь не помогает объяснить происшествие. Попробуй проверить другую версию.</p>
    <p>Когда восстановишь причинно-следственную связь, сформулируй полное объяснение и отправь его ведущему на проверку.</p>
    <p>В совместной комнате участники видят один диалог, подсказки и итоговую версию.</p>
  </div>
  return <div className="rules-list">
    <p>Выберите тайтл из поиска. После каждой попытки значения сравниваются с ответом дня.</p>
    <p>Перед 5-й и 8-й попытками можно открыть по одной из трёх дополнительных подсказок.</p>
    <p>В режиме «Аниме» сравниваются формат, статус, эпизоды, студия, сэйю и рейтинг Shikimori.</p>
    <p>В режиме «Игры» дополнительно сравниваются позиция в топе, метрики Steam и Metacritic.</p>
    <p>В режиме «Музыка» сравниваются страна, старт карьеры, десятилетие, тип артиста, статус карьеры, сцена и жанры.</p>
    <p>Топ-трек, топ-альбом и похожие артисты открываются как дополнительные подсказки и не увеличивают основной счетчик совпадений.</p>
    <div><i className="match" aria-hidden="true"><Check /></i><span><strong>Точно</strong> — значение совпало.</span></div>
    <div><i className="close" aria-hidden="true"><Minus /></i><span><strong>Рядом</strong> — число близко или есть частичное совпадение.</span></div>
    <div><i className="miss" aria-hidden="true"><X /></i><span><strong>Мимо</strong> — значение не совпало.</span></div>
    <p>Стрелка показывает, выше или ниже находится правильный год, рейтинг, хронометраж или количество сезонов.</p>
  </div>
}

export function ResumeSessionsView({ sessions, onOpen }: {
  sessions: SavedGame[]
  onOpen: (session: SavedGame) => void
}) {
  return <>
    <p className="modal-lead">Незавершенные игры сохраняются автоматически. Выберите сохраненную игру, чтобы продолжить.</p>
    <div className="resume-list">
      {sessions.map((session) => {
        const attemptText = `${session.attempts.length}/10`
        const sessionLabel = session.mode === 'diagnosis' ? 'Прием' : 'Сеанс'
        const periodText = session.mode === 'movie' || session.mode === 'series' || session.mode === 'anime' || session.mode === 'music' ? PERIODS[session.period]?.short ?? 'Период не задан' : 'Без периода'
        return <article className="resume-item" key={session.key}>
          <ControlButton className="resume-item__open" onClick={() => onOpen(session)}>
            <span className="resume-item__mode">{modeIcon(session.mode)}<i>{modeMeta(session.mode).title}</i></span>
            <strong>{prettyDate(session.date)}, {sessionLabel} №{dayNumber(session.date)}</strong>
            <small>{periodText}, Попытки: {attemptText}</small>
          </ControlButton>
        </article>
      })}
    </div>
  </>
}

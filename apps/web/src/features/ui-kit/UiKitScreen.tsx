import { useState, type CSSProperties } from 'react'
import type { FinalChoiceCandidateSnapshot, FinalChoiceSnapshot, PackLeaderboardResponse } from '@shoditsa/contracts'
import {
  ArrowUpRight,
  Check,
  Copy,
  DoorOpen,
  Infinity,
  PackageOpen,
  Play,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  Trophy,
} from 'lucide-react'
import { ActionButton, BrandLogo, Modal, ScreenBack } from '../../components/app-shell/AppShell'
import { CategoryTicket } from '../../components/category-ticket/CategoryTicket'
import { CATEGORY_TICKET_CONFIG } from '../../components/category-ticket/category-ticket.config'
import {
  GameLaunchControls,
  GameOption,
  GameOptionAction,
  GameOptionSelect,
} from '../../components/game-launch-controls/GameLaunchControls'
import { SearchCombobox } from '../../components/search-combobox'
import { AdmissionTitleTicket, TicketKicker } from '../../components/title-ticket'
import {
  EmptyState,
  ControlButton,
  FormField,
  IconButton,
  InlineAlert,
  LinearProgress,
  SelectControl,
  SegmentedProgress,
  StatusBadge,
  Tabs,
  TextArea,
  TextButton,
  TextInput,
} from '../../components/ui'
import { publicAssetUrl } from '../../app/public-asset'
import { GameResult } from '../result/GameResult'
import { DtfLeaderboard } from '../dtf-comments/DtfLeaderboard'
import { FinalChoicePanel } from '../game-session/FinalChoicePanel'
import { ConnectionsResult, type ConnectionsSession } from '../connections/ConnectionsGamePage'
import './UiKitScreen.css'

const foundations = [
  { token: '--color-bg', label: 'Фон', value: '#121512' },
  { token: '--color-surface', label: 'Поверхность', value: '#1b1f1b' },
  { token: '--color-surface-2', label: 'Поверхность 2', value: '#242924' },
  { token: '--color-paper', label: 'Бумага', value: '#efe7d7' },
  { token: '--color-paper-2', label: 'Бумага 2', value: '#ddd3bd' },
  { token: '--color-primary', label: 'Основной', value: '#57b777' },
  { token: '--color-accent', label: 'Акцент', value: '#d6a546' },
  { token: '--color-danger', label: 'Ошибка', value: '#b85c56' },
]

const modeColors = [
  { token: '--mode-movie-brand', label: 'Кино' },
  { token: '--mode-series-brand', label: 'Сериалы' },
  { token: '--mode-anime-brand', label: 'Аниме' },
  { token: '--mode-game-brand', label: 'Игры' },
  { token: '--mode-city-brand', label: 'Города' },
  { token: '--mode-music-brand', label: 'Музыка' },
  { token: '--mode-diagnosis-brand', label: 'Диагноз' },
  { token: '--mode-danetki-brand', label: 'Данетки' },
  { token: '--mode-connections-brand', label: 'Связи' },
]

const sections = [
  ['foundation', 'Основа'],
  ['typography', 'Типографика'],
  ['actions', 'Действия'],
  ['controls', 'Контролы'],
  ['forms', 'Поля'],
  ['tickets', 'Билеты'],
  ['final-choice', 'Последний выбор'],
  ['connections', 'Связи'],
  ['result-actions', 'После игры'],
  ['leaderboard', 'Рейтинг'],
  ['feedback', 'Состояния'],
] as const

const movieTicket = CATEGORY_TICKET_CONFIG.find((item) => item.mode === 'movie')!
const seriesTicket = CATEGORY_TICKET_CONFIG.find((item) => item.mode === 'series')!
const searchExamples = [
  { id: '1', title: 'Ветер крепчает', meta: '2013 · драма' },
  { id: '2', title: 'Унесённые призраками', meta: '2001 · фэнтези' },
  { id: '3', title: 'Ходячий замок', meta: '2004 · приключения' },
]

const leaderboardFixture: PackLeaderboardResponse = {
  packId: 'ui-kit',
  participantCount: 247,
  totalItems: 20,
  updatedAt: '2026-07-25T00:00:00.000Z',
  entries: [
    { rank: 1, displayName: 'Люмен', avatarUrl: null, completedItems: 20, totalItems: 20, score: 2450, wins: 18, totalAttempts: 34, completedAt: null, isCurrentUser: false },
    { rank: 2, displayName: 'Тихий зритель', avatarUrl: null, completedItems: 20, totalItems: 20, score: 2310, wins: 17, totalAttempts: 39, completedAt: null, isCurrentUser: true },
    { rank: 3, displayName: 'Ракурс', avatarUrl: null, completedItems: 19, totalItems: 20, score: 2190, wins: 16, totalAttempts: 41, completedAt: null, isCurrentUser: false },
    { rank: 4, displayName: 'Полночный сеанс', avatarUrl: null, completedItems: 18, totalItems: 20, score: 2030, wins: 15, totalAttempts: 43, completedAt: null, isCurrentUser: false },
  ],
  viewerEntry: null,
}

const finalCandidate = (id: string, titleRu: string, titleOriginal: string, year: string, countries: string, runtime: string): FinalChoiceCandidateSnapshot => ({
  item: { id, titleRu, titleOriginal, posterUrl: publicAssetUrl('images/title-posters/movie-ticket-poster.webp') },
  primaryMeta: year,
  facts: [
    { key: 'countries', value: countries, ariaLabel: `Страны: ${countries}` },
    { key: 'genres', value: 'фантастика · драма', ariaLabel: 'Жанры: фантастика, драма' },
    { key: 'runtime_rating', value: runtime, ariaLabel: `Хронометраж и рейтинг: ${runtime}` },
  ],
})

const finalChoiceFixture: FinalChoiceSnapshot = {
  candidates: [
    finalCandidate('arrival', 'Прибытие', 'Arrival', '2016', 'США · Канада', '116 мин · КП 7,6'),
    finalCandidate('interstellar', 'Интерстеллар', 'Interstellar', '2014', 'США · Великобритания', '169 мин · КП 8,7'),
    finalCandidate('contact', 'Контакт', 'Contact', '1997', 'США', '150 мин · КП 7,9'),
    finalCandidate('moon', 'Луна 2112', 'Moon', '2009', 'Великобритания', '97 мин · КП 7,6'),
  ],
  displayKeys: ['countries', 'genres', 'runtime_rating'],
  choicesRemaining: 1,
}

const connectionsResultGroups = [
  { color: 'yellow', title: 'Оканчиваются на «-ай»', words: ['МАЙ', 'ЛАЙ', 'ЧАЙ', 'КРАЙ'] },
  { color: 'green', title: 'Можно открыть ключом', words: ['ДВЕРЬ', 'ЗАМОК', 'СЕЙФ', 'СУНДУК'] },
  { color: 'blue', title: 'Виды волн', words: ['ЗВУК', 'СВЕТ', 'ПРИЛИВ', 'РАДИО'] },
  { color: 'purple', title: 'Скрытая связь', words: ['ЛИНИЯ', 'УЗЕЛ', 'ЦЕПЬ', 'МОСТ'] },
] as const

const connectionsResultTiles = connectionsResultGroups.flatMap((group, groupIndex) => group.words.map((label, wordIndex) => ({
  id: `${group.color}-${wordIndex}`,
  label,
  initialPosition: groupIndex * 4 + wordIndex,
})))

const connectionsResultFixture: ConnectionsSession = {
  engine: 'connections_grid',
  rulesVersion: 4,
  id: 'ui-kit-connections-result',
  kind: 'daily',
  packId: null,
  packPosition: null,
  mode: 'connections',
  variantKey: null,
  period: 'all',
  difficulty: 'medium',
  puzzleDate: '2026-07-28',
  status: 'won',
  completionType: 'direct_win',
  finalChoice: null,
  attemptsCount: 5,
  attemptsRemaining: 1,
  maxAttempts: 6,
  attempts: [],
  hintCheckpoints: [],
  hintChoices: [],
  hintOptions: [],
  progressiveHints: [],
  promoPrompt: null,
  diagnosisVignette: null,
  serverTime: '2026-07-28T12:00:00.000Z',
  connections: {
    tiles: connectionsResultTiles,
    solvedGroups: connectionsResultGroups.map((group) => ({
      color: group.color,
      title: group.title,
      tiles: connectionsResultTiles.filter((tile) => tile.id.startsWith(`${group.color}-`)),
    })),
    guesses: [],
    hints: [{ checkpoint: 1, text: 'Одна группа связана с тем, что можно открыть.' }],
    mistakesUsed: 1,
    mistakesRemaining: 3,
    maxMistakes: 4,
    maxGuesses: 6,
    hintAvailableAt: null,
    status: 'won',
  },
}

function SectionTitle({ index, title, description, component }: {
  index: string
  title: string
  description: string
  component?: string
}) {
  return <header className="ui-kit-section__head">
    <span>{index}</span>
    <div>
      <div className="ui-kit-section__title">
        <h2>{title}</h2>
        {component && <code>{component}</code>}
      </div>
      <p>{description}</p>
    </div>
  </header>
}

export default function UiKitScreen() {
  const [launchMode, setLaunchMode] = useState<'period' | 'free'>('period')
  const [modalOpen, setModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'daily' | 'archive'>('daily')
  const [finalChoiceSelection, setFinalChoiceSelection] = useState<string | null>('interstellar')
  const [connectionsSelection, setConnectionsSelection] = useState<string[]>(['МАЙ'])
  const filteredExamples = searchExamples.filter((item) => item.title.toLocaleLowerCase('ru-RU').includes(searchQuery.toLocaleLowerCase('ru-RU')))

  return <div className="ui-kit-screen">
    <header className="ui-kit-topbar">
      <a className="ui-kit-topbar__brand" href="/" aria-label="Сходится! — на главную"><BrandLogo /></a>
      <span className="ui-kit-topbar__rule" aria-hidden="true" />
      <div className="ui-kit-topbar__title"><small>Система интерфейса</small><strong>UI KIT · 1.0</strong></div>
      <a className="ui-kit-topbar__exit" href="/">К проекту <ArrowUpRight /></a>
    </header>

    <main className="ui-kit-main">
      <ScreenBack href="/" label="Вернуться на главную" />

      <section className="ui-kit-hero" aria-labelledby="ui-kit-title">
        <div>
          <span className="ui-kit-eyebrow">ЖИВАЯ ВИТРИНА · СХОДИТСЯ!</span>
          <h1 id="ui-kit-title">Система<br />интерфейса</h1>
          <p>Канонические токены, компоненты и состояния пользовательской части проекта. Всё на этой странице собрано из рабочего UI-кита.</p>
        </div>
        <aside className="ui-kit-hero__ticket" aria-label="Паспорт дизайн-системы">
          <span><Ticket /> ПАСПОРТ СИСТЕМЫ</span>
          <strong>UI<br />01</strong>
          <dl>
            <div><dt>Шрифты</dt><dd>2</dd></div>
            <div><dt>Режимы</dt><dd>9</dd></div>
            <div><dt>Кнопки</dt><dd>4</dd></div>
          </dl>
        </aside>
      </section>

      <div className="ui-kit-layout">
        <nav className="ui-kit-index" aria-label="Разделы UI-кита">
          <span>Содержание</span>
          {sections.map(([id, label], index) => <a href={`#${id}`} key={id}><i>{String(index + 1).padStart(2, '0')}</i>{label}</a>)}
          <p>Правила и компоненты должны обновляться одновременно.</p>
        </nav>

        <div className="ui-kit-content">
          <section className="ui-kit-section" id="foundation">
            <SectionTitle index="01" title="Основа" description="Общие цветовые роли. Компоненты используют переменные, а не собственные значения." component="tokens.css" />
            <div className="ui-kit-swatches">
              {foundations.map(({ token, label, value }) => <article key={token} className="ui-kit-swatch" style={{ '--swatch': `var(${token})` } as CSSProperties}>
                <i aria-hidden="true" />
                <strong>{label}</strong>
                <code>{token}</code>
                <small>{value}</small>
              </article>)}
            </div>
            <div className="ui-kit-mode-strip" aria-label="Цвета игровых режимов">
              {modeColors.map(({ token, label }) => <span key={token} style={{ '--mode-swatch': `var(${token})` } as CSSProperties}><i />{label}</span>)}
            </div>
          </section>

          <section className="ui-kit-section" id="typography">
            <SectionTitle index="02" title="Типографика" description="Oswald отвечает за афишу и печатную иерархию. Manrope — за интерфейс и длинный текст." />
            <div className="ui-kit-type-grid">
              <article className="ui-kit-type-card ui-kit-type-card--display">
                <span>Display · Oswald Medium</span>
                <strong>АНИМЕ ДНЯ</strong>
                <p>48 / 48 · uppercase</p>
              </article>
              <article className="ui-kit-type-card ui-kit-type-card--body">
                <span>Interface · Manrope</span>
                <strong>Сверяйте подсказки после каждой попытки</strong>
                <p>Основной текст остаётся спокойным и функциональным. Выделение строится на весе, размере и контрасте.</p>
              </article>
            </div>
          </section>

          <section className="ui-kit-section" id="actions">
            <SectionTitle index="03" title="Действия" description="Одна основная кнопка на уровень. Текст действия начинается с глагола." component="ActionButton" />
            <div className="ui-kit-specimen ui-kit-specimen--dark">
              <div className="ui-kit-specimen__label"><span>Варианты</span><code>min-height 48</code></div>
              <div className="ui-kit-button-row">
                <ActionButton><Play /> Начать игру</ActionButton>
                <ActionButton variant="secondary"><Copy /> Скопировать</ActionButton>
                <ActionButton variant="ghost"><DoorOpen /> Выйти</ActionButton>
                <ActionButton variant="hint"><Sparkles /> Открыть подсказку</ActionButton>
                <ActionButton variant="danger">Удалить</ActionButton>
              </div>
              <div className="ui-kit-button-row">
                <ActionButton disabled><Play /> Недоступно</ActionButton>
                <IconButton label="Скопировать"><Copy /></IconButton>
                <TextButton>Текстовое действие</TextButton>
                <span className="ui-kit-annotation">Disabled объясняется соседним текстом, если причина неочевидна.</span>
              </div>
            </div>
          </section>

          <section className="ui-kit-section" id="controls">
            <SectionTitle index="04" title="Контролы запуска" description="Главное действие, настройка и контекстная ссылка образуют один геометрический ряд." component="GameLaunchControls" />
            <div className="ui-kit-specimen ui-kit-specimen--paper ui-kit-launch">
              <div className="ui-kit-specimen__label"><span>Бумажный контекст</span><code>56 px</code></div>
              <GameLaunchControls
                mode="movie"
                action={<ActionButton className="play-button game-launch-controls__play"><Play /> Продолжить</ActionButton>}
                option={<GameOptionSelect
                  label="Режим"
                  labelIcon={<SlidersHorizontal />}
                  value={launchMode === 'period' ? 'Период' : 'Свободная игра'}
                  endLabel={launchMode === 'period' ? '07/07' : <Infinity />}
                  menuLabel="Выберите режим"
                  resetKey={launchMode}
                >
                  {(close) => <>
                    <GameOption title="Период" description="Игра по маршруту из семи дней" icon={<Ticket />} status={{ label: 'Доступно', tone: 'available', icon: <Check /> }} selected={launchMode === 'period'} onSelect={() => { setLaunchMode('period'); close() }} />
                    <GameOption title="Свободная игра" description="Без дневного ограничения" icon={<Infinity />} status={{ label: <>Открыть · 99</>, tone: 'unlockable', icon: <Ticket /> }} selected={launchMode === 'free'} onSelect={() => { setLaunchMode('free'); close() }} />
                  </>}
                </GameOptionSelect>}
              />
              <div className="ui-kit-context-action">
                <GameOptionAction label="Общий зачёт" labelIcon={<Trophy />} value="Открыть рейтинг" onClick={() => setModalOpen(true)} />
                <p><strong>GameOptionAction</strong> — действие на бумаге, визуально связанное с настройками, но не открывающее список.</p>
              </div>
            </div>
          </section>

          <section className="ui-kit-section" id="forms">
            <SectionTitle index="05" title="Поля и поиск" description="Поля, подписи и поиск имеют единые состояния фокуса, ошибок и клавиатурной навигации." component="FormField · SearchCombobox" />
            <div className="ui-kit-specimen ui-kit-specimen--dark">
              <div className="search-area ui-kit-search">
                <label htmlFor="ui-kit-search-input">Найти фильм или сериал</label>
                <SearchCombobox
                  inputProps={{
                    id: 'ui-kit-search-input',
                    value: searchQuery,
                    placeholder: 'Начните вводить название…',
                    onChange: (event) => setSearchQuery(event.target.value),
                  }}
                  open={searchQuery.length >= 2}
                  suggestions={filteredExamples}
                  emptyMessage="В примерах ничего не найдено"
                  onSubmit={() => undefined}
                  onSuggestionSelect={(item) => setSearchQuery(item.title)}
                  getSuggestionKey={(item) => item.id}
                  renderSuggestion={(item) => <span><strong>{item.title}</strong><small>{item.meta}</small></span>}
                />
                <div className="search-meta"><span>Минимум 2 символа</span><strong>Поиск по каталогу</strong></div>
              </div>
              <div className="ui-kit-form-grid">
                <FormField label="Название команды" htmlFor="ui-kit-name" hint="До 40 символов">
                  <TextInput surface="paper" id="ui-kit-name" defaultValue="Полуночный сеанс" />
                </FormField>
                <FormField label="Режим" htmlFor="ui-kit-mode">
                  <SelectControl surface="paper" id="ui-kit-mode" defaultValue="daily"><option value="daily">Ежедневная игра</option><option value="free">Свободная игра</option></SelectControl>
                </FormField>
                <FormField className="ui-kit-form-grid__wide" label="Сообщение" htmlFor="ui-kit-message" error="Добавьте хотя бы одно предложение">
                  <TextArea surface="paper" id="ui-kit-message" rows={3} placeholder="Напишите сообщение…" />
                </FormField>
              </div>
            </div>
          </section>

          <section className="ui-kit-section" id="tickets">
            <SectionTitle index="06" title="Билеты" description="Главная продуктовая метафора: корешок, перфорация, бумага, печатная иерархия и режимный цвет." component="CategoryTicket · AdmissionTitleTicket" />
            <div className="category-grid category-grid--active ui-kit-ticket-grid">
              <CategoryTicket {...movieTicket} poolCount={500} status="new" attempts={null} onClick={() => undefined} />
              <CategoryTicket {...seriesTicket} poolCount={500} status="active" attempts={4} onClick={() => undefined} />
            </div>
            <div className="ui-kit-title-ticket">
              <AdmissionTitleTicket
                id="ui-kit-admission-title"
                mode="movie"
                posterUrl={publicAssetUrl('images/title-posters/movie-ticket-poster.webp')}
                stubLabel="Вход"
                stubTitle="Один"
                stubMeta="Кино"
                stubEnd="07/07"
              >
                <TicketKicker title="Ежедневная премьера" detail="полночный сеанс" />
                <h2 id="ui-kit-admission-title">Ежедневная игра: кино</h2>
                <p>Общий титульный билет хранит корешок, вырезы и структуру, а экран передаёт только содержание.</p>
              </AdmissionTitleTicket>
            </div>
          </section>

          <section className="ui-kit-section" id="final-choice">
            <SectionTitle index="07" title="Последний выбор" description="Финальная сверка использует общий паттерн выбора одной карточки, клавиатурную радиогруппу и отдельное подтверждение открытия ответа." component="FinalChoicePanel" />
            <FinalChoicePanel
              mode="movie"
              snapshot={finalChoiceFixture}
              selectedItemId={finalChoiceSelection}
              secondsRemaining={10}
              autoFocus={false}
              onSelect={(itemId) => setFinalChoiceSelection(itemId)}
              onSubmit={() => undefined}
              onReveal={() => undefined}
            />
          </section>

          <section className="ui-kit-section" id="connections">
            <SectionTitle index="08" title="Связи" description="Состояния плиток, четыре уровня группы и счётчик ошибок. Выбор не зависит только от цвета и остаётся клавиатурно доступным." component="ConnectionsGrid" />
            <div className="ui-kit-connections">
              <div className="ui-kit-connections__tiles" aria-label="Состояния плитки">
                {[
                  ['МАЙ', 'default'],
                  ['ЛАЙ', 'default'],
                  ['ЧАЙ', 'default'],
                  ['КРАЙ', 'disabled'],
                ].map(([word, state]) => <ControlButton
                  key={word}
                  type="button"
                  disabled={state === 'disabled'}
                  className={connectionsSelection.includes(word) ? 'is-selected' : ''}
                  onClick={() => setConnectionsSelection((current) => current.includes(word) ? current.filter((item) => item !== word) : [...current, word])}
                >{word}<small>{state === 'disabled' ? 'disabled' : connectionsSelection.includes(word) ? 'selected' : 'default'}</small></ControlButton>)}
              </div>
              <div className="ui-kit-connections__groups">
                {[
                  ['yellow', 'Оканчиваются на -АЙ', 'МАЙ · ЛАЙ · ЧАЙ · КРАЙ'],
                  ['green', 'Можно открыть ключом', 'ДВЕРЬ · ЗАМОК · СЕЙФ · СУНДУК'],
                  ['blue', 'Виды волн', 'ЗВУК · СВЕТ · ПРИЛИВ · РАДИО'],
                  ['purple', 'Скрытая связь', 'ЧЕТЫРЕ СЛОВА'],
                ].map(([color, title, words]) => <article key={color} className={`ui-kit-connections__group ui-kit-connections__group--${color}`}>
                  <strong>{title}</strong><span>{words}</span>
                </article>)}
              </div>
              <div className="ui-kit-connections__mistakes">
                <span>Ошибок осталось</span><i>×</i><i>×</i><i className="is-used">×</i><i className="is-used">×</i>
              </div>
            </div>
            <div className="ui-kit-connections-result">
              <div className="ui-kit-specimen__label">
                <span>Завершённая игра · восстановленный результат</span>
                <code>desktop / mobile</code>
              </div>
              <ConnectionsResult
                session={connectionsResultFixture}
                copied={false}
                reward={null}
                streak={1}
                completedToday={4}
                nextMode="series"
                onCopy={() => undefined}
                onChallenge={() => undefined}
                onNext={() => undefined}
                onArchive={() => undefined}
                onReport={() => undefined}
                autoScroll={false}
              />
            </div>
          </section>

          <section className="ui-kit-section" id="result-actions">
            <SectionTitle index="09" title="Действия после игры" description="Маршрут, настройка режима и действия после сеанса собраны в одном компоненте. На телефоне все вторичные действия занимают полную ширину." component="ResultActionBar" />
            <div className="ui-kit-result-action">
              <GameResult
                mode="series"
                won
                attempts={4}
                poster={<img src={publicAssetUrl('images/category-stubs/movie-stub.webp')} alt="Постер демонстрационного результата" />}
                title="Тёмные начала"
                meta="His Dark Materials · 2019"
                tags={['фэнтези', 'драма']}
                completedToday={4}
                nextRewardText="До полного маршрута: ещё 3"
                nextLabel="Играть дальше: кино"
                configureLabel="Период / свободная игра"
                award={null}
                streak={5}
                copied={false}
                telegramUrl="#"
                onNext={() => undefined}
                onConfigure={() => undefined}
                onChallenge={() => undefined}
                onCopy={() => undefined}
                autoScroll={false}
              />
            </div>
          </section>

          <section className="ui-kit-section" id="leaderboard">
            <SectionTitle index="10" title="Таблица рейтинга" description="Рейтинг использует бумажную поверхность, режимный акцент и читаемую служебную типографику не меньше 10 px." component="DtfLeaderboard" />
            <div className="ui-kit-leaderboard"><DtfLeaderboard data={leaderboardFixture} /></div>
          </section>

          <section className="ui-kit-section" id="feedback">
            <SectionTitle index="11" title="Состояния и обратная связь" description="Цвет усиливает смысл, но не заменяет текст или иконку. Прогресс и вкладки тоже являются общими компонентами." component="Feedback · Progress · Tabs" />
            <div className="ui-kit-feedback-grid">
              <InlineAlert tone="success"><strong>Подсказка открыта.</strong> Режиссёр также работал над известной научно-фантастической картиной.</InlineAlert>
              <div className="ui-kit-status-list">
                <StatusBadge tone="success">Готово</StatusBadge>
                <StatusBadge tone="warning">Требует внимания</StatusBadge>
                <StatusBadge>Нейтральное состояние</StatusBadge>
              </div>
            </div>
            <div className="ui-kit-feedback-stack">
              <Tabs surface="dark" label="Пример навигации" value={activeTab} onChange={setActiveTab} items={[{ id: 'daily', label: 'Сегодня' }, { id: 'archive', label: 'Архив' }]} />
              <SegmentedProgress value={4} max={10} />
              <LinearProgress value={6} max={20} label="пройдено" />
              <EmptyState icon={<PackageOpen />} title="Здесь пока пусто" description="Когда появятся результаты, они будут собраны этим же компонентом." action={<ActionButton variant="secondary">Открыть игры</ActionButton>} />
            </div>
            <div className="ui-kit-modal-demo">
              <div><span>Диалог</span><p>Модальные окна используют бумажную поверхность и сохраняют фокус внутри.</p></div>
              <ActionButton variant="secondary" onClick={() => setModalOpen(true)}>Открыть пример</ActionButton>
            </div>
          </section>
        </div>
      </div>
    </main>

    <footer className="ui-kit-footer"><span>СХОДИТСЯ! · UI KIT</span><small>Живая система · 2026</small></footer>

    {modalOpen && <Modal title="Общий зачёт" onClose={() => setModalOpen(false)}>
      <p className="modal-lead">Это штатное модальное окно на бумажной поверхности. Оно закрывается по кнопке, клику вне окна или клавише Escape.</p>
      <div className="ui-kit-modal-paper">
        <Trophy />
        <div><span>Место сегодня</span><strong>6 из 247</strong></div>
      </div>
    </Modal>}
  </div>
}

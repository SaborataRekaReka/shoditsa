import { useEffect, useState, type CSSProperties } from 'react'
import type { FinalChoiceCandidateSnapshot, FinalChoiceSnapshot, PackLeaderboardResponse } from '@shoditsa/contracts'
import { ArrowUpRight, CalendarDays, Check, Copy, DoorOpen, Infinity, LoaderCircle, PackageOpen, Play, SlidersHorizontal, Lightbulb, Ticket, Trophy } from 'lucide-react'
import { ActionButton, BrandLogo, Modal, ScreenBack } from '../../components/app-shell/AppShell'
import { CategoryTicket } from '../../components/category-ticket/CategoryTicket'
import { Mascot, type MascotPose } from '../../components/mascot/Mascot'
import { ReferenceIcon } from '../../components/ui/ReferenceIcon'
import { QuestOptionGroup, QuestSwitch } from '../../components/ui/QuestPrimitives'
import { APPLICATION_DESIGN } from '../../app/application-design'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { StudyClubJoinDialog } from '../../dev/quest-game/StudyClubJoinDialog'
import { BrandLoader } from '../../components/app-shell/BrandLoader'
import { BrandWordmark } from '../../components/app-shell/BrandWordmark'
import { SelectionRow } from '../../components/ui/SelectionRow'
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
  PageHeading,
  Tooltip,
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
import { ConnectionsTile, ConnectionsSolvedGroup, ConnectionsMistakes } from '../connections/ConnectionsBoardParts'
import { publicAssetUrl } from '../../app/public-asset'
import { GameResult } from '../result/GameResult'
import { DtfLeaderboard } from '../dtf-comments/DtfLeaderboard'
import { FinalChoicePanel } from '../game-session/FinalChoicePanel'
import { ConnectionsResult, type ConnectionsSession } from '../connections/ConnectionsGamePage'
import './UiKitScreen.css'

const foundations = [
  { token: '--color-bg', label: 'Фон' },
  { token: '--color-surface', label: 'Поверхность' },
  { token: '--color-surface-2', label: 'Вложенная поверхность' },
  { token: '--color-action', label: 'Основное действие' },
  { token: '--color-text', label: 'Текст' },
  { token: '--color-muted', label: 'Вторичный текст' },
  { token: '--color-line', label: 'Граница' },
  { token: '--color-lilac', label: 'Сиреневый акцент' },
  { token: '--match-exact-bg', label: 'Совпадает' },
  { token: '--match-partial-bg', label: 'Близко' },
  { token: '--match-miss-bg', label: 'Не совпадает' },
  { token: '--match-unknown-bg', label: 'Пока неизвестно' },
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
  { token: '--mode-animal-brand', label: 'Животные' },
  { token: '--mode-book-brand', label: 'Книги' },
  { token: '--mode-character-brand', label: 'Персонажи' },
]

const sections = [
  ['foundation', 'Основа'],
  ['typography', 'Типографика'],
  ['mascot', 'Персонаж'],
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
  { id: '1', title: 'Ветер крепчает', meta: '2013, драма' },
  { id: '2', title: 'Унесённые призраками', meta: '2001, фэнтези' },
  { id: '3', title: 'Ходячий замок', meta: '2004, приключения' },
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
    { key: 'genres', value: 'фантастика, драма', ariaLabel: 'Жанры: фантастика, драма' },
    { key: 'runtime_rating', value: runtime, ariaLabel: `Хронометраж и рейтинг: ${runtime}` },
  ],
})

const finalChoiceFixture: FinalChoiceSnapshot = {
  candidates: [
    finalCandidate('arrival', 'Прибытие', 'Arrival', '2016', 'США, Канада', '116 мин, КП 7,6'),
    finalCandidate('interstellar', 'Интерстеллар', 'Interstellar', '2014', 'США, Великобритания', '169 мин, КП 8,7'),
    finalCandidate('contact', 'Контакт', 'Contact', '1997', 'США', '150 мин, КП 7,9'),
    finalCandidate('moon', 'Луна 2112', 'Moon', '2009', 'Великобритания', '97 мин, КП 7,6'),
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
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({})
  const [launchMode, setLaunchMode] = useState<'period' | 'free'>('period')
  const [modalOpen, setModalOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [clubOfferOpen, setClubOfferOpen] = useState(false)
  const [selectedRow, setSelectedRow] = useState('daily')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'daily' | 'archive'>('daily')
  const [finalChoiceSelection, setFinalChoiceSelection] = useState<string | null>('interstellar')
  const [resultPreview, setResultPreview] = useState<'won' | 'lost'>('won')
  const [accountPreview, setAccountPreview] = useState<'guest' | 'authenticated'>('guest')
  const [connectionsSelection, setConnectionsSelection] = useState<string[]>(['МАЙ'])
  const [roundsPreview, setRoundsPreview] = useState(1)
  const [adultPreview, setAdultPreview] = useState(true)
  const filteredExamples = searchExamples.filter((item) => item.title.toLocaleLowerCase('ru-RU').includes(searchQuery.toLocaleLowerCase('ru-RU')))

  useEffect(() => {
    const update = () => {
      const styles = getComputedStyle(document.documentElement)
      setTokenValues(Object.fromEntries(foundations.map(({ token }) => [token, styles.getPropertyValue(token).trim()])))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-public-theme'] })
    return () => observer.disconnect()
  }, [])

  return <div className="ui-kit-screen">
    <header className="ui-kit-topbar">
      <a className="ui-kit-topbar__brand" href="/" aria-label="Сходится! — на главную"><BrandLogo /></a>
      <span className="ui-kit-topbar__rule" aria-hidden="true" />
      <div className="ui-kit-topbar__title"><small>Система интерфейса</small><strong>UI KIT, 1.0</strong></div>
      <a className="ui-kit-topbar__exit" href="/">К проекту <ArrowUpRight /></a>
    </header>

    <main className="ui-kit-main">
      <ScreenBack href="/" label="Вернуться на главную" />

      <section className="ui-kit-hero" aria-labelledby="ui-kit-title">
        <div>
          <span className="ui-kit-eyebrow">ЖИВАЯ ВИТРИНА, СХОДИТСЯ!</span>
          <h1 id="ui-kit-title">Система<br />интерфейса</h1>
          <p>Канонические токены, компоненты и состояния пользовательской части проекта. Всё на этой странице собрано из рабочего UI-кита.</p>
        </div>
        <aside className="ui-kit-hero__ticket" aria-label="Паспорт дизайн-системы">
          <span><Ticket /> ПАСПОРТ СИСТЕМЫ</span>
          <strong>UI<br />01</strong>
          <dl>
            <div><dt>Шрифты</dt><dd>4</dd></div>
            <div><dt>Режимы</dt><dd>12</dd></div>
            <div><dt>Кнопки</dt><dd>5</dd></div>
          </dl>
        </aside>
      </section>

      <div className="ui-kit-layout">
        <nav className="ui-kit-index" aria-label="Разделы UI-кита">
          <span>Содержание</span>
          {sections.map(([id, label], index) => <a href={`/ui-kit#${id}`} key={id}><i>{String(index + 1).padStart(2, '0')}</i>{label}</a>)}
          <p>Правила и компоненты должны обновляться одновременно.</p>
        </nav>

        <div className="ui-kit-content">
          <section className="ui-kit-section" id="foundation">
            <SectionTitle index="01" title="Основа" description="Общие цветовые роли. Компоненты используют переменные, а не собственные значения." component="tokens.css" />
            <div className="ui-kit-swatches">
              {foundations.map(({ token, label }) => <article key={token} className="ui-kit-swatch" style={{ '--swatch': `var(${token})` } as CSSProperties}>
                <i aria-hidden="true" />
                <strong>{label}</strong>
                <code>{token}</code>
                <small>{tokenValues[token] || 'Значение текущей темы'}</small>
              </article>)}
            </div>
            <div className="ui-kit-mode-strip" aria-label="Цвета игровых режимов">
              {modeColors.map(({ token, label }) => <span key={token} style={{ '--mode-swatch': `var(${token})` } as CSSProperties}><i />{label}</span>)}
            </div>
            <div className="ui-kit-modal-demo">
              <div><span>Фирменный логотип</span><p>Исходный знак с плавным градиентом. Движение отключается системной настройкой.</p></div>
              <BrandWordmark variant="compact" effect="iridescent" />
            </div>
            <div className="ui-kit-icon-sample">
              <h3>Иконки, ReferenceIcon</h3>
              <ul aria-label="Примеры смысловых иконок">
                {([
                  ['movie', 'Кино'], ['anime', 'Аниме'], ['animal', 'Животные'],
                  ['book', 'Книги'], ['idea', 'Подсказка'], ['guide', 'Правила'],
                ] as const).map(([name, label]) => <li key={name}><ReferenceIcon name={name} size={24} /><span>{label}</span></li>)}
              </ul>
              <p>ReferenceIcon — для смысловых акцентов режимов и подсказок. В стандартных элементах управления сохраняем Lucide. SVG наследует цвет текста; размер рядом с подписью — 20–24 px.</p>
            </div>
          </section>

          <section className="ui-kit-section" id="typography">
            <SectionTitle index="02" title="Типографика" description="Nunito — основной текст и интерфейс. Manrope — заголовки игровых разделов. Caveat — рукописные акценты. PT Mono — загадки и технические значения." />
            <div className="ui-kit-type-grid">
              <article className="ui-kit-type-card ui-kit-type-card--display">
                <span>Заголовок, Nunito</span>
                <strong>Маленькое открытие каждый день</strong>
                <p>Обычный регистр, выразительный вес</p>
              </article>
              <article className="ui-kit-type-card ui-kit-type-card--body">
                <span>Интерфейс, Nunito</span>
                <strong>Сверяйте подсказки после каждой попытки</strong>
                <p>Основной текст остаётся спокойным и функциональным. Выделение строится на весе, размере и контрасте.</p>
              </article>
              <article className="ui-kit-type-card ui-kit-type-card--script">
                <span>Акцент, Caveat</span>
                <strong>Любопытство — уже половина разгадки</strong>
                <p>Только для коротких заметок, не для правил и форм</p>
              </article>
              <article className="ui-kit-type-card ui-kit-type-card--mono">
                <span>Данные, PT Mono</span>
                <strong>03 / 10, 12:45</strong>
                <p>Числа, счётчики и небольшие значения</p>
              </article>
            </div>
          </section>

          <section className="ui-kit-section" id="page-headings">
            <SectionTitle index="02a" title="Заголовки страниц" description="Название сверху, описание под ним, действия справа. Один размер для основных разделов." component="PageHeading, Tooltip" />
            <div className="ui-kit-specimen">
              <PageHeading level={2} title="Архив" description="Выбирай загадку по дате или продолжай начатую партию." />
              <Tooltip label="Обновить список">{(tooltip, id) => <ActionButton variant="secondary" {...tooltip} aria-describedby={id}>Наведи или выбери Tab</ActionButton>}</Tooltip>
            </div>
          </section>

          <section className="ui-kit-section" id="mascot">
            <SectionTitle index="03" title="Персонаж как акцент" description="Сцена на главной и герой клуба. Остальные позы — резерв набора, а не замена тематических иллюстраций и иконок." component="Mascot" />
            <div className="ui-kit-mascot-grid">
              {([
                ['heroScene', 'Сцена главной'],
                ['think', 'Размышляет'], ['welcome', 'Приветствует'], ['peek', 'Подглядывает'],
                ['sleep', 'Отдыхает'], ['club', 'В клубе'], ['celebrate', 'Радуется'],
              ] as [MascotPose, string][]).map(([pose, label]) => <figure key={pose}>
                <Mascot pose={pose} width={240} height={240} loading="lazy" />
                <figcaption>{label}</figcaption>
              </figure>)}
            </div>
          </section>

          <section className="ui-kit-section" id="actions">
            <SectionTitle index="04" title="Действия" description="Одна основная кнопка на уровень. Текст действия начинается с глагола." component="ActionButton" />
            <div className="ui-kit-specimen ui-kit-specimen--dark">
              <div className="ui-kit-specimen__label"><span>Варианты</span><code>min-height 48</code></div>
              <div className="ui-kit-button-row">
                <ActionButton><Play /> Начать игру</ActionButton>
                <ActionButton variant="secondary"><Copy /> Скопировать</ActionButton>
                <ActionButton variant="ghost"><DoorOpen /> Выйти</ActionButton>
                <ActionButton variant="hint"><Lightbulb /> Открыть подсказку</ActionButton>
                <ActionButton variant="danger">Удалить</ActionButton>
              </div>
              <div className="ui-kit-button-row">
                <ActionButton disabled><Play /> Недоступно</ActionButton>
                <ActionButton disabled aria-busy="true"><LoaderCircle className="ui-kit-spinner" /> Сохраняем…</ActionButton>
                <ActionButton variant="secondary">Продолжить незавершённую игру с длинным названием</ActionButton>
                <IconButton label="Скопировать"><Copy /></IconButton>
                <TextButton>Текстовое действие</TextButton>
                <span className="ui-kit-annotation">Disabled объясняется соседним текстом, если причина неочевидна.</span>
              </div>
            </div>
          </section>

          <section className="ui-kit-section" id="controls">
            <SectionTitle index="05" title="Контролы запуска" description="Главное действие, настройка и контекстная ссылка образуют один геометрический ряд." component="GameLaunchControls" />
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
                    <GameOption title="Свободная игра" description="Без дневного ограничения" icon={<Infinity />} status={{ label: <>Открыть за 99</>, tone: 'unlockable', icon: <Ticket /> }} selected={launchMode === 'free'} onSelect={() => { setLaunchMode('free'); close() }} />
                  </>}
                </GameOptionSelect>}
              />
              <div className="ui-kit-context-action">
                <GameOptionAction label="Общий зачёт" labelIcon={<Trophy />} value="Открыть рейтинг" onClick={() => setModalOpen(true)} />
                <p><strong>GameOptionAction</strong> — действие на бумаге, визуально связанное с настройками, но не открывающее список.</p>
              </div>
            </div>
            <div className="ui-kit-specimen ui-kit-launch">
              <div className="ui-kit-specimen__label"><span>Компактный запуск на стартовой странице</span><code>46 px, compact</code></div>
              <GameLaunchControls mode="movie" density="compact"
                action={<ActionButton size="compact"><Play />Начать игру</ActionButton>}
                option={<GameOptionAction label="Период" labelIcon={<CalendarDays />} value="Все годы" endLabel={<><Ticket />15</>} onClick={() => setModalOpen(true)} />}
              />
            </div>
          </section>

          <section className="ui-kit-section" id="forms">
            <SectionTitle index="06" title="Поля и поиск" description="Поля, подписи и поиск имеют единые состояния фокуса, ошибок и клавиатурной навигации." component="FormField, SearchCombobox" />
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
                {APPLICATION_DESIGN && <>
                  <QuestOptionGroup label="Раунды" value={roundsPreview} options={[1, 2, 3].map(value => ({ value, label: String(value) }))} onChange={setRoundsPreview} />
                  <FormField label="Компания"><QuestSwitch label="Контент 18+" checked={adultPreview} onChange={setAdultPreview} /></FormField>
                  <QuestOptionGroup label="Время на вопрос, сек." value={30} options={[15, 30, 45, 60].map(value => ({ value, label: String(value) }))} onChange={() => {}} disabled />
                  <FormField label="Недоступный переключатель"><QuestSwitch label="Контент 18+" checked={false} onChange={() => {}} disabled /></FormField>
                </>}
                <FormField label="Игра в архиве" htmlFor="ui-kit-soft-game">
                  <SelectControl variant="soft" id="ui-kit-soft-game" defaultValue="movie"><option value="movie">Кино</option><option value="series">Сериалы</option></SelectControl>
                </FormField>
                <FormField label="По какое число" htmlFor="ui-kit-soft-date">
                  <TextInput variant="soft" id="ui-kit-soft-date" type="date" defaultValue="2026-10-21" />
                </FormField>
                <FormField label="Дата с ошибкой" htmlFor="ui-kit-soft-date-error" error="Выбери прошедший день">
                  <TextInput variant="soft" id="ui-kit-soft-date-error" type="date" defaultValue="2026-10-22" aria-invalid="true" />
                </FormField>
                <FormField label="Недоступный фильтр" htmlFor="ui-kit-soft-disabled">
                  <SelectControl variant="soft" id="ui-kit-soft-disabled" disabled><option>Загружаем игры…</option></SelectControl>
                </FormField>
                <FormField label="Название команды" htmlFor="ui-kit-name" hint="До 40 символов">
                  <TextInput surface="paper" id="ui-kit-name" defaultValue="Полуночный сеанс" />
                </FormField>
                <FormField label="Режим" htmlFor="ui-kit-mode">
                  <SelectControl surface="paper" id="ui-kit-mode" defaultValue="daily"><option value="daily">Ежедневная игра</option><option value="free">Свободная игра</option></SelectControl>
                </FormField>
                <FormField className="ui-kit-form-grid__wide" label="Сообщение" htmlFor="ui-kit-message" error="Добавьте хотя бы одно предложение">
                  <TextArea surface="paper" id="ui-kit-message" rows={3} placeholder="Напишите сообщение…" aria-invalid="true" />
                </FormField>
                <FormField label="Данные загружаются" htmlFor="ui-kit-loading-field" hint="Поле станет доступно после загрузки">
                  <TextInput id="ui-kit-loading-field" placeholder="Загружаем…" disabled aria-busy="true" />
                </FormField>
                <FormField label="Только для чтения" htmlFor="ui-kit-readonly-field">
                  <TextInput id="ui-kit-readonly-field" value="player@example.com" readOnly />
                </FormField>
              </div>
            </div>
          </section>

          <section className="ui-kit-section" id="tickets">
            <SectionTitle index="07" title="Билеты прежнего интерфейса" description="Сохранённые компоненты для совместимости: корешок, перфорация и режимный цвет. Новые публичные экраны используют карточки reference-темы." component="CategoryTicket, AdmissionTitleTicket" />
            <details className="ui-kit-legacy-examples"><summary>Показать исторические компоненты</summary>
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
            </details>
          </section>



          <section className="ui-kit-section" id="final-choice">
            <SectionTitle index="08" title="Последний выбор" description="Финальная сверка использует общий паттерн выбора одной карточки, клавиатурную радиогруппу и отдельное подтверждение открытия ответа." component="FinalChoicePanel" />
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
            <SectionTitle index="09" title="Связи" description="Состояния плиток, четыре уровня группы и счётчик ошибок. Выбор не зависит только от цвета и остаётся клавиатурно доступным." component="ConnectionsGrid" />
            <div className="ui-kit-connections">
              <div className="ui-kit-specimen__label"><span>Выбор слов</span><span>Нажмите на плитку</span></div>
              <div className="ui-kit-connections__tiles" aria-label="Состояния плитки">
                {['МАЙ', 'ЛАЙ', 'ЧАЙ', 'КРАЙ'].map((word) => <ConnectionsTile
                  key={word}
                  label={word}
                  disabled={word === 'КРАЙ'}
                  selected={connectionsSelection.includes(word)}
                  selectionNumber={connectionsSelection.indexOf(word) + 1}
                  onClick={() => setConnectionsSelection((current) => current.includes(word) ? current.filter((item) => item !== word) : [...current, word])}
                />)}
              </div>
              <p className="ui-kit-annotation">Номер отмечает выбранное слово. «Край» показывает недоступное состояние.</p>
              <div className="ui-kit-connections__groups">
                {connectionsResultGroups.map((group) => <ConnectionsSolvedGroup key={group.color} {...group} />)}
              </div>
              <ConnectionsMistakes used={2} />
            </div>
            <div className="ui-kit-connections-result">
              <div className="ui-kit-specimen__label">
                <span>Завершённая игра, восстановленный результат</span>
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
            <SectionTitle index="10" title="Результат игры" description="Универсальная карточка ведёт от результата к награде, следующей игре и сохранению прогресса. На телефоне вторичные действия сворачиваются в один спокойный уровень." component="GameResult, ResultActionBar" />
            <div className="ui-kit-preview-controls">
              <Tabs label="Исход игры" value={resultPreview} onChange={setResultPreview} items={[{ id: 'won', label: 'Победа' }, { id: 'lost', label: 'Ответ открыт' }]} />
              <Tabs label="Состояние аккаунта" value={accountPreview} onChange={setAccountPreview} items={[{ id: 'guest', label: 'Гость' }, { id: 'authenticated', label: 'В аккаунте' }]} />
            </div>
            <div className="ui-kit-result-action">
              <GameResult
                mode="series"
                won={resultPreview === 'won'}
                attempts={4}
                poster={<img src={publicAssetUrl('images/category-stubs/movie-stub.webp')} alt="Постер демонстрационного результата" />}
                title="Джон Ф. Кеннеди: выстрелы в Далласе"
                meta="JFK, 1991, триллер"
                tags={['триллер', 'драма', 'история']}
                completedToday={4}
                nextRewardText="До полного маршрута: ещё 6"
                nextLabel="Играть дальше: Кино"
                nextActionLabel="Играть"
                nextMode="movie"
                configureLabel="Период / свободная игра"
                award={{
                  total: resultPreview === 'won' ? 11 : 3,
                  base: resultPreview === 'won' ? 11 : 3,
                  completed: 2,
                  win: resultPreview === 'won' ? 5 : 0,
                  speed: resultPreview === 'won' ? 3 : 0,
                  firstDaily: 1,
                  milestoneBonus: 0,
                  fullHouse: 0,
                  streakMilestone: 0,
                  newDailyStreak: 5,
                  alreadyClaimed: false,
                }}
                streak={5}
                copied={false}
                telegramUrl="#"
                accountState={accountPreview}
                onNext={() => undefined}
                onConfigure={() => undefined}
                onChallenge={() => undefined}
                autoScroll={false}
              />
            </div>
          </section>

          <section className="ui-kit-section" id="leaderboard">
            <SectionTitle index="11" title="Таблица рейтинга" description="Общий компонент спецпоказов и результатов: светлая таблица, читаемые имена и баллы. На телефоне прогресс располагается под именем игрока." component="DtfLeaderboard" />
            <div className="ui-kit-leaderboard"><DtfLeaderboard data={leaderboardFixture} /></div>
          </section>

          <section className="ui-kit-section" id="feedback">
            <SectionTitle index="12" title="Состояния и обратная связь" description="Цвет усиливает смысл, но не заменяет текст или иконку. Прогресс и вкладки тоже являются общими компонентами." component="Feedback, Progress, Tabs" />
            {APPLICATION_DESIGN && <BrandLoader inline />}
            <div className="ui-kit-feedback-grid">
              <InlineAlert tone="success"><strong>Подсказка открыта.</strong> Режиссёр также работал над известной научно-фантастической картиной.</InlineAlert>
              <InlineAlert tone="danger"><strong>Не удалось сохранить.</strong> Длинное сообщение остаётся читаемым на телефоне и объясняет, что можно повторить действие без потери текущего прогресса.</InlineAlert>
              <div className="ui-kit-match-samples" aria-label="Состояния сравнения">
                <div data-state="exact"><strong>Совпадает</strong><span>Точное совпадение</span></div>
                <div data-state="partial"><strong>Близко</strong><span>Частичное совпадение</span></div>
                <div data-state="miss"><strong>Не совпадает</strong><span>Попробуйте другой вариант</span></div>
                <div data-state="unknown"><strong>Пока неизвестно</strong><span>Недостаточно данных</span></div>
              </div>
              <div className="ui-kit-status-list">
                <StatusBadge tone="success">Готово</StatusBadge>
                <StatusBadge tone="warning">Требует внимания</StatusBadge>
                <StatusBadge>Нейтральное состояние</StatusBadge>
              </div>
            </div>
            <div className="ui-kit-feedback-stack">
              <Tabs surface="dark" label="Пример навигации" value={activeTab} onChange={setActiveTab} items={[{ id: 'daily', label: 'Сегодня' }, { id: 'archive', label: 'Архив' }]} />
              <SegmentedProgress value={4} max={10} />
              {APPLICATION_DESIGN && <SegmentedProgress variant="composer" value={4} max={10} label="Твоя версия" valueLabel="Попытка 5 из 10" ariaLabel="Использовано попыток: 4 из 10" />}
              <LinearProgress value={6} max={20} label="пройдено" />
              <EmptyState icon={<PackageOpen />} title="Здесь пока пусто" description="Когда появятся результаты, они будут собраны этим же компонентом." action={<ActionButton variant="secondary">Открыть игры</ActionButton>} />
            </div>
            <div className="ui-kit-modal-demo">
              <div><span>Диалог</span><p>Модальные окна используют бумажную поверхность и сохраняют фокус внутри.</p></div>
              <ActionButton variant="secondary" onClick={() => setModalOpen(true)}>Открыть пример</ActionButton>
            </div>
            <div className="ui-kit-modal-demo">
              <div><span>Нижняя панель, BottomSheet</span><p>Короткая задача поверх текущего экрана. Содержимое прокручивается отдельно, действие остаётся снизу. Escape закрывает панель и возвращает фокус.</p></div>
              <ActionButton variant="secondary" onClick={() => setSheetOpen(true)}>Открыть нижнюю панель</ActionButton>
            </div>
            <div className="ui-kit-modal-demo">
              <div><span>Полноэкранный оффер</span><p>QuestTakeover, клубная кнопка и анимированная сцена. Пауза, Escape и возврат фокуса.</p></div>
              <ActionButton variant="secondary" onClick={() => setClubOfferOpen(true)}>Открыть оффер Клуба</ActionButton>
            </div>
            <div className="ui-kit-feedback-stack" aria-label="Пример строк выбора">
              <SelectionRow title="Сегодняшняя игра" description="Строка списка, выбранное состояние" selected={selectedRow === 'daily'} aria-pressed={selectedRow === 'daily'} onClick={() => setSelectedRow('daily')} />
              <SelectionRow title="Прошлая игра с длинным названием, которое переносится на небольшом экране" description="SelectionRow, обычное состояние" selected={selectedRow === 'archive'} aria-pressed={selectedRow === 'archive'} onClick={() => setSelectedRow('archive')} />
            </div>
          </section>
          <section className="ui-kit-section" id="poster-tickets" aria-label="Билеты-афиши">
            <SectionTitle index="—" title="Билеты-афиши" description="Локальное направление «Афиша»: крупная иллюстрация, читаемое описание и три состояния игры." component="CategoryTicket, layout=poster" />
            <details className="ui-kit-legacy-examples"><summary>Показать предыдущий вариант</summary>
            <div className="ui-kit-poster-grid">
              <CategoryTicket {...movieTicket} watermarkUrl={publicAssetUrl('images/title-posters/movie-ticket-poster.webp')} layout="poster" poolCount={500} status="new" attempts={null} onClick={() => undefined} />
              <CategoryTicket {...seriesTicket} watermarkUrl={publicAssetUrl('images/title-posters/series-ticket-poster.webp')} layout="poster" poolCount={500} status="active" attempts={4} onClick={() => undefined} />
              <CategoryTicket {...movieTicket} watermarkUrl={publicAssetUrl('images/title-posters/movie-ticket-poster.webp')} layout="poster" poolCount={500} status="completed" attempts={3} onClick={() => undefined} />
            </div>
            </details>
          </section>
        </div>
      </div>
    </main>

    <footer className="ui-kit-footer"><span>СХОДИТСЯ!, UI KIT</span><small>Живая система, 2026</small></footer>

    {clubOfferOpen && <StudyClubJoinDialog onClose={() => setClubOfferOpen(false)} />}
    {modalOpen && <Modal title="Общий зачёт" onClose={() => setModalOpen(false)}>
      <p className="modal-lead">Это штатное модальное окно на бумажной поверхности. Оно закрывается по кнопке, клику вне окна или клавише Escape.</p>
      <div className="ui-kit-modal-paper">
        <Trophy />
        <div><span>Место сегодня</span><strong>6 из 247</strong></div>
      </div>
    </Modal>}
    {sheetOpen && <BottomSheet title="Следующая версия" description="Пример отдельной задачи в контексте игры." onClose={() => setSheetOpen(false)} footer={<ActionButton onClick={() => setSheetOpen(false)}>Готово</ActionButton>}>
      <p>В нижней панели можно выбрать ответ, посмотреть историю или прочитать подсказку. Она использует общие шрифты, палитру и кнопки проекта.</p>
    </BottomSheet>}
  </div>
}

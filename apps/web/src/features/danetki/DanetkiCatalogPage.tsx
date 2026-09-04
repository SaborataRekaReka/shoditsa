import { useEffect, useMemo, useRef, useState } from 'react'
import type { DashboardResponse } from '@shoditsa/contracts'
import { ArrowRight, BookOpen, CheckCircle2, Clock3, HelpCircle, Play, Sparkles, Ticket } from 'lucide-react'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { AppHeader, ScreenBack } from '../../components/app-shell/AppShell'
import { ControlButton } from '../../components/ui'
import {
  DANETKI_CATALOG_ITEMS,
  danetkiCatalogPlayState,
  danetkiCatalogItemBySlug,
  danetkiDifficultyLabel,
  danetkiRelatedItems,
  danetkiStoryPath,
  type DanetkiCatalogItem,
} from './danetki-catalog'
import {
  DANETKI_COLLECTION_DEFINITIONS,
  danetkiCollectionDefinition,
  danetkiCollectionItems,
  type DanetkiCollectionSlug,
} from './danetki-collections'
import { DanetkiRecommendations } from './DanetkiRecommendations'
import './DanetkiCatalogPage.css'

type NavigationProps = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

type CatalogPlayProps = {
  access?: DashboardResponse['danetkiAccess']
  ticketBalance: number
  busy: boolean
  onTry: (item: DanetkiCatalogItem) => void
}

const playHref = (placement: 'catalog' | 'story', item?: DanetkiCatalogItem, collection?: DanetkiCollectionSlug) => {
  const search = new URLSearchParams({ from: placement })
  if (item) search.set('story', item.slug)
  if (collection) search.set('collection', collection)
  return `/games/danetki?${search.toString()}#game`
}

const trackPlayClick = (placement: 'catalog' | 'story', item?: DanetkiCatalogItem, collection?: DanetkiCollectionSlug) => {
  const payload = { placement, story: item?.slug ?? null, itemId: item?.id ?? null, collection: collection ?? 'all' }
  trackClientEvent('danetki_catalog_play_clicked', payload)
  trackMetrikaGoal('danetki_catalog_play_clicked', payload)
}

const GENERAL_CATALOG_PARAGRAPHS = [
  'Данетки — это логические загадки, в которых известно только необычное происшествие. Игроки восстанавливают скрытую причинно-следственную связь вопросами, на которые ведущий отвечает «да» или «нет».',
  'В каталоге собраны редакционные истории разной сложности. У каждой есть условие, стартовые вопросы и полный ответ под спойлером, а выбранную данетку можно разыграть с ведущим без раскрытия решения.',
] as const

const GENERAL_GUIDE_STEPS = [
  'Прочитайте условие и отделите факты от предположений.',
  'Проверяйте место, время, мотив и роли участников вопросами «да» или «нет».',
  'Соберите версию, объясняющую каждую странность условия, и только затем откройте ответ.',
] as const

const StoryCard = ({ item, index, placement, access, ticketBalance, busy, onTry }: {
  item: DanetkiCatalogItem
  index: number
  placement: 'catalog' | 'story'
} & CatalogPlayProps) => {
  const { dailyAvailable, cost, shortage } = danetkiCatalogPlayState(access, ticketBalance)
  const disabled = busy || !access || shortage > 0
  const accessLabel = !access
    ? 'Проверяем доступ…'
    : dailyAvailable
      ? 'Бесплатно сегодня'
      : cost === 0
        ? 'Включено в клуб'
        : `${cost} билетов`
  const buttonTitle = !access
    ? 'Проверяем доступ к игре'
    : shortage > 0
    ? `Не хватает ${shortage} билетов`
    : dailyAvailable
      ? 'Использовать бесплатную данетку на сегодня'
      : cost === 0
        ? 'Начать клубную игру'
        : `Начать игру за ${cost} билетов`

  return <article className="danetki-catalog-card">
    <div className="danetki-catalog-card__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
    <div className="danetki-catalog-card__copy">
      <div className="danetki-catalog-card__meta">
        <span>{danetkiDifficultyLabel(item.difficulty)}</span>
        {item.genres.slice(0, 1).map((genre) => <span key={genre}>{genre}</span>)}
        <span><Clock3 aria-hidden="true" /> {item.estimatedMinutes} мин</span>
      </div>
      <h2><a href={danetkiStoryPath(item)}>{item.titleRu}</a></h2>
      <p>{item.condition}</p>
      <div className="danetki-catalog-card__actions">
        <a className="danetki-catalog-card__action danetki-catalog-card__action--open" href={danetkiStoryPath(item)}><BookOpen aria-hidden="true" /> Открыть</a>
        <ControlButton
          className="danetki-catalog-card__action danetki-catalog-card__action--try"
          disabled={disabled}
          title={buttonTitle}
          aria-label={`Попробовать «${item.titleRu}». ${shortage > 0 ? buttonTitle : accessLabel}`}
          onClick={() => {
            trackPlayClick(placement, item)
            onTry(item)
          }}
        ><Play aria-hidden="true" /> {busy ? 'Запускаем…' : 'Попробовать'}</ControlButton>
      </div>
      <span className={`danetki-catalog-card__play-note${shortage > 0 ? ' is-unavailable' : ''}`}>
        {!access || dailyAvailable ? <Sparkles aria-hidden="true" /> : <Ticket aria-hidden="true" />}
        {shortage > 0 ? buttonTitle : accessLabel}
      </span>
    </div>
  </article>
}

export function DanetkiCatalogPage({ collection, access, ticketBalance, busy, onTry, ...props }: NavigationProps & CatalogPlayProps & { collection?: DanetkiCollectionSlug }) {
  const collectionDefinition = collection ? danetkiCollectionDefinition(collection) : null
  const scopeItems = useMemo(() => collection
    ? danetkiCollectionItems(collection)
    : DANETKI_CATALOG_ITEMS, [collection])
  const [filter, setFilter] = useState<'all' | 'easy' | 'medium' | 'hard' | 'family' | 'classic'>('all')
  const filteredItems = useMemo(() => scopeItems.filter((item) => filter === 'all'
    || item.difficulty === filter
    || (filter === 'family' && item.audience === 'family')
    || (filter === 'classic' && item.isClassic)), [filter, scopeItems])
  const filters = [
    { id: 'all' as const, label: 'Все', count: scopeItems.length },
    { id: 'easy' as const, label: 'Лёгкие', count: scopeItems.filter((item) => item.difficulty === 'easy').length },
    { id: 'medium' as const, label: 'Средние', count: scopeItems.filter((item) => item.difficulty === 'medium').length },
    { id: 'hard' as const, label: 'Сложные', count: scopeItems.filter((item) => item.difficulty === 'hard').length },
    { id: 'family' as const, label: 'Для семьи', count: scopeItems.filter((item) => item.audience === 'family').length },
    { id: 'classic' as const, label: 'Классические', count: scopeItems.filter((item) => item.isClassic).length },
  ]
  useEffect(() => {
    const payload = { stories: scopeItems.length, collection: collection ?? 'all' }
    trackClientEvent('danetki_catalog_view', payload)
    trackMetrikaGoal('danetki_catalog_view', payload)
  }, [collection, scopeItems.length])

  return <div className="danetki-catalog-page">
    <AppHeader {...props} />
    <main className="danetki-catalog-main">
      <ScreenBack href="/games/danetki" label="К игре" />
      <nav className="danetki-breadcrumbs" aria-label="Хлебные крошки"><a href="/">Сходится!</a><span>/</span>{collectionDefinition && <><a href="/danetki">Данетки</a><span>/</span></>}<span>{collectionDefinition?.heading ?? 'Данетки с ответами'}</span></nav>

      <header className="danetki-catalog-hero">
        <div className="danetki-catalog-hero__copy">
          <span className="danetki-catalog-eyebrow"><Sparkles aria-hidden="true" /> {collectionDefinition?.eyebrow ?? 'Каталог логических историй'}</span>
          <h1>{collectionDefinition?.heading ?? 'Данетки с ответами'}</h1>
          <p>{collectionDefinition?.lead ?? 'Сначала попробуйте восстановить скрытую историю самостоятельно. Если версия не сходится — откройте стартовые вопросы и авторскую разгадку.'}</p>
          <div className="danetki-catalog-hero__actions">
            <a className="ui-button ui-button--primary" href={playHref('catalog', undefined, collection)} onClick={() => trackPlayClick('catalog', undefined, collection)}><Play aria-hidden="true" /> Играть с ведущим</a>
            <a className="ui-button ui-button--secondary" href={`${collectionDefinition?.canonicalPath ?? '/danetki'}#stories`}><BookOpen aria-hidden="true" /> Смотреть истории</a>
          </div>
        </div>
        <dl className="danetki-catalog-facts">
          <div><dt>{collectionDefinition?.countLabel ?? 'Историй сейчас'}</dt><dd>{scopeItems.length}</dd></div>
          <div><dt>{collectionDefinition?.factLabel ?? 'Формат'}</dt><dd>{collectionDefinition?.factValue ?? 'Да · Нет'}</dd></div>
          <div><dt>Ответы</dt><dd>Под спойлером</dd></div>
        </dl>
      </header>

      <nav className="danetki-catalog-collections" aria-label="Тематические подборки данеток">
        <a className={!collection ? 'is-current' : ''} href="/danetki"><span>Все истории</span><strong>{DANETKI_CATALOG_ITEMS.length}</strong></a>
        {DANETKI_COLLECTION_DEFINITIONS.map((entry) => <a className={collection === entry.slug ? 'is-current' : ''} href={entry.canonicalPath} key={entry.slug}><span>{entry.internalLinkLabel}</span><strong>{danetkiCollectionItems(entry.slug).length}</strong></a>)}
      </nav>

      <section className="danetki-catalog-list" id="stories" aria-labelledby="danetki-stories-title">
        <div className="danetki-catalog-section-head">
          <div><span>Подборка редакции</span><h2 id="danetki-stories-title">{collectionDefinition?.sectionHeading ?? (filter === 'all' ? 'Все данетки' : filters.find((entry) => entry.id === filter)?.label)}</h2></div>
          <p>{collectionDefinition?.sectionLead(scopeItems.length) ?? `${filteredItems.length} историй · выбирайте по сложности и настроению.`}</p>
        </div>
        {!collectionDefinition && <div className="danetki-catalog-filters" role="group" aria-label="Фильтр данеток">
          {filters.map((entry) => <ControlButton key={entry.id} type="button" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}><span>{entry.label}</span><strong>{entry.count}</strong></ControlButton>)}
        </div>}
        <div className="danetki-catalog-grid">{filteredItems.map((item, index) => <StoryCard key={item.id} item={item} index={index} placement="catalog" access={access} ticketBalance={ticketBalance} busy={busy} onTry={onTry} />)}</div>
      </section>

      <section className="danetki-catalog-copy" aria-labelledby="danetki-copy-title">
        <span className="danetki-catalog-eyebrow"><BookOpen aria-hidden="true" /> По существу</span>
        <h2 id="danetki-copy-title">{collectionDefinition?.contentHeading ?? 'Что такое данетки и как в них играть'}</h2>
        <div>{(collectionDefinition?.paragraphs ?? GENERAL_CATALOG_PARAGRAPHS).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
      </section>

      <section className="danetki-catalog-guide" aria-labelledby="danetki-guide-title">
        <span className="danetki-catalog-eyebrow"><HelpCircle aria-hidden="true" /> Короткие правила</span>
        <h2 id="danetki-guide-title">{collectionDefinition?.guideHeading ?? 'Как решать данетки'}</h2>
        <ol>
          {(collectionDefinition?.guideSteps ?? GENERAL_GUIDE_STEPS).map((step, index) => <li key={step}><strong>{String(index + 1).padStart(2, '0')}</strong><span>{step}</span></li>)}
        </ol>
      </section>
      <DanetkiRecommendations placement="catalog-bottom" />
    </main>
  </div>
}

export function DanetkiStoryPage({ slug, access, ticketBalance, busy, onTry, ...props }: NavigationProps & CatalogPlayProps & { slug: string }) {
  const item = danetkiCatalogItemBySlug(slug)
  const answerTracked = useRef(false)

  useEffect(() => {
    if (!item) return
    const payload = { story: item.slug, itemId: item.id, difficulty: item.difficulty }
    trackClientEvent('danetki_story_view', payload)
    trackMetrikaGoal('danetki_story_view', payload)
  }, [item])

  if (!item) return <div className="danetki-catalog-page"><AppHeader {...props} /><main className="danetki-catalog-main"><ScreenBack href="/danetki" label="К каталогу" /><section className="danetki-story-missing"><HelpCircle /><h1>Такой данетки нет</h1><p>Возможно, ссылка устарела. Вернитесь к актуальной подборке.</p><a className="ui-button ui-button--primary" href="/danetki">Открыть каталог</a></section></main></div>

  const related = danetkiRelatedItems(item)
  const storyKey = item.slug
  const onAnswerToggle = (open: boolean) => {
    if (!open || answerTracked.current) return
    answerTracked.current = true
    const payload = { story: storyKey, difficulty: item.difficulty }
    trackClientEvent('danetki_story_answer_opened', payload)
    trackMetrikaGoal('danetki_story_answer_opened', payload)
  }

  return <div className="danetki-catalog-page">
    <AppHeader {...props} />
    <main className="danetki-catalog-main danetki-story-main">
      <ScreenBack href="/danetki" label="К каталогу" />
      <nav className="danetki-breadcrumbs" aria-label="Хлебные крошки"><a href="/">Сходится!</a><span>/</span><a href="/danetki">Данетки</a><span>/</span><span>{item.titleRu}</span></nav>

      <article className="danetki-story">
        <header className="danetki-story__header">
          <div>
            <span className="danetki-catalog-eyebrow"><Sparkles aria-hidden="true" /> Данетка с ответом</span>
            <h1>{item.slug === 'albatros' ? 'Данетка про альбатроса' : item.titleRu}</h1>
            {item.alternativeTitles.length > 0 && <p className="danetki-story__aliases">Также известна как: {item.alternativeTitles.join(', ')}</p>}
            <div className="danetki-story__tags"><span>{danetkiDifficultyLabel(item.difficulty)}</span>{item.genres.map((genre) => <span key={genre}>{genre}</span>)}</div>
          </div>
          <div className="danetki-story__stamp" aria-hidden="true"><small>Дело</small><strong>{storyKey.slice(0, 2).toUpperCase()}</strong></div>
        </header>

        <section className="danetki-story__condition" aria-labelledby="condition-title">
          <span>Условие</span><h2 id="condition-title">Что произошло?</h2><p>{item.condition}</p>
        </section>

        <section className="danetki-story__questions" aria-labelledby="questions-title">
          <span>Если не знаете, с чего начать</span><h2 id="questions-title">Стартовые вопросы</h2>
          <ul>{item.starterQuestions.map((question) => <li key={question}><HelpCircle aria-hidden="true" /><span>{question}</span></li>)}</ul>
        </section>

        <aside className="danetki-story__play">
          <div><span>Ответ пока скрыт</span><h2>Сначала попробуйте сыграть</h2><p>Ведущий отвечает «да», «нет» или «неважно» и помогает шаг за шагом восстановить историю.</p></div>
          <ControlButton
            className="ui-button ui-button--primary"
            disabled={busy || !access || (access.dailyRoomsStarted > 0 && access.nextSoloCost > ticketBalance)}
            onClick={() => {
              trackPlayClick('story', item)
              onTry(item)
            }}
          ><Play aria-hidden="true" /> {busy ? 'Запускаем…' : 'Играть с ведущим'}</ControlButton>
        </aside>

        <details className="danetki-story__answer" onToggle={(event) => onAnswerToggle(event.currentTarget.open)}>
          <summary><span><strong><span className="danetki-story__answer-label--closed">Все равно показать</span><span className="danetki-story__answer-label--open">Скрыть ответ</span></strong><small>Откроется готовая разгадка</small></span><span aria-hidden="true">+</span></summary>
          <div><span><CheckCircle2 aria-hidden="true" /> Авторская разгадка</span><p>{item.solution}</p></div>
        </details>
      </article>

      <section className="danetki-story-related" aria-labelledby="related-title"><div className="danetki-catalog-section-head"><div><span>Следующие дела</span><h2 id="related-title">Похожие данетки</h2></div><a href="/danetki">Все истории <ArrowRight /></a></div><div className="danetki-catalog-grid">{related.map((candidate, index) => <StoryCard key={candidate.id} item={candidate} index={index} placement="story" access={access} ticketBalance={ticketBalance} busy={busy} onTry={onTry} />)}</div></section>
    </main>
  </div>
}

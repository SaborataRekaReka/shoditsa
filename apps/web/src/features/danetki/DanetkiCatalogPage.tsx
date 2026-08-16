import { useEffect, useRef } from 'react'
import { ArrowRight, BookOpen, CheckCircle2, HelpCircle, Play, Sparkles } from 'lucide-react'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { AppHeader, ScreenBack } from '../../components/app-shell/AppShell'
import {
  DANETKI_CATALOG_ITEMS,
  danetkiCatalogItemBySlug,
  danetkiDifficultyLabel,
  danetkiSlug,
  danetkiStoryPath,
  type DanetkiCatalogItem,
} from './danetki-catalog'
import './DanetkiCatalogPage.css'

type NavigationProps = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

const playHref = (placement: 'catalog' | 'story', item?: DanetkiCatalogItem) => {
  const search = new URLSearchParams({ from: placement })
  if (item) search.set('story', danetkiSlug(item.titleRu))
  return `/games/danetki?${search.toString()}#game`
}

const trackPlayClick = (placement: 'catalog' | 'story', item?: DanetkiCatalogItem) => {
  const payload = { placement, story: item ? danetkiSlug(item.titleRu) : null }
  trackClientEvent('danetki_catalog_play_clicked', payload)
  trackMetrikaGoal('danetki_catalog_play_clicked', payload)
}

const StoryCard = ({ item, index }: { item: DanetkiCatalogItem; index: number }) => <article className="danetki-catalog-card">
  <div className="danetki-catalog-card__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
  <div className="danetki-catalog-card__copy">
    <div className="danetki-catalog-card__meta">
      <span>{danetkiDifficultyLabel(item.difficulty)}</span>
      {item.genres.slice(0, 1).map((genre) => <span key={genre}>{genre}</span>)}
    </div>
    <h2><a href={danetkiStoryPath(item)}>{item.titleRu}</a></h2>
    <p>{item.condition}</p>
    <a className="danetki-catalog-card__action" href={danetkiStoryPath(item)}>Проверить свою версию <ArrowRight aria-hidden="true" /></a>
  </div>
</article>

export function DanetkiCatalogPage(props: NavigationProps) {
  useEffect(() => {
    trackClientEvent('danetki_catalog_view', { stories: DANETKI_CATALOG_ITEMS.length })
    trackMetrikaGoal('danetki_catalog_view', { stories: DANETKI_CATALOG_ITEMS.length })
  }, [])

  return <div className="danetki-catalog-page">
    <AppHeader {...props} />
    <main className="danetki-catalog-main">
      <ScreenBack href="/games/danetki" label="К игре" />
      <nav className="danetki-breadcrumbs" aria-label="Хлебные крошки"><a href="/">Сходится!</a><span>/</span><span>Данетки с ответами</span></nav>

      <header className="danetki-catalog-hero">
        <div className="danetki-catalog-hero__copy">
          <span className="danetki-catalog-eyebrow"><Sparkles aria-hidden="true" /> Каталог логических историй</span>
          <h1>Данетки с ответами</h1>
          <p>Сначала попробуйте восстановить скрытую историю самостоятельно. Если версия не сходится — откройте стартовые вопросы и авторскую разгадку.</p>
          <div className="danetki-catalog-hero__actions">
            <a className="ui-button ui-button--primary" href={playHref('catalog')} onClick={() => trackPlayClick('catalog')}><Play aria-hidden="true" /> Играть с ИИ без спойлеров</a>
            <a className="ui-button ui-button--secondary" href="#stories"><BookOpen aria-hidden="true" /> Смотреть истории</a>
          </div>
        </div>
        <dl className="danetki-catalog-facts">
          <div><dt>Историй сейчас</dt><dd>{DANETKI_CATALOG_ITEMS.length}</dd></div>
          <div><dt>Формат</dt><dd>Да · Нет</dd></div>
          <div><dt>Ответы</dt><dd>Под спойлером</dd></div>
        </dl>
      </header>

      <section className="danetki-catalog-list" id="stories" aria-labelledby="danetki-stories-title">
        <div className="danetki-catalog-section-head">
          <div><span>Подборка редакции</span><h2 id="danetki-stories-title">Все данетки</h2></div>
          <p>Новые истории будут добавляться после редакционной проверки.</p>
        </div>
        <div className="danetki-catalog-grid">{DANETKI_CATALOG_ITEMS.map((item, index) => <StoryCard key={item.id} item={item} index={index} />)}</div>
      </section>

      <section className="danetki-catalog-guide" aria-labelledby="danetki-guide-title">
        <span className="danetki-catalog-eyebrow"><HelpCircle aria-hidden="true" /> Короткие правила</span>
        <h2 id="danetki-guide-title">Как решать данетки</h2>
        <ol>
          <li><strong>01</strong><span>Прочитайте условие и отделите факты от предположений.</span></li>
          <li><strong>02</strong><span>Проверяйте место, время, мотив и роли участников вопросами «да» или «нет».</span></li>
          <li><strong>03</strong><span>Соберите версию, объясняющую каждую странность условия, и только затем откройте ответ.</span></li>
        </ol>
      </section>
    </main>
  </div>
}

export function DanetkiStoryPage({ slug, ...props }: NavigationProps & { slug: string }) {
  const item = danetkiCatalogItemBySlug(slug)
  const answerTracked = useRef(false)

  useEffect(() => {
    if (!item) return
    const payload = { story: danetkiSlug(item.titleRu), difficulty: item.difficulty }
    trackClientEvent('danetki_story_view', payload)
    trackMetrikaGoal('danetki_story_view', payload)
  }, [item])

  if (!item) return <div className="danetki-catalog-page"><AppHeader {...props} /><main className="danetki-catalog-main"><ScreenBack href="/danetki" label="К каталогу" /><section className="danetki-story-missing"><HelpCircle /><h1>Такой данетки нет</h1><p>Возможно, ссылка устарела. Вернитесь к актуальной подборке.</p><a className="ui-button ui-button--primary" href="/danetki">Открыть каталог</a></section></main></div>

  const related = DANETKI_CATALOG_ITEMS.filter((candidate) => candidate.id !== item.id).slice(0, 3)
  const storyKey = danetkiSlug(item.titleRu)
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
            <h1>{item.titleRu}</h1>
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

        <details className="danetki-story__answer" onToggle={(event) => onAnswerToggle(event.currentTarget.open)}>
          <summary><span><strong><span className="danetki-story__answer-label--closed">Показать ответ</span><span className="danetki-story__answer-label--open">Скрыть ответ</span></strong><small>Откройте, когда соберёте свою версию</small></span><span aria-hidden="true">+</span></summary>
          <div><span><CheckCircle2 aria-hidden="true" /> Авторская разгадка</span><p>{item.solution}</p></div>
        </details>

        <aside className="danetki-story__play">
          <div><span>Хотите настоящее расследование?</span><h2>Задавайте вопросы ИИ-ведущему</h2><p>В игре ответ скрыт: ведущий реагирует на версии и помогает шаг за шагом восстановить историю.</p></div>
          <a className="ui-button ui-button--primary" href={playHref('story', item)} onClick={() => trackPlayClick('story', item)}><Play aria-hidden="true" /> Играть без спойлеров</a>
        </aside>
      </article>

      <section className="danetki-story-related" aria-labelledby="related-title"><div className="danetki-catalog-section-head"><div><span>Следующие дела</span><h2 id="related-title">Похожие данетки</h2></div><a href="/danetki">Все истории <ArrowRight /></a></div><div className="danetki-catalog-grid">{related.map((candidate, index) => <StoryCard key={candidate.id} item={candidate} index={index} />)}</div></section>
    </main>
  </div>
}

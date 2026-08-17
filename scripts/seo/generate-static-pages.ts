import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DEFAULT_SOCIAL_IMAGE_PATH,
  GAME_GUIDE_PRESENTATION,
  HOME_SEO,
  INDEXABLE_GAME_SEO,
  INDEXABLE_ROBOTS,
  SITE_NAME,
  SITE_ORIGIN,
  type GameSeoContent,
  type SeoPageContent,
} from '../../apps/web/src/app/seo-content'
import { seoRouteFromPathname, structuredDataForSeoRoute } from '../../apps/web/src/app/seo'
import { LEGAL_DOCUMENT_SLUGS } from '../../apps/web/src/features/legal/legal'
import {
  DANETKI_CATALOG_ITEMS,
  danetkiDifficultyLabel,
  danetkiRelatedItems,
  danetkiStoryPath,
  type DanetkiCatalogItem,
} from '../../apps/web/src/features/danetki/danetki-catalog'
import {
  DANETKI_COLLECTION_DEFINITIONS,
  danetkiCatalogItemsForPathname,
  danetkiCollectionFromPathname,
  danetkiCollectionItems,
} from '../../apps/web/src/features/danetki/danetki-collections'

const distRoot = resolve('dist')
const INDEXABLE_UTILITY_PATHS = ['/partners', '/specials', '/club'] as const
const TITLE_POSTER_PATHS: Partial<Record<GameSeoContent['mode'], string>> = {
  movie: '/images/title-posters/movie-ticket-poster.avif',
  series: '/images/title-posters/series-ticket-poster.avif',
  anime: '/images/title-posters/anime-ticket-poster.avif',
  game: '/images/title-posters/game-ticket-poster.avif',
  city: '/images/title-posters/city-ticket-poster.avif',
  music: '/images/title-posters/music-ticket-poster.avif',
  diagnosis: '/images/title-posters/diagnosis-ticket-poster.avif',
  animal: '/images/title-posters/animal-ticket-poster.avif',
  book: '/images/title-posters/book-ticket-poster-v2.avif',
  character: '/images/title-posters/character-ticket-poster.webp',
  danetki: '/images/title-posters/danetki-ticket-poster.avif',
}
const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const escapeXml = escapeHtml

const upsertMeta = (html: string, attribute: 'name' | 'property', key: string, content: string) => {
  const pattern = new RegExp(`<meta\\s+${attribute}="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`, 'i')
  const tag = `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `  ${tag}\n</head>`)
}

const upsertCanonical = (html: string, href: string) => {
  const tag = `<link rel="canonical" href="${escapeHtml(href)}" />`
  return /<link\s+rel="canonical"[^>]*>/i.test(html)
    ? html.replace(/<link\s+rel="canonical"[^>]*>/i, tag)
    : html.replace('</head>', `  ${tag}\n</head>`)
}

const addImagePreload = (html: string, href: string) => html.replace(
  '</head>',
  `  <link rel="preload" as="image" href="${escapeHtml(href)}" type="image/avif" fetchpriority="high" />\n</head>`,
)

const setJsonLd = (html: string, value: unknown) => {
  const json = JSON.stringify(value).replace(/</g, '\\u003c')
  const script = `<script type="application/ld+json" id="seo-json-ld">${json}</script>`
  const pattern = /<script\s+type="application\/ld\+json"\s+id="seo-json-ld">[^]*?<\/script>/i
  return pattern.test(html) ? html.replace(pattern, script) : html.replace('</head>', `  ${script}\n</head>`)
}

const renderParagraphs = (content: SeoPageContent) => content.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')
const renderGameLinks = (currentMode?: GameSeoContent['mode']) => INDEXABLE_GAME_SEO
  .filter((game) => game.mode !== currentMode)
  .map((game) => `<a href="${game.canonicalPath}">${escapeHtml(game.internalLinkLabel ?? game.shortName)}</a>`)
  .join('')
const renderRelatedGameLinks = (content: GameSeoContent) => content.relatedModes?.length
  ? `<nav class="ticket-search-summary__related" aria-label="Похожие игры"><span>Попробуйте также</span><div>${content.relatedModes.map((mode) => {
      const related = INDEXABLE_GAME_SEO.find((game) => game.mode === mode)
      return related ? `<a href="${related.canonicalPath}">${escapeHtml(related.internalLinkLabel ?? related.shortName)}</a>` : ''
    }).join('')}</div></nav>`
  : ''
const renderSearchSummary = (content: GameSeoContent) => content.searchSummary
  ? `<section class="ticket-search-summary ticket-search-summary--${content.mode}" aria-labelledby="search-summary-${content.mode}"><span>Играть онлайн · без спойлеров</span><h2 id="search-summary-${content.mode}">${escapeHtml(content.searchSummary.heading)}</h2><div>${content.searchSummary.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</div>${content.searchSummary.action ? `<a href="${escapeHtml(content.searchSummary.action.href)}">${escapeHtml(content.searchSummary.action.label)}<span aria-hidden="true">↗</span></a>` : ''}${renderRelatedGameLinks(content)}</section>`
  : ''
const renderHubGuideSummary = () => `<summary class="hub-guide__summary"><span class="hub-guide__summary-title"><span aria-hidden="true">▤</span><span><strong class="hub-guide__closed-label">Как устроены ежедневные игры</strong><strong class="hub-guide__open-label">Путеводитель по «Сходится!»</strong></span></span><small>формат · подсказки · все режимы</small><span class="hub-guide__summary-chevron" aria-hidden="true">⌄</span></summary>`

const renderHomeFallback = () => `<main class="seo-static-shell seo-static-shell--home"><article class="hub-hero-ticket hub-hero-ticket--static"><section class="hub-hero"><div class="hub-hero__copy"><div class="hub-hero__facts" aria-label="Об игре"><span><strong>11 игр</strong></span><span><strong>1 загадка в день</strong></span><span><strong>10 попыток</strong></span></div><h1>${escapeHtml(HOME_SEO.heading)}</h1><p>${escapeHtml(HOME_SEO.lead)}</p><div class="hub-hero__actions"><a class="ui-button ui-button--primary" href="#hub-guide">Узнать больше</a><a class="ui-button ui-button--secondary" href="/games/movie">Играть сейчас</a></div></div><div class="hub-hero__visual" aria-hidden="true"><img src="/images/hero.webp" alt="" width="1122" height="913"></div></section><details class="hub-guide" id="hub-guide">${renderHubGuideSummary()}<div class="hub-guide__drawer"><header class="hub-guide__intro"><span>Путеводитель · без спойлеров</span><h2>${escapeHtml(HOME_SEO.heading)}</h2><p>${escapeHtml(HOME_SEO.lead)}</p></header><div class="hub-guide__content"><section class="hub-guide__story" aria-label="О платформе">${renderParagraphs(HOME_SEO)}</section><nav class="hub-guide__game-links" aria-label="Все ежедневные игры"><span>↗ Все игровые маршруты</span><div>${renderGameLinks()}</div></nav></div></div></details></article></main>`
const renderUtilityFallback = (content: SeoPageContent) => `<main class="seo-static-shell seo-static-shell--home"><article class="hub-hero-ticket hub-hero-ticket--static"><section class="hub-hero"><div class="hub-hero__copy"><h1>${escapeHtml(content.heading)}</h1><p>${escapeHtml(content.lead || content.description)}</p><div class="hub-hero__actions"><a class="ui-button ui-button--primary" href="${escapeHtml(content.canonicalPath)}">Открыть страницу</a><a class="ui-button ui-button--secondary" href="/">К играм</a></div></div></section><details class="hub-guide" open><summary class="hub-guide__summary"><span class="hub-guide__summary-title"><strong>Подробнее</strong></span></summary><div class="hub-guide__drawer"><header class="hub-guide__intro"><h2>${escapeHtml(content.heading)}</h2><p>${escapeHtml(content.lead || content.description)}</p></header><div class="hub-guide__content"><section class="hub-guide__story">${renderParagraphs(content)}</section></div></div></details></article></main>`

const renderDanetkiCard = (item: DanetkiCatalogItem, index: number) => `<article class="danetki-catalog-card"><div class="danetki-catalog-card__number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</div><div class="danetki-catalog-card__copy"><div class="danetki-catalog-card__meta"><span>${escapeHtml(danetkiDifficultyLabel(item.difficulty))}</span>${item.genres.slice(0, 1).map((genre) => `<span>${escapeHtml(genre)}</span>`).join('')}<span>${item.estimatedMinutes} мин</span></div><h2><a href="${escapeHtml(danetkiStoryPath(item))}">${escapeHtml(item.titleRu)}</a></h2><p>${escapeHtml(item.condition)}</p><a class="danetki-catalog-card__action" href="${escapeHtml(danetkiStoryPath(item))}">Проверить свою версию <span aria-hidden="true">→</span></a></div></article>`

const GENERAL_DANETKI_GUIDE_STEPS = [
  'Прочитайте условие и отделите факты от предположений.',
  'Проверяйте место, время, мотив и роли участников вопросами «да» или «нет».',
  'Соберите версию, объясняющую каждую странность условия, и только затем откройте ответ.',
] as const

const renderDanetkiCollectionLinks = (currentPath: string) => `<nav class="danetki-catalog-collections" aria-label="Тематические подборки данеток"><a${currentPath === '/danetki' ? ' class="is-current"' : ''} href="/danetki"><span>Все истории</span><strong>${DANETKI_CATALOG_ITEMS.length}</strong></a>${DANETKI_COLLECTION_DEFINITIONS.map((entry) => `<a${currentPath === entry.canonicalPath ? ' class="is-current"' : ''} href="${entry.canonicalPath}"><span>${escapeHtml(entry.internalLinkLabel)}</span><strong>${danetkiCollectionItems(entry.slug).length}</strong></a>`).join('')}</nav>`

const renderDanetkiCatalogFallback = (content: SeoPageContent) => {
  const collection = danetkiCollectionFromPathname(content.canonicalPath)
  const items = danetkiCatalogItemsForPathname(content.canonicalPath)
  const guideSteps = collection?.guideSteps ?? GENERAL_DANETKI_GUIDE_STEPS
  const playSearch = collection ? `?from=catalog&amp;collection=${collection.slug}` : '?from=catalog'
  const breadcrumbParent = collection ? '<a href="/danetki">Данетки</a><span>/</span>' : ''
  const factLabel = collection?.factLabel ?? 'Формат'
  const factValue = collection?.factValue ?? 'Да · Нет'
  const sectionHeading = collection?.sectionHeading ?? 'Все данетки'
  const sectionLead = collection?.sectionLead(items.length) ?? `${items.length} историй · выбирайте по сложности и настроению.`
  const copyHeading = collection?.contentHeading ?? 'Что такое данетки и как в них играть'
  return `<main class="danetki-catalog-main"><nav class="danetki-breadcrumbs" aria-label="Хлебные крошки"><a href="/">Сходится!</a><span>/</span>${breadcrumbParent}<span>${escapeHtml(content.heading)}</span></nav><header class="danetki-catalog-hero"><div class="danetki-catalog-hero__copy"><span class="danetki-catalog-eyebrow">${escapeHtml(collection?.eyebrow ?? 'Каталог логических историй')}</span><h1>${escapeHtml(content.heading)}</h1><p>${escapeHtml(content.lead)}</p><div class="danetki-catalog-hero__actions"><a class="ui-button ui-button--primary" href="/games/danetki${playSearch}#game">Играть с ИИ без спойлеров</a><a class="ui-button ui-button--secondary" href="#stories">Смотреть истории</a></div></div><dl class="danetki-catalog-facts"><div><dt>${escapeHtml(collection?.countLabel ?? 'Историй сейчас')}</dt><dd>${items.length}</dd></div><div><dt>${escapeHtml(factLabel)}</dt><dd>${escapeHtml(factValue)}</dd></div><div><dt>Ответы</dt><dd>Под спойлером</dd></div></dl></header>${renderDanetkiCollectionLinks(content.canonicalPath)}<section class="danetki-catalog-list" id="stories"><div class="danetki-catalog-section-head"><div><span>Подборка редакции</span><h2>${escapeHtml(sectionHeading)}</h2></div><p>${escapeHtml(sectionLead)}</p></div><div class="danetki-catalog-grid">${items.map(renderDanetkiCard).join('')}</div></section><section class="danetki-catalog-copy"><span class="danetki-catalog-eyebrow">По существу</span><h2>${escapeHtml(copyHeading)}</h2><div>${renderParagraphs(content)}</div></section><section class="danetki-catalog-guide"><span class="danetki-catalog-eyebrow">Короткие правила</span><h2>${escapeHtml(collection?.guideHeading ?? 'Как решать данетки')}</h2><ol>${guideSteps.map((step, index) => `<li><strong>${String(index + 1).padStart(2, '0')}</strong><span>${escapeHtml(step)}</span></li>`).join('')}</ol></section></main>`
}

const renderDanetkiStoryFallback = (item: DanetkiCatalogItem) => {
  const related = danetkiRelatedItems(item)
  const aliases = item.alternativeTitles.length ? `<p class="danetki-story__aliases">Также известна как: ${item.alternativeTitles.map(escapeHtml).join(', ')}</p>` : ''
  const heading = item.slug === 'albatros' ? 'Данетка про альбатроса' : item.titleRu
  return `<main class="danetki-catalog-main danetki-story-main"><nav class="danetki-breadcrumbs" aria-label="Хлебные крошки"><a href="/">Сходится!</a><span>/</span><a href="/danetki">Данетки</a><span>/</span><span>${escapeHtml(item.titleRu)}</span></nav><article class="danetki-story"><header class="danetki-story__header"><div><span class="danetki-catalog-eyebrow">Данетка с ответом</span><h1>${escapeHtml(heading)}</h1>${aliases}<div class="danetki-story__tags"><span>${escapeHtml(danetkiDifficultyLabel(item.difficulty))}</span>${item.genres.map((genre) => `<span>${escapeHtml(genre)}</span>`).join('')}</div></div></header><section class="danetki-story__condition"><span>Условие</span><h2>Что произошло?</h2><p>${escapeHtml(item.condition)}</p></section><section class="danetki-story__questions"><span>Если не знаете, с чего начать</span><h2>Стартовые вопросы</h2><ul>${item.starterQuestions.map((question) => `<li><span>${escapeHtml(question)}</span></li>`).join('')}</ul></section><details class="danetki-story__answer"><summary><span><strong>Показать ответ</strong><small>Откройте, когда соберёте свою версию</small></span><span aria-hidden="true">+</span></summary><div><span>Авторская разгадка</span><p>${escapeHtml(item.solution)}</p></div></details><aside class="danetki-story__play"><div><span>Хотите настоящее расследование?</span><h2>Задавайте вопросы ИИ-ведущему</h2><p>В игре ответ скрыт: ведущий реагирует на версии и помогает восстановить историю.</p></div><a class="ui-button ui-button--primary" href="/games/danetki?from=story&amp;story=${escapeHtml(danetkiStoryPath(item).split('/').at(-1) ?? '')}#game">Играть без спойлеров</a></aside></article><section class="danetki-story-related"><div class="danetki-catalog-section-head"><div><span>Следующие дела</span><h2>Похожие данетки</h2></div><a href="/danetki">Все истории →</a></div><div class="danetki-catalog-grid">${related.map(renderDanetkiCard).join('')}</div></section></main>`
}

const renderArtifactDossier = (content: GameSeoContent) => {
  const presentation = GAME_GUIDE_PRESENTATION[content.mode]
  const expanded = content.mode === 'connections' ? ' open' : ''
  return `${renderSearchSummary(content)}<details class="artifact-dossier ticket-dossier ticket-dossier--${content.mode}"${expanded}><summary class="ticket-dossier__summary"><span class="ticket-dossier__summary-title"><span class="ticket-dossier__static-icon" aria-hidden="true">▤</span><span><strong class="ticket-dossier__closed-label">${escapeHtml(presentation.closedLabel)}</strong><strong class="ticket-dossier__open-label">${escapeHtml(presentation.openLabel)}</strong><small>об игре · подсказки · вопросы</small></span></span><span class="ticket-dossier__chevron ticket-dossier__static-icon" aria-hidden="true">⌄</span></summary><div class="ticket-dossier__drawer"><header class="ticket-dossier__intro"><div><span class="ticket-dossier__eyebrow">${escapeHtml(presentation.introLabel)}</span><h2>${escapeHtml(content.heading)}</h2><p class="ticket-dossier__lead">${escapeHtml(content.lead)}</p></div></header><div class="ticket-dossier__guide"><section class="ticket-dossier__evidence"><header><span class="ticket-dossier__section-icon" aria-hidden="true">⌕</span><div><span>${escapeHtml(presentation.evidenceLabel)}</span><h3>${escapeHtml(presentation.evidenceTitle)}</h3></div></header><ul>${content.features.map((feature) => `<li><span class="ticket-dossier__static-icon" aria-hidden="true">✓</span><span>${escapeHtml(feature)}</span></li>`).join('')}</ul></section><section class="ticket-dossier__route"><header><span class="ticket-dossier__section-icon" aria-hidden="true">↗</span><div><span>${escapeHtml(presentation.routeLabel)}</span><h3>${escapeHtml(presentation.routeTitle)}</h3></div></header><ol>${content.steps.map((step, index) => `<li><strong>${String(index + 1).padStart(2, '0')}</strong><span>${escapeHtml(step)}</span></li>`).join('')}</ol></section></div><details class="ticket-dossier__more"${expanded}><summary><span>Подробнее об игре</span><span class="ticket-dossier__static-icon" aria-hidden="true">⌄</span></summary><section class="ticket-dossier__story" aria-label="Об игре подробнее">${renderParagraphs(content)}</section></details><section class="ticket-dossier__faq"><header><span class="ticket-dossier__section-icon" aria-hidden="true">?</span><div><span>${escapeHtml(presentation.faqLabel)}</span><h3>${escapeHtml(presentation.faqTitle)}</h3></div></header><div>${content.faq.map((entry) => `<details><summary><span>${escapeHtml(entry.question)}</span><span class="ticket-dossier__static-icon" aria-hidden="true">⌄</span></summary><p>${escapeHtml(entry.answer)}</p></details>`).join('')}</div></section><nav class="ticket-dossier__links" aria-label="Другие ежедневные игры"><span><span class="ticket-dossier__static-icon" aria-hidden="true">✦</span>${escapeHtml(presentation.linksLabel)}</span><div>${renderGameLinks(content.mode)}</div></nav></div></details>`
}

const renderStaticLaunchOption = (content: GameSeoContent) => {
  const option = content.mode === 'music'
    ? ['Сложность', 'Средний']
    : content.mode === 'city'
      ? ['Режим', 'Столицы']
      : content.mode === 'movie' || content.mode === 'series' || content.mode === 'anime'
        ? ['Период', 'Все годы']
        : null
  if (!option) return ''
  return `<span class="game-launch-controls__option"><span class="game-option-trigger game-option-trigger--static"><span class="game-option-trigger__meta"><span class="game-option-trigger__label">⌁ ${option[0]}</span></span><span class="game-option-trigger__value"><strong>${option[1]}</strong><span aria-hidden="true">›</span></span></span></span>`
}

const renderLaunchControls = (content: GameSeoContent) => {
  const option = renderStaticLaunchOption(content)
  return `<div class="game-launch-controls game-launch-controls--${content.mode} ${option ? 'has-option' : 'is-action-only'} game-launch-controls--static"><span class="game-launch-controls__action"><a class="ui-button ui-button--primary play-button game-launch-controls__play" href="${escapeHtml(content.canonicalPath)}#game">▶ Начать игру</a></span>${option}</div>`
}

const renderPosterImage = (content: GameSeoContent, className: string) => {
  const src = TITLE_POSTER_PATHS[content.mode]
  return src ? `<img class="${className}" src="${src}" alt="" width="480" height="1200" decoding="async" fetchpriority="high">` : ''
}

const renderAdmissionTicketFallback = (content: GameSeoContent) => `<article class="admit-ticket admit-ticket--dossier" aria-labelledby="ticket-${content.mode}"><div class="admit-ticket__stub admit-ticket__stub--poster admit-ticket__stub--${content.mode}" aria-hidden="true">${renderPosterImage(content, 'admit-ticket__stub-art')}<span>ВХОД</span><strong>ОДИН</strong><small>${escapeHtml(content.shortName)}</small><em>10 попыток</em><i></i></div><div class="admit-ticket__body"><div class="ticket-kicker"><span>Ежедневная премьера</span><i></i><small>полночный сеанс</small></div><h1 id="ticket-${content.mode}">${escapeHtml(content.mode === 'game' || content.mode === 'series' || content.mode === 'danetki' || content.mode === 'connections' || content.mode === 'book' ? content.heading : `Ежедневная игра: ${content.shortName.toLocaleLowerCase('ru-RU')}`)}</h1><p>${escapeHtml(content.lead)}</p>${renderLaunchControls(content)}</div>${renderArtifactDossier(content)}</article>`

const renderConcertTicketFallback = (content: GameSeoContent) => `<article class="concert-ticket concert-ticket--dossier" aria-labelledby="ticket-music"><div class="concert-ticket__main"><div class="concert-ticket__head"><div class="concert-ticket__brand"><span class="concert-ticket__kicker">♪ Концерт дня</span><h1 id="ticket-music">${escapeHtml(content.heading)}</h1><p class="concert-ticket__venue">Главная сцена · ежедневный сеанс</p></div><div class="concert-ticket__when"><strong>СЕГОДНЯ</strong><small>21:45</small></div></div><p class="concert-ticket__lead">${escapeHtml(content.lead)}</p><div class="concert-ticket__meta" aria-hidden="true"><span><i>GATE</i><b>10</b></span><span><i>SEAT</i><b>A15</b></span><span><i>ROW</i><b>07</b></span></div><div class="concert-ticket__barcode" aria-hidden="true"></div>${renderLaunchControls(content)}</div><div class="concert-ticket__stub concert-ticket__stub--poster" aria-hidden="true">${renderPosterImage(content, 'concert-ticket__stub-art')}<span class="concert-ticket__stub-kicker">Концерт дня</span><strong>Артист дня</strong><small>Главная сцена</small><em>21:45</em><span class="concert-ticket__stub-no">№ 001</span><div class="concert-ticket__barcode concert-ticket__barcode--v"></div></div>${renderArtifactDossier(content)}</article>`

const renderDiagnosisChartFallback = (content: GameSeoContent) => `<article class="med-chart med-chart--dossier" aria-labelledby="ticket-diagnosis"><div class="med-chart__stub med-chart__stub--poster" aria-hidden="true">${renderPosterImage(content, 'med-chart__stub-art')}<span class="med-chart__cross" aria-hidden="true"><i></i><i></i></span><span>ПРИЁМ</span><strong>ОТКРЫТ</strong><small>Карта № 001</small><em>СЕГОДНЯ</em></div><div class="med-chart__body"><div class="med-chart__kicker"><span>Амбулаторная карта</span><i></i><small>анонимный пациент</small></div><h1 id="ticket-diagnosis">Ежедневная игра: диагнозы</h1><p>${escapeHtml(content.lead)}</p>${renderLaunchControls(content)}</div>${renderArtifactDossier(content)}</article>`

const renderGameArtifactFallback = (content: GameSeoContent) => {
  const artifact = content.mode === 'music'
      ? renderConcertTicketFallback(content)
      : content.mode === 'diagnosis'
        ? renderDiagnosisChartFallback(content)
        : renderAdmissionTicketFallback(content)
  return `<main class="seo-static-shell seo-static-shell--artifact">${artifact}</main>`
}

const buildPage = (template: string, content: SeoPageContent, fallback: string) => {
  const route = seoRouteFromPathname(content.canonicalPath)
  const canonicalUrl = new URL(content.canonicalPath, `${SITE_ORIGIN}/`).toString()
  const imageUrl = new URL(route.imagePath, `${SITE_ORIGIN}/`).toString()
  let html = template
  html = html.replace(/<title>[^]*?<\/title>/i, `<title>${escapeHtml(content.title)}</title>`)
  html = upsertMeta(html, 'name', 'description', content.description)
  html = upsertMeta(html, 'name', 'robots', INDEXABLE_ROBOTS)
  html = upsertMeta(html, 'name', 'application-name', SITE_NAME)
  html = upsertMeta(html, 'property', 'og:locale', 'ru_RU')
  html = upsertMeta(html, 'property', 'og:type', 'website')
  html = upsertMeta(html, 'property', 'og:site_name', SITE_NAME)
  html = upsertMeta(html, 'property', 'og:title', content.title)
  html = upsertMeta(html, 'property', 'og:description', content.description)
  html = upsertMeta(html, 'property', 'og:url', canonicalUrl)
  html = upsertMeta(html, 'property', 'og:image', imageUrl)
  html = upsertMeta(html, 'property', 'og:image:alt', `${content.heading} — ${SITE_NAME}`)
  html = upsertMeta(html, 'name', 'twitter:card', 'summary_large_image')
  html = upsertMeta(html, 'name', 'twitter:title', content.title)
  html = upsertMeta(html, 'name', 'twitter:description', content.description)
  html = upsertMeta(html, 'name', 'twitter:image', imageUrl)
  html = upsertMeta(html, 'name', 'twitter:image:alt', `${content.heading} — ${SITE_NAME}`)
  html = upsertCanonical(html, canonicalUrl)
  html = setJsonLd(html, structuredDataForSeoRoute(route, SITE_ORIGIN))
  if ('mode' in content && TITLE_POSTER_PATHS[content.mode]) html = addImagePreload(html, TITLE_POSTER_PATHS[content.mode]!)
  html = html.replace(/<div id="root">[^]*?<\/div>\s*<noscript>/i, `<div id="root">${fallback}</div>\n    <noscript>`)
  const isGamePage = 'mode' in content
  const danetkiPageFragment = route.kind === 'danetki-catalog'
    ? 'class="danetki-catalog-hero"'
    : route.kind === 'danetki-story'
      ? 'class="danetki-story"'
      : null
  const requiredFragments = [
    `<title>${escapeHtml(content.title)}</title>`,
    `content="${INDEXABLE_ROBOTS}"`,
    `href="${canonicalUrl}"`,
    'type="application/ld+json"',
    '<h1',
    danetkiPageFragment ?? (isGamePage ? 'artifact-dossier ticket-dossier' : 'class="hub-guide"'),
    danetkiPageFragment ?? (isGamePage ? 'class="ticket-dossier__drawer"' : 'class="hub-guide__drawer"'),
  ]
  for (const fragment of requiredFragments) {
    if (!html.includes(fragment)) throw new Error(`SEO page ${content.canonicalPath} is missing ${fragment}`)
  }
  if (html.includes('<div id="root"></div>')) throw new Error(`SEO page ${content.canonicalPath} has an empty app shell`)
  return html
}

const renderSitemap = () => {
  const urls = [HOME_SEO, ...INDEXABLE_GAME_SEO, { canonicalPath: '/danetki' }, ...DANETKI_COLLECTION_DEFINITIONS, ...DANETKI_CATALOG_ITEMS.map((item) => ({ canonicalPath: danetkiStoryPath(item) })), ...INDEXABLE_UTILITY_PATHS.map((canonicalPath) => ({ canonicalPath })), ...LEGAL_DOCUMENT_SLUGS.map((slug) => ({ canonicalPath: `/legal/${slug}` }))]
  const lastmod = new Date().toISOString().slice(0, 10)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((page) => `  <url><loc>${escapeXml(new URL(page.canonicalPath, `${SITE_ORIGIN}/`).toString())}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`
}

const renderRobots = () => `User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/
Disallow: /api/
Disallow: /data/
Disallow: /city-content/

Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid
Host: shoditsa.ru
Sitemap: ${SITE_ORIGIN}/sitemap.xml
`

const template = await readFile(resolve(distRoot, 'index.html'), 'utf8')
await writeFile(resolve(distRoot, 'index.html'), buildPage(template, HOME_SEO, renderHomeFallback()), 'utf8')

for (const game of INDEXABLE_GAME_SEO) {
  const target = resolve(distRoot, 'seo', 'games', `${game.mode}.html`)
  await mkdir(resolve(target, '..'), { recursive: true })
  const fallback = renderGameArtifactFallback(game)
  await writeFile(target, buildPage(template, game, fallback), 'utf8')
}

const danetkiCatalogContent = seoRouteFromPathname('/danetki')
await writeFile(resolve(distRoot, 'seo', 'danetki.html'), buildPage(template, danetkiCatalogContent, renderDanetkiCatalogFallback(danetkiCatalogContent)), 'utf8')
await mkdir(resolve(distRoot, 'seo', 'danetki'), { recursive: true })
for (const collection of DANETKI_COLLECTION_DEFINITIONS) {
  const content = seoRouteFromPathname(collection.canonicalPath)
  await writeFile(resolve(distRoot, 'seo', 'danetki', `${collection.slug}.html`), buildPage(template, content, renderDanetkiCatalogFallback(content)), 'utf8')
}
for (const item of DANETKI_CATALOG_ITEMS) {
  const content = seoRouteFromPathname(danetkiStoryPath(item))
  const target = resolve(distRoot, 'seo', 'danetki', `${danetkiStoryPath(item).split('/').at(-1)}.html`)
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, buildPage(template, content, renderDanetkiStoryFallback(item)), 'utf8')
}

for (const canonicalPath of INDEXABLE_UTILITY_PATHS) {
  const content = seoRouteFromPathname(canonicalPath)
  const target = resolve(distRoot, 'seo', `${canonicalPath.slice(1)}.html`)
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, buildPage(template, content, renderUtilityFallback(content)), 'utf8')
}

for (const slug of LEGAL_DOCUMENT_SLUGS) {
  const canonicalPath = `/legal/${slug}`
  const content = seoRouteFromPathname(canonicalPath)
  const target = resolve(distRoot, 'seo', 'legal', `${slug}.html`)
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, buildPage(template, content, renderUtilityFallback(content)), 'utf8')
}

await writeFile(resolve(distRoot, 'sitemap.xml'), renderSitemap(), 'utf8')
await writeFile(resolve(distRoot, 'robots.txt'), renderRobots(), 'utf8')
const manifestPaths = [HOME_SEO.canonicalPath, ...INDEXABLE_GAME_SEO.map((game) => game.canonicalPath), '/danetki', ...DANETKI_COLLECTION_DEFINITIONS.map((collection) => collection.canonicalPath), ...DANETKI_CATALOG_ITEMS.map(danetkiStoryPath), ...INDEXABLE_UTILITY_PATHS, ...LEGAL_DOCUMENT_SLUGS.map((slug) => `/legal/${slug}`)]
await writeFile(resolve(distRoot, 'seo-manifest.json'), `${JSON.stringify({ origin: SITE_ORIGIN, paths: manifestPaths }, null, 2)}\n`, 'utf8')

console.log(`[seo] generated ${manifestPaths.length} indexable pages, sitemap.xml and robots.txt`)

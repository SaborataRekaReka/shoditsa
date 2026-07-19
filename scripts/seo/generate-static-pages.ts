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

const distRoot = resolve('dist')
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

const setJsonLd = (html: string, value: unknown) => {
  const json = JSON.stringify(value).replace(/</g, '\\u003c')
  const script = `<script type="application/ld+json" id="seo-json-ld">${json}</script>`
  const pattern = /<script\s+type="application\/ld\+json"\s+id="seo-json-ld">[^]*?<\/script>/i
  return pattern.test(html) ? html.replace(pattern, script) : html.replace('</head>', `  ${script}\n</head>`)
}

const renderParagraphs = (content: SeoPageContent) => content.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')
const renderGameLinks = (currentMode?: GameSeoContent['mode']) => INDEXABLE_GAME_SEO
  .filter((game) => game.mode !== currentMode)
  .map((game) => `<a href="${game.canonicalPath}">${escapeHtml(game.shortName)}</a>`)
  .join('')
const renderGuideSummary = (title: string, note: string) => `<summary class="seo-content__summary"><span class="seo-content__summary-title"><span class="seo-content__static-icon" aria-hidden="true">▤</span>${escapeHtml(title)}</span><small>${escapeHtml(note)}</small><span class="seo-content__summary-chevron seo-content__static-icon" aria-hidden="true">⌄</span></summary>`
const renderSignals = (first: [string, string], second: [string, string]) => `<div class="seo-content__signals" aria-label="Коротко"><span><i class="seo-content__signal-icon" aria-hidden="true">◎</i><strong>${escapeHtml(first[0])}</strong><small>${escapeHtml(first[1])}</small></span><span><i class="seo-content__signal-icon" aria-hidden="true">◷</i><strong>${escapeHtml(second[0])}</strong><small>${escapeHtml(second[1])}</small></span></div>`

const renderHomeFallback = () => `<main class="seo-static-shell"><article class="seo-content seo-content--home"><header class="seo-content__preview"><span class="seo-content__seal" aria-hidden="true"><span class="seo-content__seal-symbol">✦</span></span><div class="seo-content__preview-copy"><span class="seo-content__eyebrow">Путеводитель по «Сходится!»</span><h1>${escapeHtml(HOME_SEO.heading)}</h1><p class="seo-content__lead">${escapeHtml(HOME_SEO.lead)}</p></div>${renderSignals(['7 игр', 'в одном месте'], ['Каждый день', 'новые загадки'])}</header><details class="seo-content__details">${renderGuideSummary('Как устроены ежедневные игры', 'формат · подсказки · все режимы')}<div class="seo-content__drawer"><section class="seo-content__story" aria-label="О платформе"><span class="seo-content__story-mark" aria-hidden="true">01</span><div>${renderParagraphs(HOME_SEO)}</div></section><nav class="seo-content__game-links" aria-label="Все ежедневные игры"><span><span class="seo-content__static-icon" aria-hidden="true">↗</span>Выберите маршрут</span><div>${renderGameLinks()}</div></nav></div></details></article></main>`

const renderArtifactDossier = (content: GameSeoContent) => {
  const presentation = GAME_GUIDE_PRESENTATION[content.mode]
  return `<details class="artifact-dossier ticket-dossier ticket-dossier--${content.mode}"><summary class="ticket-dossier__summary"><span class="ticket-dossier__summary-title"><span class="ticket-dossier__static-icon" aria-hidden="true">▤</span><span><strong class="ticket-dossier__closed-label">${escapeHtml(presentation.closedLabel)}</strong><strong class="ticket-dossier__open-label">${escapeHtml(presentation.openLabel)}</strong><small>об игре · подсказки · вопросы</small></span></span><span class="ticket-dossier__chevron ticket-dossier__static-icon" aria-hidden="true">⌄</span></summary><div class="ticket-dossier__drawer"><header class="ticket-dossier__intro"><span class="ticket-dossier__frame" aria-hidden="true">01</span><div><span class="ticket-dossier__eyebrow">${escapeHtml(presentation.introLabel)}</span><h2>${escapeHtml(content.heading)}</h2><p class="ticket-dossier__lead">${escapeHtml(content.lead)}</p></div></header><section class="ticket-dossier__story" aria-label="Об игре подробнее">${renderParagraphs(content)}</section><div class="ticket-dossier__guide"><section class="ticket-dossier__evidence"><header><span class="ticket-dossier__section-icon" aria-hidden="true">⌕</span><div><span>${escapeHtml(presentation.evidenceLabel)}</span><h3>${escapeHtml(presentation.evidenceTitle)}</h3></div></header><ul>${content.features.map((feature) => `<li><span class="ticket-dossier__static-icon" aria-hidden="true">✓</span><span>${escapeHtml(feature)}</span></li>`).join('')}</ul></section><section class="ticket-dossier__route"><header><span class="ticket-dossier__section-icon" aria-hidden="true">↗</span><div><span>${escapeHtml(presentation.routeLabel)}</span><h3>${escapeHtml(presentation.routeTitle)}</h3></div></header><ol>${content.steps.map((step, index) => `<li><strong>${String(index + 1).padStart(2, '0')}</strong><span>${escapeHtml(step)}</span></li>`).join('')}</ol></section></div><section class="ticket-dossier__faq"><header><span class="ticket-dossier__section-icon" aria-hidden="true">?</span><div><span>${escapeHtml(presentation.faqLabel)}</span><h3>${escapeHtml(presentation.faqTitle)}</h3></div></header><div>${content.faq.map((entry) => `<details><summary><span>${escapeHtml(entry.question)}</span><span class="ticket-dossier__static-icon" aria-hidden="true">⌄</span></summary><p>${escapeHtml(entry.answer)}</p></details>`).join('')}</div></section><nav class="ticket-dossier__links" aria-label="Другие ежедневные игры"><span><span class="ticket-dossier__static-icon" aria-hidden="true">✦</span>${escapeHtml(presentation.linksLabel)}</span><div>${renderGameLinks(content.mode)}</div></nav></div></details>`
}

const renderAdmissionTicketFallback = (content: GameSeoContent) => `<article class="admit-ticket admit-ticket--dossier" aria-labelledby="ticket-${content.mode}"><div class="admit-ticket__stub"><span>ВХОД</span><strong>ОДИН</strong><small>${escapeHtml(content.shortName)}</small><em>10 попыток</em><i></i></div><div class="admit-ticket__body"><div class="ticket-kicker"><span>Ежедневная премьера</span><i></i><small>полночный сеанс</small></div><h1 id="ticket-${content.mode}">Ежедневная игра: ${escapeHtml(content.shortName.toLocaleLowerCase('ru-RU'))}</h1><p>${escapeHtml(content.lead)}</p>${renderArtifactDossier(content)}</div></article>`

const renderGameCaseFallback = (content: GameSeoContent) => `<article class="game-case game-case--dossier" aria-labelledby="ticket-game"><div class="game-case__spine" aria-hidden="true"><span>Сходится · Игры</span></div><div class="game-case__body"><div class="game-case__band"><span class="game-case__platform">PC</span><span class="game-case__band-title">Игра дня</span><span class="game-case__band-no">№ 001</span></div><div class="game-case__cover"><span class="game-case__disc cd disc" aria-hidden="true"><i></i></span><div class="game-case__info"><div class="game-case__kicker"><span>Ежедневный релиз</span><i></i><small>глобальный чарт</small></div><h1 id="ticket-game">Ежедневная игра: игры</h1><p>${escapeHtml(content.lead)}</p></div></div>${renderArtifactDossier(content)}</div></article>`

const renderConcertTicketFallback = (content: GameSeoContent) => `<article class="concert-ticket concert-ticket--dossier" aria-labelledby="ticket-music"><div class="concert-ticket__main"><div class="concert-ticket__head"><div class="concert-ticket__brand"><span class="concert-ticket__kicker">♪ Концерт дня</span><h1 id="ticket-music">Артист дня</h1><p class="concert-ticket__venue">Главная сцена · ежедневный сеанс</p></div><div class="concert-ticket__when"><strong>СЕГОДНЯ</strong><small>21:45</small></div></div><p class="concert-ticket__lead">${escapeHtml(content.lead)}</p><div class="concert-ticket__meta" aria-hidden="true"><span><i>GATE</i><b>10</b></span><span><i>SEAT</i><b>A15</b></span><span><i>ROW</i><b>07</b></span></div><div class="concert-ticket__barcode" aria-hidden="true"></div>${renderArtifactDossier(content)}</div><div class="concert-ticket__stub" aria-hidden="true"><span class="concert-ticket__stub-kicker">Концерт дня</span><strong>Артист дня</strong><small>Главная сцена</small><em>21:45</em><span class="concert-ticket__stub-no">№ 001</span><div class="concert-ticket__barcode concert-ticket__barcode--v"></div></div></article>`

const renderDiagnosisChartFallback = (content: GameSeoContent) => `<article class="med-chart med-chart--dossier" aria-labelledby="ticket-diagnosis"><div class="med-chart__stub"><span class="med-chart__cross" aria-hidden="true"><i></i><i></i></span><span>ПРИЁМ</span><strong>ОТКРЫТ</strong><small>Карта № 001</small><em>СЕГОДНЯ</em></div><div class="med-chart__body"><div class="med-chart__kicker"><span>Амбулаторная карта</span><i></i><small>анонимный пациент</small></div><h1 id="ticket-diagnosis">Ежедневная игра: диагнозы</h1><p>${escapeHtml(content.lead)}</p>${renderArtifactDossier(content)}</div></article>`

const renderGameArtifactFallback = (content: GameSeoContent) => {
  const artifact = content.mode === 'game'
    ? renderGameCaseFallback(content)
    : content.mode === 'music'
      ? renderConcertTicketFallback(content)
      : content.mode === 'diagnosis'
        ? renderDiagnosisChartFallback(content)
        : renderAdmissionTicketFallback(content)
  return `<main class="seo-static-shell seo-static-shell--artifact">${artifact}</main>`
}

const buildPage = (template: string, content: SeoPageContent, fallback: string) => {
  const route = seoRouteFromPathname(content.canonicalPath)
  const canonicalUrl = new URL(content.canonicalPath, `${SITE_ORIGIN}/`).toString()
  const imageUrl = new URL(DEFAULT_SOCIAL_IMAGE_PATH, `${SITE_ORIGIN}/`).toString()
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
  html = html.replace(/<div id="root">[^]*?<\/div>\s*<noscript>/i, `<div id="root">${fallback}</div>\n    <noscript>`)
  const isGamePage = content.canonicalPath.startsWith('/games/')
  const requiredFragments = [
    `<title>${escapeHtml(content.title)}</title>`,
    `content="${INDEXABLE_ROBOTS}"`,
    `href="${canonicalUrl}"`,
    'type="application/ld+json"',
    '<h1',
    isGamePage ? 'artifact-dossier ticket-dossier' : 'class="seo-content__details"',
    isGamePage ? 'class="ticket-dossier__drawer"' : 'class="seo-content__drawer"',
  ]
  for (const fragment of requiredFragments) {
    if (!html.includes(fragment)) throw new Error(`SEO page ${content.canonicalPath} is missing ${fragment}`)
  }
  if (html.includes('<div id="root"></div>')) throw new Error(`SEO page ${content.canonicalPath} has an empty app shell`)
  return html
}

const renderSitemap = () => {
  const urls = [HOME_SEO, ...INDEXABLE_GAME_SEO]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((page) => `  <url><loc>${escapeXml(new URL(page.canonicalPath, `${SITE_ORIGIN}/`).toString())}</loc></url>`).join('\n')}\n</urlset>\n`
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

await writeFile(resolve(distRoot, 'sitemap.xml'), renderSitemap(), 'utf8')
await writeFile(resolve(distRoot, 'robots.txt'), renderRobots(), 'utf8')
await writeFile(resolve(distRoot, 'seo-manifest.json'), `${JSON.stringify({ origin: SITE_ORIGIN, paths: [HOME_SEO.canonicalPath, ...INDEXABLE_GAME_SEO.map((game) => game.canonicalPath)] }, null, 2)}\n`, 'utf8')

console.log(`[seo] generated ${INDEXABLE_GAME_SEO.length + 1} indexable pages, sitemap.xml and robots.txt`)

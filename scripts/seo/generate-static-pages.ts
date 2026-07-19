import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DEFAULT_SOCIAL_IMAGE_PATH,
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
const renderGameLinks = () => INDEXABLE_GAME_SEO.map((game) => `<a href="${game.canonicalPath}">${escapeHtml(game.shortName)}</a>`).join('')

const renderHomeFallback = () => `<main class="seo-static-shell"><article class="seo-content seo-content--home"><span class="seo-content__eyebrow">Игры на каждый день</span><h1>${escapeHtml(HOME_SEO.heading)}</h1><p class="seo-content__lead">${escapeHtml(HOME_SEO.lead)}</p>${renderParagraphs(HOME_SEO)}<nav class="seo-content__game-links" aria-label="Все ежедневные игры">${renderGameLinks()}</nav></article></main>`

const renderGameFallback = (content: GameSeoContent) => `<main class="seo-static-shell"><article class="seo-content seo-content--game"><nav class="seo-breadcrumbs" aria-label="Хлебные крошки"><a href="/">${SITE_NAME}</a><span aria-hidden="true">/</span><span>${escapeHtml(content.shortName)}</span></nav><span class="seo-content__eyebrow">Ежедневная онлайн-игра</span><h1>${escapeHtml(content.heading)}</h1><p class="seo-content__lead">${escapeHtml(content.lead)}</p>${renderParagraphs(content)}<div class="seo-content__columns"><section><h2>Какие подсказки доступны</h2><ul>${content.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul></section><section><h2>Как играть</h2><ol>${content.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></section></div><section class="seo-content__faq"><h2>Вопросы об игре</h2><div>${content.faq.map((entry) => `<section><h3>${escapeHtml(entry.question)}</h3><p>${escapeHtml(entry.answer)}</p></section>`).join('')}</div></section><nav class="seo-content__game-links" aria-label="Другие ежедневные игры">${renderGameLinks()}</nav></article></main>`

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
  const requiredFragments = [
    `<title>${escapeHtml(content.title)}</title>`,
    `content="${INDEXABLE_ROBOTS}"`,
    `href="${canonicalUrl}"`,
    'type="application/ld+json"',
    '<h1>',
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
  await writeFile(target, buildPage(template, game, renderGameFallback(game)), 'utf8')
}

await writeFile(resolve(distRoot, 'sitemap.xml'), renderSitemap(), 'utf8')
await writeFile(resolve(distRoot, 'robots.txt'), renderRobots(), 'utf8')
await writeFile(resolve(distRoot, 'seo-manifest.json'), `${JSON.stringify({ origin: SITE_ORIGIN, paths: [HOME_SEO.canonicalPath, ...INDEXABLE_GAME_SEO.map((game) => game.canonicalPath)] }, null, 2)}\n`, 'utf8')

console.log(`[seo] generated ${INDEXABLE_GAME_SEO.length + 1} indexable pages, sitemap.xml and robots.txt`)

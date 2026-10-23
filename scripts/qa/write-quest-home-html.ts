import { writeFileSync } from 'node:fs'
import { HOME_SEO, SITE_ORIGIN } from '../../apps/web/src/app/seo-content'
import { PUBLIC_GAME_LINKS } from '../../apps/web/src/app/public-game-links'
import { DANETKI_DISCOVERY_LINKS } from '../../apps/web/src/app/danetki-discovery-links'

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const links = [...PUBLIC_GAME_LINKS.map(game => ({ href: game.href, label: game.label })), ...DANETKI_DISCOVERY_LINKS]
// The source/fallback uses the same HOME_SEO copy as the public build. The
// mounted UI uses the same HOME_HERO_COPY H1 as the live client application.
const html = `<!doctype html>
<html lang="ru" data-public-theme="quest-study" data-quest-skin="shoditsa" data-quest-tone="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="theme-color" content="#ffffff" />
    <meta name="description" content="${escape(HOME_SEO.description)}" />
    <link rel="canonical" href="${new URL(HOME_SEO.canonicalPath, SITE_ORIGIN).href}" />
    <title>${escape(HOME_SEO.title)}</title>
  </head>
  <body>
    <div id="root"><main>
      <h1>${escape(HOME_SEO.heading)}</h1>
      <p>${escape(HOME_SEO.lead)}</p>
      ${HOME_SEO.paragraphs.map(text => `<p>${escape(text)}</p>`).join('\n      ')}
      <nav aria-label="Все игры и истории">${links.map(link => `<a href="${escape(link.href)}">${escape(link.label)}</a>`).join(' ')}</nav>
      <noscript>Для работы интерактивных функций «Сходится!» включите JavaScript.</noscript>
    </main></div>
    <script type="module" src="/src/dev/quest-home/main.tsx"></script>
  </body>
</html>
`
writeFileSync(new URL('../../apps/web/shoditsa-home.html', import.meta.url), html)
console.log('Generated local home study with complete shared SEO fallback.')

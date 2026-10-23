/* Load this helper inside cua_repl; it is not a standalone browser driver. */
export default async function initializeReleaseThemeQa({ tab, cdp, origin = 'http://127.0.0.1:5190', candidate = null, nativeViewport = false }) {
  const fs = await import('node:fs/promises')
  const directory = 'C:/projects/dev/seans_starter_pack/qa/release-theme-acceptance-2026-10-21'
  const scan = await fs.readFile('C:/projects/dev/seans_starter_pack/scripts/qa/dark-theme-contrast.js', 'utf8')
  const measurements = JSON.parse(await fs.readFile(`${directory}/measurements.json`, 'utf8'))
  await fs.mkdir(`${directory}/records`, { recursive: true })
  const modes = ['movie', 'series', 'anime', 'game', 'city', 'music', 'diagnosis', 'animal', 'book', 'character', 'connections', 'danetki']
  const pages = [
    ['/', 'home'], ['/leaderboard?qa=guest&period=week', 'leaderboard-guest'], ['/leaderboard?qa=member&period=all', 'leaderboard-member'],
    ['/quests', 'quests'], ['/archive', 'archive'], ['/profile', 'profile'], ['/settings', 'settings'], ['/club', 'club'], ['/club/membership', 'club-membership'],
    ['/specials', 'specials'], ['/specials/dtf-game-comments-25-v1', 'special-dtf'], ['/specials/kpop-artists-admin-v1?qa=club', 'special-kpop'],
    ['/games/together?new=1', 'together'], ['/partners', 'partners'], ['/support', 'support'], ['/blog', 'blog'], ['/blog/hello', 'blog-hello'], ['/blog/support-and-blog', 'blog-support'],
    ['/login?qa=guest', 'login'], ['/register?qa=guest', 'register'], ['/legal/terms', 'terms'], ['/legal/privacy', 'privacy'], ['/legal/refunds', 'refunds'], ['/legal/contacts', 'contacts'], ['/legal/personal-data-consent', 'consent'],
    ['/danetki', 'danetki'], ['/danetki/albatros', 'danetki-albatros'], ['/danetki/dlya-detey', 'danetki-kids'], ['/danetki/slozhnye', 'danetki-hard'], ['/danetki/legkie', 'danetki-easy'], ['/danetki/novye', 'danetki-new'], ['/legal/tariffs', 'tariffs'],
    ...modes.map(mode => [`/games/${mode}`, `games-${mode}`]),
  ]
  const sessions = modes.flatMap(mode => ['playing', 'won', 'lost'].map(state => [`/sessions/qa-${mode}-${state}`, `session-${mode}-${state}`]))
  const states = [
    ...['guest', 'empty', 'error'].map(s => [`/profile?qa=${s}`, `profile-${s}`]),
    ...['empty', 'error'].map(s => [`/archive?qa=${s}`, `archive-${s}`]),
    ...['club', 'expired'].map(s => [`/club?qa=${s}`, `club-${s}`]),
    ...['empty', 'error'].map(s => [`/leaderboard?qa=${s}`, `leaderboard-${s}`]),
    ...['pending', 'paid', 'failed', 'refunded'].map(s => [`/purchase/return?orderId=qa-order&qa=${s}`, `purchase-${s}`]),
    ...['room-active', 'room-results', 'room-finished'].map(s => [`/games/together?room=SEANS7&qa=${s}`, s]),
    ...['territory-question', 'territory-reveal', 'territory-capture', 'territory-finished'].map(s => [`/games/together?room=MAPQA7&qa=${s}`, s]),
  ]
  async function capture(path, tone, width, name) {
    const viewportHeight = width < 600 ? 844 : 1000
    const viewport = await tab.playwright.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    if (viewport.width !== width || viewport.height !== viewportHeight) await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: viewportHeight, deviceScaleFactor: 1, mobile: width < 600 })
    const url = new URL(path, origin)
    url.searchParams.set('qa', url.searchParams.get('qa') || 'member'); url.searchParams.set('tone', tone)
    await tab.goto(url.href)
    await tab.playwright.locator(name.startsWith('territory-') ? '.territory-room-game' : 'h1').first().waitFor({ state: 'visible', timeoutMs: 7000 })
    await tab.getAXState({ emit: false })
    // Read the settled screen after the known route transition.
    await new Promise(resolve => setTimeout(resolve, 850))
    let measure = await tab.playwright.evaluate(`(${scan})()`)
    if (measure.width !== width || measure.tone !== tone) throw new Error(`Viewport/tone mismatch: ${measure.width}/${measure.tone}`)
    const artwork = await tab.playwright.evaluate(() => ({
      images: [...document.querySelectorAll('img')].map(image => ({ src: image.getAttribute('src'), night: image.hasAttribute('data-night-art'), broken: image.complete && image.naturalWidth === 0 })),
      legacyVisible: [...document.querySelectorAll('.app-header, .app-footer')].filter(element => { const style = getComputedStyle(element); const box = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0 }).map(element => element.className),
      newShell: { navigation: !!document.querySelector('[data-study-shell]'), playerHeader: !!document.querySelector('[data-study-header]'), content: !!document.querySelector('.qg-main') },
      appearanceRoles: Object.fromEntries(['--color-focus', '--color-action', '--color-ink', '--color-surface'].map(role => [role, getComputedStyle(document.documentElement).getPropertyValue(role).trim()])),
      headerOverflow: [...document.querySelectorAll('[data-study-header]')].flatMap(header => {
        const controls = header.querySelector('.study-header-controls')
        if (!controls || !header.getClientRects().length) return []
        const boundary = controls.getBoundingClientRect(), frame = header.getBoundingClientRect()
        const outside = [...controls.children].filter(item => {
          const box = item.getBoundingClientRect()
          return box.width > 0 && (box.left < boundary.left - .5 || box.right > boundary.right + .5)
        }).map(item => item.className)
        return outside.length || boundary.left < frame.left - .5 || boundary.right > frame.right + .5 ? [{ width: boundary.width, outside }] : []
      }),
    }))
    const file = `${tone}-${width}-${name}.png`
    // The route transition has already settled above. Avoid two back-to-back
    // native captures: they can invalidate the in-app browser capture surface.
    await fs.writeFile(`${directory}/${file}`, nativeViewport ? await tab.getScreenshot({ emit: false }) : await tab.screenshot(width < 600 ? { clip: { x: 0, y: 0, width, height: viewportHeight } } : { fullPage: false }))
    // Native screenshots can settle the classic scrollbar after CDP emulation.
    // Re-read the rendered document instead of reporting that transient width.
    const initialGeometry = { client: measure.client, scroll: measure.scroll }
    measure = await tab.playwright.evaluate(`(${scan})()`)
    const record = { name, file, candidate, requestedWidth: width, captureMethod: nativeViewport ? 'native-viewport' : width < 600 ? 'mobile-clip' : 'viewport', capturedAt: new Date().toISOString(), initialGeometry, ...measure, ...artwork }
    measurements.push(record)
    await fs.writeFile(`${directory}/records/${file}.json`, JSON.stringify(record, null, 2))
    return { name, tone, width, headings: measure.headings, checked: measure.checked, findings: measure.findings.filter(f => !f.disabled), overflow: measure.scroll - measure.client, headerOverflow: artwork.headerOverflow }
  }
  async function batch(cases, tone, width) {
    if (cases.length > 12) throw new Error('Use at most 12 cases per CUA call so each call remains bounded.')
    const results = []
    for (const [path, name] of cases) {
      try { results.push(await capture(path, tone, width, name)) } catch (error) { results.push({ path, error: String(error) }) }
    }
    return { cases: results.length, tone, width, textChecks: results.reduce((n, r) => n + (r.checked || 0), 0), issues: results.filter(r => r.error || r.findings?.length || r.overflow > 0 || r.headerOverflow?.length) }
  }
  return { tab, cdp, fs, directory, scan, measurements, modes, pages, sessions, states, capture, batch }
}

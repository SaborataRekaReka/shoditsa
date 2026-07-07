import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import readline from 'node:readline/promises'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')

const defaults = {
  startUrl: '',
  outFile: resolve(root, 'data', 'kinopoisk-navigator-ids.json'),
  stateFile: resolve(root, 'data', 'kinopoisk-navigator-state.json'),
  profileDir: resolve(root, '.tmp', 'kinopoisk-playwright-profile'),
  headless: false,
  fresh: false,
  manualStart: false,
  maxPages: 1600,
  delayMs: 900,
  timeoutMs: 45000,
}

const usage = () => {
  console.log([
    'Usage: node scripts/collect-kinopoisk-ids.mjs --url <navigator_url> [options]',
    '',
    'Options:',
    '  --url <url>          Navigator page URL (required on first run)',
    '  --out <path>         Output JSON path (default: data/kinopoisk-navigator-ids.json)',
    '  --state <path>       Resume state path (default: data/kinopoisk-navigator-state.json)',
    '  --profile <path>     Playwright profile dir (default: .tmp/kinopoisk-playwright-profile)',
    '  --max-pages <num>    Safety page limit (default: 1600)',
    '  --delay <ms>         Delay after page load (default: 900)',
    '  --timeout <ms>       Navigation timeout (default: 45000)',
    '  --headless           Run browser in headless mode',
    '  --manual             Wait for Enter before crawling (useful for auth/captcha)',
    '  --fresh              Ignore state file and start from --url',
  ].join('\n'))
}

const ensureDir = (pathToFile) => {
  const dir = pathToFile.replace(/[\\/][^\\/]+$/, '')
  mkdirSync(dir, { recursive: true })
}

const parseNumberArg = (value, name) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

const parseArgs = (argv) => {
  const options = { ...defaults }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    if (arg === '--headless') {
      options.headless = true
      continue
    }
    if (arg === '--fresh') {
      options.fresh = true
      continue
    }
    if (arg === '--manual') {
      options.manualStart = true
      continue
    }
    const next = argv[i + 1]
    if (!next) throw new Error(`Missing value for ${arg}`)
    if (arg === '--url') {
      options.startUrl = next
      i += 1
      continue
    }
    if (arg === '--out') {
      options.outFile = resolve(root, next)
      i += 1
      continue
    }
    if (arg === '--state') {
      options.stateFile = resolve(root, next)
      i += 1
      continue
    }
    if (arg === '--profile') {
      options.profileDir = resolve(root, next)
      i += 1
      continue
    }
    if (arg === '--max-pages') {
      options.maxPages = parseNumberArg(next, '--max-pages')
      i += 1
      continue
    }
    if (arg === '--delay') {
      options.delayMs = parseNumberArg(next, '--delay')
      i += 1
      continue
    }
    if (arg === '--timeout') {
      options.timeoutMs = parseNumberArg(next, '--timeout')
      i += 1
      continue
    }
    throw new Error(`Unknown arg: ${arg}`)
  }
  return options
}

const loadState = (pathToState) => {
  if (!existsSync(pathToState)) return null
  try {
    return JSON.parse(readFileSync(pathToState, 'utf8'))
  } catch {
    return null
  }
}

const saveState = (pathToState, state) => {
  ensureDir(pathToState)
  writeFileSync(pathToState, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

const collectFromPage = async (page) => page.evaluate(() => {
  const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const isNavigatorUrl = (value) => {
    if (!value) return false
    try {
      const url = new URL(value, location.href)
      return url.pathname.includes('/top/navigator/')
    } catch {
      return false
    }
  }
  const filmIds = [...new Set(Array.from(document.querySelectorAll('a[href*="/film/"]'))
    .map((link) => {
      const href = link.getAttribute('href') || ''
      const match = href.match(/\/film\/(\d+)(?:[/?#]|$)/)
      return match ? Number(match[1]) : null
    })
    .filter((id) => Number.isFinite(id)))]

  const relNext = document.querySelector('a[rel="next"][href]')
  let nextUrl = relNext ? relNext.href : ''
  if (nextUrl && !isNavigatorUrl(nextUrl)) nextUrl = ''

  if (!nextUrl) {
    const links = Array.from(document.querySelectorAll('a[href]'))
    const nextByText = links.find((link) => {
      const text = normalize(link.textContent)
      const aria = normalize(link.getAttribute('aria-label'))
      const title = normalize(link.getAttribute('title'))
      if (!isNavigatorUrl(link.href)) return false
      return /next|след/.test(text) || /next|след/.test(aria) || /next|след/.test(title) || text === '>' || text === '›' || text === '»'
    })
    nextUrl = nextByText ? nextByText.href : ''
  }

  if (!nextUrl) {
    const links = Array.from(document.querySelectorAll('a[href]'))
    const current = links.find((link) => link.getAttribute('aria-current') === 'page')
    if (current) {
      const currentPage = Number((current.textContent || '').trim())
      if (Number.isFinite(currentPage)) {
        const nextNumeric = links.find((link) => isNavigatorUrl(link.href) && Number((link.textContent || '').trim()) === currentPage + 1)
        if (nextNumeric) nextUrl = nextNumeric.href
      }
    }
  }

  return {
    pageUrl: location.href,
    title: document.title,
    ids: filmIds,
    nextUrl: nextUrl || null,
    linkCount: filmIds.length,
  }
})

const run = async () => {
  const options = parseArgs(process.argv.slice(2))
  const existingState = options.fresh ? null : loadState(options.stateFile)

  const ids = new Set(Array.isArray(existingState?.ids) ? existingState.ids.map(Number).filter(Number.isFinite) : [])
  const visited = new Set(Array.isArray(existingState?.visitedUrls) ? existingState.visitedUrls : [])
  let nextUrl = existingState?.nextUrl || options.startUrl
  let pagesProcessed = Number.isFinite(existingState?.pagesProcessed) ? existingState.pagesProcessed : 0

  if (!nextUrl) {
    usage()
    throw new Error('Missing --url and no resumable state found')
  }

  mkdirSync(options.profileDir, { recursive: true })
  const context = await chromium.launchPersistentContext(options.profileDir, {
    headless: options.headless,
    viewport: { width: 1366, height: 900 },
  })
  const page = context.pages()[0] || await context.newPage()

  try {
    console.log(`Start URL: ${nextUrl}`)
    console.log(`State file: ${options.stateFile}`)
    console.log(`Output file: ${options.outFile}`)
    console.log(`Loaded IDs from state: ${ids.size}`)

    await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs })
    await page.waitForTimeout(options.delayMs)

    if (options.manualStart) {
      const rl = readline.createInterface({ input, output })
      await rl.question('Complete login/captcha in browser if needed, then press Enter to continue...')
      rl.close()
    }

    while (nextUrl && pagesProcessed < options.maxPages) {
      if (visited.has(nextUrl)) {
        console.log(`Stop: loop detected at ${nextUrl}`)
        break
      }

      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs })
      await page.waitForTimeout(options.delayMs)

      const snapshot = await collectFromPage(page)
      const before = ids.size
      snapshot.ids.forEach((id) => ids.add(id))
      const added = ids.size - before

      visited.add(snapshot.pageUrl)
      pagesProcessed += 1

      let candidateNext = snapshot.nextUrl
      if (candidateNext && visited.has(candidateNext)) candidateNext = null
      nextUrl = candidateNext

      saveState(options.stateFile, {
        ids: [...ids],
        visitedUrls: [...visited],
        pagesProcessed,
        nextUrl,
        updatedAt: new Date().toISOString(),
      })

      console.log([
        `[${pagesProcessed}] ${snapshot.pageUrl}`,
        `title="${snapshot.title}"`,
        `found=${snapshot.linkCount}`,
        `added=${added}`,
        `total=${ids.size}`,
        `hasNext=${Boolean(nextUrl)}`,
      ].join(' | '))

      if (!snapshot.linkCount) {
        console.log('Warning: no film links found on page (possible captcha or layout change).')
      }
    }

    const sorted = [...ids].map(Number).filter(Number.isFinite).sort((a, b) => a - b)
    ensureDir(options.outFile)
    writeFileSync(options.outFile, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')

    saveState(options.stateFile, {
      ids: sorted,
      visitedUrls: [...visited],
      pagesProcessed,
      nextUrl: null,
      updatedAt: new Date().toISOString(),
      completed: true,
      outputFile: options.outFile,
    })

    console.log(`Done. Collected IDs: ${sorted.length}`)
    console.log(`Saved: ${options.outFile}`)
  } finally {
    await context.close()
  }
}

run().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})

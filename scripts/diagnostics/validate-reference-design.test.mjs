import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import ts from 'typescript'
import { auditReferenceCss, auditReferenceImports, auditReferenceModules, missingReferenceRoles, referencePalette } from './validate-reference-design.mjs'

const palette = referencePalette("html[data-public-theme='reference'] { --color-ink: #141416; --color-lilac: #e5defb; --art-unique: #abc123; }")
const scope = "html[data-public-theme='reference']"
const own = 'apps/web/src/features/game-session/Example.reference.css'

test('shared component rules accept both explicit public themes but remain scoped', () => {
  assert.deepEqual(auditReferenceCss(own, "html:is([data-public-theme='reference'], [data-public-theme='quest-study']) .card { color:var(--color-text) }"), [])
  assert.ok(auditReferenceCss(own, "html:is([data-public-theme='reference'], .any-page) .card { color:var(--color-text) }").length)
})

test('legacy hover skins cannot leak into the current application', () => {
  const path = 'apps/web/src/features/auth/LoginScreen.css'
  assert.match(auditReferenceCss(path, ":where(html:not([data-public-theme='reference'])) .field:hover { color:#959d8d }")[0], /must also exclude the shoditsa application skin/)
  assert.deepEqual(auditReferenceCss(path, ":where(html:not([data-public-theme='reference']):not([data-quest-skin='shoditsa'])) .field:hover { color:#959d8d }"), [])
})

test('foundation role completeness permits shared colours but still rejects a nonliteral role', async () => {
  const source = await readFile(new URL('../../apps/web/src/styles/reference-tokens.css', import.meta.url), 'utf8')
  const duplicate = source.replace(/--color-muted-2:\s*#[\da-f]+;/i, '--color-muted-2: #625d66;').replace(/--color-muted:\s*#[\da-f]+;/i, '--color-muted: #625d66;')
  assert.deepEqual(missingReferenceRoles(duplicate), [])
  assert.deepEqual(missingReferenceRoles(duplicate.replace('--color-muted-2: #625d66;', '--color-muted-2: var(--color-muted);')), ['--color-muted-2'])
})

test('checks every selector and nested media, excluding keyframe steps', () => {
  assert.deepEqual(auditReferenceCss(own, `${scope} .card { color: var(--color-ink) } @media(max-width:400px) { ${scope} .card { padding: 12px } } @keyframes pulse { 50% { opacity:.5 } }`, palette), [])
  assert.equal(auditReferenceCss(own, `${scope} .card, .unscoped { padding: 12px }`, palette).length, 1)
  assert.equal(auditReferenceCss(own, `@media(max-width:400px) { .unscoped { padding: 12px } }`, palette).length, 1)
})

test('shared engine presentation accepts only the exact union of the two document theme roots', () => {
  const shared = "html:is([data-public-theme='reference'], [data-quest-skin='shoditsa'])"
  assert.deepEqual(auditReferenceCss(own, `${shared} .connections-tile { color:var(--color-ink) }`, palette), [])
  assert.equal(auditReferenceCss(own, `${shared} .connections-tile, .unscoped { color:var(--color-ink) }`, palette).length, 1)
  assert.equal(auditReferenceCss(own, `html:is([data-public-theme='reference'], .unscoped) .card { color:var(--color-ink) }`, palette).length, 1)
  assert.equal(auditReferenceCss(own, `${shared} .card { color:#141416 }`, palette).length, 1)
})

test('rejects pseudo-elements inside selector-list functions without rejecting valid outer pseudos or attribute text', () => {
  for (const selector of [
    ':is(.invite::after, .ticket::before)',
    ':where(.card::marker)',
    ':is(.card, :not(.ticket::after))',
    ':not(:where(.card::before))',
    ':IS(.card:before, .ticket)',
    ':where(.card:first-letter)',
  ]) {
    const errors = auditReferenceCss(own, `${scope} ${selector} { display:none }`)
    assert.equal(errors.length, 1, selector)
    assert.match(errors[0], /pseudo-elements cannot appear inside :is\(\) or :where\(\)/)
  }
  for (const selector of [
    ':is(.invite, .ticket)::after',
    ':where(.card, :not(.ticket))::before',
    ':is(.card):before',
    ':is([data-label="::before"], [data-note=":is(.card::after)"])',
    ':is(.card /* ::before */)',
    String.raw`:where(.card\:\:before, .ticket\:is)`,
    '.ticket::after, ' + scope + ' :is(.card, .invite)',
  ]) assert.deepEqual(auditReferenceCss(own, `${scope} ${selector} { display:none }`), [], selector)
})

test('font faces have one owner, independently of theme selectors', () => {
  for (const font of [
    "@font-face { font-family:'Reference Roboto'; src:url('/fonts/reference/roboto-regular.ttf'); }",
    "@font-face { font-family:'Reference Nunito'; src:url('/fonts/quest-study/nunito-variable.ttf'); }",
  ]) {
    assert.equal(auditReferenceCss(own, font).length, 1)
    assert.deepEqual(auditReferenceCss('apps/web/src/styles/reference-tokens.css', font), [])
  }
})

test('canonical colours include alpha; artwork accents and legacy rules stay independent', () => {
  assert.equal(auditReferenceCss(own, `${scope} .card { color:#141416; box-shadow:0 1px #e5defb80 }`, palette).length, 2)
  assert.deepEqual(auditReferenceCss(own, `${scope} .illustration { fill:#abc123 }`, palette), [])
  assert.deepEqual(auditReferenceCss('apps/web/src/features/game-session/Example.css', '.legacy { color:#141416 }', palette), [])
})

test('generic primitive repainting fails while specialised targets and layout are allowed', () => {
  assert.equal(auditReferenceCss(own, `${scope} .card .ui-button:hover { background:var(--color-lilac) }`).length, 1)
  assert.equal(auditReferenceCss(own, `${scope} :is(.special, .ui-input) { color:var(--color-ink) }`).length, 1)
  assert.deepEqual(auditReferenceCss(own, `${scope} .ui-button { min-height:44px; padding:12px; } ${scope} .special.ui-button { color:var(--color-ink) }`), [])
  assert.deepEqual(auditReferenceCss('apps/web/src/components/ui/UiControls.css', `${scope} .ui-button { background:var(--color-action) }`), [])
})

function modules() {
  return new Map([
    ['apps/web/src/app/presentation-policy.ts', 'export function resolvePresentation() {} export function isPublicPresentationPath() {}'],
    ['apps/web/src/app/local-presentation.ts', "import {resolvePresentation,isPublicPresentationPath} from './presentation-policy'; resolvePresentation(); isPublicPresentationPath(); document.documentElement.dataset.publicTheme='reference';"],
    ['apps/web/src/main.tsx', 'applyPublicPresentation(location.pathname)'],
    ['apps/web/src/app/router.tsx', 'applyPublicPresentation(pathname)'],
    ['apps/web/src/App.tsx', "import './features/game/reference-game-styles.css'"],
  ])
}

test('single theme policy and writer are required for boot, navigation and global CSS', () => {
  assert.deepEqual(auditReferenceModules(modules()), [])
  const changed = modules()
  changed.set('apps/web/src/features/Other.tsx', "document.documentElement.setAttribute('data-public-theme','reference'); export function isPublicPresentationPath() {}")
  assert.equal(auditReferenceModules(changed).length, 2)
  changed.delete('apps/web/src/main.tsx')
  changed.set('apps/web/src/App.tsx', "import './features/game/ReferenceGameTheme.css'")
  assert.equal(auditReferenceModules(changed).length, 5)
})

test('retired sheets cannot re-enter through CSS imports', () => {
  assert.equal(auditReferenceCss(own, "@import '../game/ReferenceSearch.css';").length, 1)
})

test('inline reference colours also reuse tokens while illustration-specific shades remain allowed', () => {
  const sources = modules()
  sources.set('apps/web/src/features/game/ReferenceArt.tsx', "const paint = {ink: '#141416', art: '#abc123'}")
  assert.equal(auditReferenceModules(sources, palette).length, 1)
})

test('dedicated title and sidebar reuse semantic fonts and colours, including near-duplicate shades', () => {
  const path = 'apps/web/src/features/game/ReferenceGameSidebar.css'
  assert.equal(auditReferenceCss(path, ".reference-game-sidebar { font-family:'Reference Roboto'; color:#151518; background:rgba(255,255,255,.5) }").length, 3)
  assert.equal(auditReferenceCss(path, ".reference-game-sidebar { font-family:'Reference Nunito' }").length, 1)
  assert.deepEqual(auditReferenceCss(path, '.reference-game-sidebar { font-family:var(--font-body); color:var(--color-ink); background:color-mix(in srgb, var(--color-surface) 50%, transparent) }'), [])
  const sources = modules()
  sources.set('apps/web/src/features/title/ReferenceTitle.tsx', "const accent = 'var(--color-lilac)'")
  assert.deepEqual(auditReferenceModules(sources), [])
  sources.set('apps/web/src/features/title/ReferenceTitle.tsx', "const accent = '#e4defc'")
  assert.equal(auditReferenceModules(sources).length, 1)
})

test('shared reference controls keep handlers and layout while skins stay in primitives', () => {
  const path = 'apps/web/src/features/game/ReferenceGameSidebar.css'
  assert.deepEqual(auditReferenceCss(path, '.reference-game-sidebar__continue { width:100%; gap:12px; margin-top:13px }'), [])
  assert.equal(auditReferenceCss(path, '.reference-game-sidebar__continue { background:var(--color-ink); font:700 16px var(--font-body) }').length, 2)
  assert.equal(auditReferenceCss(path, '.reference-game-community > button:hover { color:var(--color-ink) }').length, 1)
  const sources = modules()
  sources.set('apps/web/src/features/game/ReferenceGameSidebar.tsx', '<ActionButton className="reference-game-sidebar__continue" onClick={onContinue} />')
  assert.deepEqual(auditReferenceModules(sources), [])
  sources.set('apps/web/src/features/game/ReferenceGameSidebar.tsx', '<ControlButton className="reference-game-sidebar__continue" onClick={onContinue} />')
  assert.equal(auditReferenceModules(sources).length, 1)
})

test('layout match aliases cannot fork the semantic comparison palette', () => {
  const path = 'apps/web/src/components/game-shell/GamePageFrame.reference.css'
  assert.deepEqual(auditReferenceCss(path, `${scope} .reference-play-layout { --reference-game-mint:var(--match-exact-bg) }`), [])
  assert.equal(auditReferenceCss(path, `${scope} .reference-play-layout { --reference-game-mint:#d9f0e2 }`).length, 1)
})

test('common dialogs cannot depend on lazy gameplay styles and follow static UI re-exports', () => {
  const css = '.rules-list i { width:30px; height:30px } .anamnesis-modal { padding:18px }'
  assert.equal(auditReferenceCss('apps/web/src/features/game-session/GameSession.css', css).length, 2)
  assert.deepEqual(auditReferenceCss('apps/web/src/features/player-modals/PlayerModalViews.css', css), [])
  const sources = new Map([
    ['apps/web/src/main.tsx', "import './styles/reference-tokens.css'"],
    ['apps/web/src/styles/reference-tokens.css', ''],
    ['apps/web/src/App.tsx', "import './components/ui'"],
    ['apps/web/src/components/ui/index.ts', "export * from './StatsGrid'"],
    ['apps/web/src/components/ui/StatsGrid.tsx', "import './StatsGrid.css'"],
    ['apps/web/src/components/ui/StatsGrid.css', ''],
  ])
  assert.deepEqual(auditReferenceImports(sources), [])
  sources.set('apps/web/src/components/ui/index.ts', "const statistics = () => import('./StatsGrid')")
  assert.equal(auditReferenceImports(sources).length, 1)
})

test('reference appearance and fonts must be statically reachable, not a lazy side effect', () => {
  const sources = new Map([
    ['apps/web/src/main.tsx', "import './styles.css'"],
    ['apps/web/src/styles.css', "@import './styles/reference-tokens.css';"],
    ['apps/web/src/styles/reference-tokens.css', ''],
    ['apps/web/src/App.tsx', "import './features/example/Example.tsx'"],
    ['apps/web/src/features/example/Example.tsx', "import './Example.reference.css'"],
    ['apps/web/src/features/example/Example.reference.css', ''],
  ])
  assert.deepEqual(auditReferenceImports(sources), [])
  sources.set('apps/web/src/App.tsx', "const page = () => import('./features/example/Example.tsx')")
  assert.equal(auditReferenceImports(sources).length, 1)
  sources.set('apps/web/src/styles.css', "@import './missing.css';")
  assert.equal(auditReferenceImports(sources).length, 3)
})

test('shared loading states are available before lazy login or game screens', () => {
  const css = '.loading { display:flex } .loading--error h1 { font-size:28px }'
  assert.equal(auditReferenceCss('apps/web/src/features/game-session/GameSession.css', css).length, 2)
  assert.deepEqual(auditReferenceCss('apps/web/src/styles/base.css', css), [])
  const sources = new Map([
    ['apps/web/src/main.tsx', "import './styles/reference-tokens.css'; import './styles/base.css'"],
    ['apps/web/src/styles/reference-tokens.css', ''],
    ['apps/web/src/styles/base.css', css],
  ])
  assert.deepEqual(auditReferenceImports(sources), [])
  sources.set('apps/web/src/main.tsx', "import './styles/reference-tokens.css'; const login = () => import('./styles/base.css')")
  assert.equal(auditReferenceImports(sources).length, 1)
})

async function playerLayoutHarness() {
  const source = await readFile(new URL('../../apps/web/src/app/router.tsx', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('router.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const layout = parsed.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
    .find((declaration) => declaration.name.getText(parsed) === 'PlayerLayout')?.initializer
  assert.ok(layout, 'router must define its player layout')
  const compiledLayout = ts.transpileModule(`(${layout.getText(parsed)})`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText
  const policySource = await readFile(new URL('../../apps/web/src/app/presentation-policy.ts', import.meta.url), 'utf8')
  const policy = { exports: {} }
  runInNewContext(ts.transpileModule(policySource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, policy)

  const root = createRootRoute()
  const player = createRoute({ getParentRoute: () => root, id: 'player' })
  const routeTree = root.addChildren([
    player.addChildren(['/', 'profile', 'archive', 'games/$mode', 'review/music'].map((path) => createRoute({ getParentRoute: () => player, path }))),
    createRoute({ getParentRoute: () => root, path: 'admin/$' }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) })
  return (reference, pathname, matchesPath = pathname) => {
    const state = {
      location: { pathname },
      matches: router.matchRoutes(matchesPath).map(match => ({ ...match, loaderData: { pathname: matchesPath, search: '', hash: '' } })),
    }
    const PlayerLayout = runInNewContext(compiledLayout, {
      React: { createElement, Fragment: Symbol.for('react.fragment') },
      App: () => createElement('main', { 'data-player-app': '' }),
      Outlet: () => createElement('section', { 'data-route-outlet': '' }),
      RoutePending: () => createElement('section', { 'data-route-pending': '' }),
      PlayerLocation: { Provider: ({ children }) => children },
      APPLICATION_DESIGN: false,
      SERVER_RUNTIME: true,
      useRouter: () => router,
      useRouterState: ({ select }) => select(state),
      isReferencePresentationPath: (path) => reference && policy.exports.isPublicPresentationPath(path),
    })
    return renderToStaticMarkup(createElement(PlayerLayout))
  }
}

test('nested public reference misses replace the app while legacy and administrative layouts stay unchanged', async () => {
  const renderLayout = await playerLayoutHarness()
  for (const [reference, pathname, showApp] of [
    [true, '/profile/unknown', false],
    [true, '/games/movie/unknown', false],
    [true, '/profile', true],
    [true, '/review/music/unknown', true],
    [true, '/admin/users', true],
    [false, '/profile/unknown', true],
    [false, '/games/movie/unknown', true],
  ]) {
    const markup = renderLayout(reference, pathname)
    assert.equal(markup.includes('data-player-app'), showApp, `${reference ? 'reference' : 'legacy'} ${pathname}`)
    assert.equal(markup.match(/data-route-outlet/g)?.length, 1, pathname)
  }
})

test('404 history navigation keeps the app unmounted while location and committed matches disagree', async () => {
  const renderLayout = await playerLayoutHarness()
  for (const missing of ['/games/movie/unknown', '/profile/unknown', '/unknown']) {
    // Enter 404, leave for the archive, then use Back before new matches commit.
    assert.equal(renderLayout(true, missing).includes('data-player-app'), false)
    assert.equal(renderLayout(true, '/archive', missing).includes('data-player-app'), false)
    assert.equal(renderLayout(true, '/archive').includes('data-player-app'), true)
    assert.equal(renderLayout(true, missing, '/archive').includes('data-player-app'), false)
    assert.equal(renderLayout(true, missing).includes('data-player-app'), false)
  }
  assert.equal(renderLayout(false, '/profile/unknown', '/archive').includes('data-player-app'), true)
  assert.equal(renderLayout(true, '/review/music/unknown', '/archive').includes('data-player-app'), true)
  assert.equal(renderLayout(true, '/admin/users', '/archive').includes('data-player-app'), true)
})

test('a handled dialog Escape closes only the modal and leaves background navigation for the next Escape', async () => {
  const effects = []
  const documentListeners = new Map()
  const windowListeners = new Map()
  const eventTarget = (listeners) => ({
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => { if (listeners.get(type) === handler) listeners.delete(type) },
  })
  class Element {
    focus() { this.focused = true }
    querySelectorAll() { return [] }
  }
  const trigger = new Element()
  const document = { ...eventTarget(documentListeners), activeElement: trigger, body: { style: { overflow: 'auto' } } }
  const environment = {
    exports: {},
    React: { createElement },
    ChevronLeft: () => null,
    isReferenceGamePreview: () => true,
    EmbeddedApplicationContext: {},
    useContext: () => false,
    useRef: (current) => ({ current }),
    useEffect: (effect) => effects.push(effect),
    HTMLElement: Element,
    document,
    window: { ...eventTarget(windowListeners), requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} },
    dialogFocusableSelector: 'button',
  }
  async function loadFunction(path, name) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const declaration = parsed.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
    assert.ok(declaration, `${name} must exist`)
    const compiled = ts.transpileModule(declaration.getText(parsed), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText
    runInNewContext(compiled, environment)
    return environment.exports[name]
  }
  const useDialogFocusTrap = await loadFunction('../../apps/web/src/components/ui/DialogSurface.tsx', 'useDialogFocusTrap')
  const ScreenBack = await loadFunction('../../apps/web/src/components/app-shell/AppShell.tsx', 'ScreenBack')
  let closes = 0
  let navigations = 0
  const dialogRef = useDialogFocusTrap(true, () => closes++)
  dialogRef.current = new Element()
  ScreenBack({ onBack: () => navigations++ })
  const cleanups = effects.map((effect) => effect()).filter((cleanup) => typeof cleanup === 'function')
  const dispatch = (key) => {
    const event = new Event('keydown', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'key', { value: key })
    documentListeners.get('keydown')?.(event)
    if (!event.cancelBubble) windowListeners.get('keydown')?.(event)
    return event
  }
  assert.equal(dispatch('Enter').defaultPrevented, false)
  const escape = dispatch('Escape')
  assert.equal(escape.defaultPrevented, true)
  assert.equal(escape.cancelBubble, true)
  assert.equal(closes, 1)
  assert.equal(navigations, 0)
  cleanups[0]()
  assert.equal(document.body.style.overflow, 'auto')
  assert.equal(trigger.focused, true)
  dispatch('Escape')
  assert.equal(closes, 1)
  assert.equal(navigations, 1)
  cleanups[1]()
  assert.equal(documentListeners.size + windowListeners.size, 0)
})

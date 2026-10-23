import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import ts from 'typescript'

const tokenOwner = 'apps/web/src/styles/reference-tokens.css'
const policyOwner = 'apps/web/src/app/presentation-policy.ts'
const themeOwner = 'apps/web/src/app/local-presentation.ts'
const gameManifest = 'apps/web/src/features/game/reference-game-styles.css'
const legacySheets = ['ReferenceGameTheme', 'ReferencePuzzleTheme', 'ReferencePlayLayout', 'ReferenceAttempt', 'ReferenceSearch'].map((name) => `${name}.css`)
const themeScope = /^(?:html)?\[data-public-theme\s*=\s*(['"])reference\1\]/
// Engines share their semantic presentation with the application shell. This
// exact union keeps both branches document-scoped; arbitrary :is() is rejected.
const sharedThemeScope = /^html:is\(\[data-public-theme=(['"])reference\1\],\s*\[data-quest-skin=(['"])shoditsa\2\]\)/
const applicationThemeScope = /^html:is\(\[data-public-theme=(['"])reference\1\],\s*\[data-public-theme=(['"])quest-study\2\]\)/
const isPublicThemeSelector = selector => themeScope.test(selector) || sharedThemeScope.test(selector) || applicationThemeScope.test(selector)
const canonicalRoles = new Set([
  '--color-bg', '--color-surface', '--color-surface-2', '--color-surface-3',
  '--color-paper', '--color-paper-2', '--color-paper-hover', '--color-ink',
  '--color-muted', '--color-muted-2', '--color-line', '--color-line-strong',
  '--color-action-hover', '--color-focus', '--color-mint', '--color-yellow',
  '--color-coral', '--color-lilac', '--color-blue', '--color-peach',
  '--color-primary', '--color-accent', '--color-danger', '--color-shadow',
  '--match-exact-bg', '--match-partial-bg', '--match-miss-bg',
])
// These presentation owners use the foundation palette throughout; generated artwork stays separate.
const semanticOwners = new Set([
  'apps/web/src/features/game/ReferenceGameSidebar',
  'apps/web/src/features/title/ReferenceTitle',
  'apps/web/src/features/game-session/GameMatchStrip',
])
const sharedControlClasses = new Map([
  ['reference-game-sidebar__continue', 'ActionButton'],
  ['reference-game-community__action', 'ActionButton'],
  ['reference-title__rules', 'ActionButton'],
  ['reference-match-strip__toggle', 'TextButton'],
  ['reference-match-strip__rules', 'TextButton'],
])
const matchAliases = new Map([
  ['--reference-game-mint', '--match-exact-bg'],
  ['--reference-game-yellow', '--match-partial-bg'],
  ['--reference-game-coral', '--match-miss-bg'],
])
const literalColour = /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(\s*[\d.]|\b(?:black|white)\b/i
const controlSkinProperty = /^(?:font(?:-.+)?|border(?:-.+)?|letter-spacing|text-transform|text-decoration(?:-.+)?|cursor)$/
const primitiveClass = /^ui-(?:button(?:--[\w-]+)?|icon-button(?:--[\w-]+)?|input(?:--[\w-]+)?|textarea(?:--[\w-]+)?|select(?:--[\w-]+)?|field(?:__[\w-]+)?|dialog-(?:backdrop|surface))$/
const stateClass = /^(?:is-|has-)|^(?:active|selected|disabled|open|closed)$/
const paintProperty = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline))?(?:-color)?|outline(?:-color)?|box-shadow|fill|stroke)$/
const normalPath = (path) => path.replaceAll('\\', '/')

/** Only the deliberately enumerated foundation roles are canonical, not all artwork colours. */
export function referencePalette(source) {
  const palette = new Map()
  postcss.parse(source).walkDecls((decl) => {
    if (canonicalRoles.has(decl.prop) && /^#[\da-f]{6}$/i.test(decl.value)) palette.set(decl.value.toLowerCase(), decl.prop)
  })
  return palette
}

/** Several semantic roles may intentionally share the same literal colour. */
export function missingReferenceRoles(source) {
  const declared = new Set()
  postcss.parse(source).walkDecls(decl => {
    if (canonicalRoles.has(decl.prop) && /^#[\da-f]{6}$/i.test(decl.value)) declared.add(decl.prop)
  })
  return [...canonicalRoles].filter(role => !declared.has(role))
}

function inKeyframes(rule) {
  for (let node = rule.parent; node; node = node.parent) if (node.type === 'atrule' && /keyframes$/i.test(node.name)) return true
  return false
}

function targetCompound(selector) {
  let depth = 0
  let quoted = ''
  let start = 0
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index]
    if (quoted) { if (char === quoted && selector[index - 1] !== '\\') quoted = ''; continue }
    if (char === '"' || char === "'") { quoted = char; continue }
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (!depth && /[\s>+~]/.test(char)) start = index + 1
  }
  return selector.slice(start)
}

function targetsGenericPrimitive(selector) {
  const target = targetCompound(selector)
  // A grouped target is checked branch by branch, so one feature class cannot hide a generic branch.
  const grouped = /^:(?:is|where)\((.*)\)$/.exec(target)
  if (grouped) return postcss.list.comma(grouped[1]).some(targetsGenericPrimitive)
  const withoutConditions = target.replace(/:(?:not|is|where|has)\([^]*\)/g, '')
  const classes = [...withoutConditions.matchAll(/\.([\w-]+)/g)].map((match) => match[1])
  return classes.some((name) => primitiveClass.test(name)) && !classes.some((name) => !name.startsWith('ui-') && !stateClass.test(name))
}

/** Track balanced selector functions without treating quoted attributes or escaped colons as pseudos. */
function hasPseudoElementInSelectorList(selector) {
  const functions = []
  let attributeDepth = 0
  let quoted = ''
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index]
    if (char === '\\') { index++; continue }
    if (quoted) { if (char === quoted) quoted = ''; continue }
    if (char === '"' || char === "'") { quoted = char; continue }
    if (char === '/' && selector[index + 1] === '*') {
      const end = selector.indexOf('*/', index + 2)
      if (end < 0) break
      index = end + 1
      continue
    }
    if (char === '[') { attributeDepth++; continue }
    if (char === ']') { attributeDepth--; continue }
    if (attributeDepth) continue
    if (char === '(') { functions.push(false); continue }
    if (char === ')') { functions.pop(); continue }
    if (char !== ':') continue
    if (selector[index + 1] === ':') {
      if (functions.includes(true)) return true
      index++
      continue
    }
    const pseudo = /^:([a-z_-][\w-]*)(\()?/i.exec(selector.slice(index))
    if (!pseudo) continue
    const name = pseudo[1].toLowerCase()
    if (functions.includes(true) && /^(?:before|after|first-line|first-letter)$/.test(name) && selector[index + pseudo[0].length] !== '\\') return true
    if (pseudo[2]) functions.push(name === 'is' || name === 'where')
    index += pseudo[0].length - 1
  }
  return false
}

export function auditReferenceCss(path, source, palette = new Map()) {
  path = normalPath(path)
  const errors = []
  const report = (node, message) => errors.push(`${path}:${node.source?.start?.line ?? 1}: ${message}`)
  const tree = postcss.parse(source, { from: path })
  const dedicated = path.endsWith('.reference.css') || /\/(?:Reference[^/]*|reference-[^/]*)\.css$/.test(path)
  const semantic = semanticOwners.has(path.replace(/(?:\.reference)?\.css$/, ''))
  tree.walkAtRules('font-face', (node) => {
    const reference = node.nodes.some((decl) => decl.type === 'decl' && /Reference (?:Nunito|Roboto|Caveat|PT Mono)|\/fonts\/reference\//.test(decl.value))
    if (reference && path !== tokenOwner) report(node, `reference @font-face belongs to ${tokenOwner}`)
  })
  tree.walkAtRules('import', (node) => {
    if (legacySheets.some((name) => node.params.includes(name))) report(node, 'retired reference override import')
  })
  tree.walkRules((rule) => {
    if (inKeyframes(rule)) return
    const selectors = postcss.list.comma(rule.selector)
    if (selectors.some(selector => /html:not\(\[data-public-theme=['"]reference['"]\]\)(?!:not\(\[data-quest-skin=['"]shoditsa['"]\]\))/.test(selector))) report(rule, 'legacy appearance rules must also exclude the shoditsa application skin')
    if (path.endsWith('/features/game-session/GameSession.css') && selectors.some((selector) => /\.(?:rules-list|anamnesis-[\w-]+)/.test(selector))) report(rule, 'rules and anamnesis belong to eager PlayerModalViews.css, not the lazy game stylesheet')
    if (path.endsWith('/features/game-session/GameSession.css') && selectors.some((selector) => /\.loading(?:--[\w-]+)?\b/.test(selector))) report(rule, 'shared loading states belong to eager styles/base.css, not the lazy game stylesheet')
    if (path.endsWith('.reference.css') && selectors.some((selector) => !isPublicThemeSelector(selector))) report(rule, 'every reference selector must start at the reference root or its shared shoditsa root union')
    const referenceRule = dedicated || selectors.some(isPublicThemeSelector)
    if (!referenceRule) return
    if (selectors.some(hasPseudoElementInSelectorList)) report(rule, 'pseudo-elements cannot appear inside :is() or :where(); place them after the selector-list function')
    if (!path.includes('/components/ui/') && selectors.some(targetsGenericPrimitive) && rule.nodes.some((decl) => decl.type === 'decl' && paintProperty.test(decl.prop))) report(rule, 'generic UI primitive recolouring belongs in components/ui; use an owned component class for specialised controls')
    if (path === tokenOwner) return
    rule.walkDecls((decl) => {
      if (/^(?:font|font-family)$/.test(decl.prop) && /Reference (?:Nunito|Roboto|Caveat|PT Mono)/.test(decl.value)) report(decl, 'reference typography must consume the foundation font variables')
      if (semantic && literalColour.test(decl.value)) report(decl, 'presentation colour must consume a semantic foundation token')
      const sharedControl = selectors.some((selector) => {
        const target = targetCompound(selector)
        return [...target.matchAll(/\.([\w-]+)/g)].some((match) => sharedControlClasses.has(match[1]) || match[1] === 'play-button')
          || /\.reference-game-community\s*>\s*button(?::[\w-]+)?$/.test(selector)
      })
      if (semantic && sharedControl && (paintProperty.test(decl.prop) || controlSkinProperty.test(decl.prop))) report(decl, 'shared button skin belongs to the UI primitive; keep only component layout here')
      if (selectors.some((selector) => /\.reference-play-layout(?:\s|$)/.test(selector)) && matchAliases.has(decl.prop) && decl.value.trim() !== `var(${matchAliases.get(decl.prop)})`) report(decl, 'gameplay match aliases must use the foundation match palette')
      for (const literal of decl.value.match(/#[\da-f]{6}(?:[\da-f]{2})?\b/gi) ?? []) {
        const role = palette.get(literal.slice(0, 7).toLowerCase())
        if (role) report(decl, `canonical colour ${literal} must use var(${role})${literal.length === 9 ? ' with color-mix for opacity' : ''}`)
      }
    })
  })
  return errors
}

function moduleInfo(path, source) {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const imports = []
  const writes = []
  const calls = new Set()
  const declarations = new Set()
  const strings = []
  const controls = []
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) strings.push(node.text)
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attribute = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(parsed) === 'className')
      if (attribute?.initializer && ts.isStringLiteral(attribute.initializer)) controls.push({ tag: node.tagName.getText(parsed), classes: attribute.initializer.text.split(/\s+/) })
    }
    if (ts.isFunctionDeclaration(node) && node.name) declarations.add(node.name.text)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && /\.dataset(?:\.publicTheme|\[['"]publicTheme['"]\])$/.test(node.left.getText(parsed))) writes.push(node)
    if (ts.isDeleteExpression(node) && /\.dataset(?:\.publicTheme|\[['"]publicTheme['"]\])$/.test(node.expression.getText(parsed))) writes.push(node)
    if (ts.isCallExpression(node)) {
      calls.add(node.expression.getText(parsed))
      if (ts.isPropertyAccessExpression(node.expression) && ['setAttribute', 'removeAttribute', 'toggleAttribute'].includes(node.expression.name.text) && node.arguments.some((arg) => ts.isStringLiteral(arg) && arg.text === 'data-public-theme')) writes.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return { parsed, imports, writes, calls, declarations, strings, controls }
}

/** Follow only static imports. A stylesheet hidden behind import() is not a foundation dependency. */
export function auditReferenceImports(sources) {
  const visited = new Set()
  const missing = []
  const visit = (path) => {
    if (visited.has(path) || !sources.has(path)) return
    visited.add(path)
    const specifiers = []
    if (path.endsWith('.css')) postcss.parse(sources.get(path)).walkAtRules('import', (node) => {
      const match = /^['"]([^'"]+)['"]$/.exec(node.params)
      if (match) specifiers.push(match[1])
    })
    else specifiers.push(...moduleInfo(path, sources.get(path)).imports)
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue
      const base = normalPath(relative(process.cwd(), resolve(dirname(path), specifier)))
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => sources.has(candidate))
      if (target) visit(target)
      else if (specifier.endsWith('.css')) missing.push(`${path}: missing stylesheet ${specifier}`)
    }
  }
  visit('apps/web/src/main.tsx')
  visit('apps/web/src/App.tsx')
  for (const path of sources.keys()) if (path.endsWith('.reference.css') && !visited.has(path)) missing.push(`${path}: owner appearance must be reachable through static imports`)
  for (const path of ['apps/web/src/features/player-modals/PlayerModalViews.css', 'apps/web/src/components/ui/StatsGrid.css']) if (sources.has(path) && !visited.has(path)) missing.push(`${path}: shared dialog appearance must be reachable before a game session`)
  if (sources.has('apps/web/src/styles/base.css') && !visited.has('apps/web/src/styles/base.css')) missing.push('apps/web/src/styles/base.css: shared loading appearance must be reachable before a game session')
  if (!visited.has(tokenOwner)) missing.push(`${tokenOwner}: foundation must be statically loaded before public pages`)
  return missing
}

export function auditReferenceModules(sources, palette = new Map()) {
  const errors = []
  const info = new Map([...sources].filter(([path]) => /\.tsx?$/.test(path) && !path.includes('.test.')).map(([path, source]) => [normalPath(path), moduleInfo(path, source)]))
  for (const [path, module] of info) {
    if (module.imports.some((specifier) => legacySheets.some((name) => specifier.endsWith(name)))) errors.push(`${path}: retired reference override import`)
    if (path !== themeOwner && module.writes.length) errors.push(`${path}: only ${themeOwner} may write the document theme`)
    for (const name of ['resolvePresentation', 'isPublicPresentationPath']) if (path !== policyOwner && module.declarations.has(name)) errors.push(`${path}: ${name} belongs to the single presentation policy`)
    if (semanticOwners.has(path.replace(/\.tsx?$/, ''))) {
      for (const value of module.strings) if (literalColour.test(value)) errors.push(`${path}: inline presentation colour must consume a semantic foundation token`)
      for (const control of module.controls) for (const name of control.classes) {
        const expected = sharedControlClasses.get(name)
        if (expected && control.tag !== expected) errors.push(`${path}: ${name} must use shared ${expected}`)
      }
    }
    if (/\/Reference[^/]*\.tsx?$/.test(path)) for (const value of module.strings) for (const literal of value.match(/#[\da-f]{6}(?:[\da-f]{2})?\b/gi) ?? []) {
      const role = palette.get(literal.slice(0, 7).toLowerCase())
      if (role) errors.push(`${path}: inline canonical colour ${literal} must use var(${role})`)
    }
  }
  const policy = info.get(policyOwner)
  for (const name of ['resolvePresentation', 'isPublicPresentationPath']) if (!policy?.declarations.has(name)) errors.push(`${policyOwner}: missing public policy ${name}`)
  const owner = info.get(themeOwner)
  if (!owner?.imports.includes('./presentation-policy') || !owner.calls.has('resolvePresentation') || !owner.calls.has('isPublicPresentationPath')) errors.push(`${themeOwner}: theme must use the shared presentation and public-path policy`)
  if (!owner?.writes.length) errors.push(`${themeOwner}: missing document theme owner`)
  for (const path of ['apps/web/src/main.tsx', 'apps/web/src/app/router.tsx']) if (!info.get(path)?.calls.has('applyPublicPresentation')) errors.push(`${path}: public theme must apply at boot and on route changes`)
  const app = info.get('apps/web/src/App.tsx')
  if (!app?.imports.includes('./features/game/reference-game-styles.css')) errors.push('apps/web/src/App.tsx: missing static game style manifest import')
  return errors
}

async function collect(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collect(path))
    else if (/\.(?:css|tsx?)$/.test(entry.name)) files.push(path)
  }
  return files
}

export async function validateReferenceDesign(root = process.cwd()) {
  const paths = await collect(resolve(root, 'apps/web/src'))
  const sources = new Map(await Promise.all(paths.map(async (path) => [normalPath(relative(root, path)), await readFile(path, 'utf8')])))
  const palette = referencePalette(sources.get(tokenOwner) ?? '')
  const failures = auditReferenceModules(sources, palette)
  failures.push(...auditReferenceImports(sources))
  for (const name of legacySheets) if ([...sources.keys()].some((path) => path.endsWith(`/${name}`))) failures.push(`${name}: retired override file must not exist`)
  if (missingReferenceRoles(sources.get(tokenOwner) ?? '').length) failures.push(`${tokenOwner}: canonical foundation roles are missing or no longer literal colours`)
  for (const [path, source] of sources) if (path.endsWith('.css') && !path.includes('/admin/')) failures.push(...auditReferenceCss(path, source, palette))
  const fonts = []
  const fontSources = new Set()
  postcss.parse(sources.get(tokenOwner) ?? '').walkAtRules('font-face', (node) => {
    fonts.push(node.toString())
    node.walkDecls('src', (decl) => {
      if (fontSources.has(decl.value)) failures.push(`${tokenOwner}: duplicate font source ${decl.value}`)
      fontSources.add(decl.value)
    })
  })
  for (const family of ['Reference Nunito', 'Reference Caveat', 'Reference PT Mono']) if (!fonts.some((font) => font.includes(family))) failures.push(`${tokenOwner}: missing ${family} font-face`)
  const manifest = sources.get(gameManifest)
  if (!manifest) failures.push(`${gameManifest}: missing static manifest`)
  else {
    postcss.parse(manifest).walkAtRules('import', (node) => {
      const specifier = node.params.replace(/^['"]|['"]$/g, '')
      const target = normalPath(relative(root, resolve(root, dirname(gameManifest), specifier)))
      if (!sources.has(target)) failures.push(`${gameManifest}: missing owner ${target}`)
    })
  }
  return failures
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = await validateReferenceDesign()
  if (failures.length) {
    console.error('[reference-design] Public reference ownership contract failed:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else console.log('[reference-design] theme policy, font ownership, static imports, selector scope, primitives and palette: ok')
}

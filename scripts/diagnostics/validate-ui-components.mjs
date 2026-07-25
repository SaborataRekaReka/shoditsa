import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

const root = process.cwd()
const screenRoots = [
  resolve(root, 'apps/web/src/features'),
]
const screenFiles = [
  resolve(root, 'apps/web/src/App.tsx'),
]

async function collectTsx(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectTsx(path))
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) files.push(path)
  }
  return files
}

async function collectScripts(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectScripts(path))
    else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) && !entry.name.includes('.test.')) files.push(path)
  }
  return files
}

async function collectCss(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectCss(path))
    else if (entry.name.endsWith('.css')) files.push(path)
  }
  return files
}

for (const directory of screenRoots) screenFiles.push(...await collectTsx(directory))

const forbidden = [
  ['native button', /<button(?:\s|>)/],
  ['native input', /<input(?:\s|\/?>)/],
  ['native select', /<select(?:\s|>)/],
  ['native textarea', /<textarea(?:\s|>)/],
  ['manual dialog', /role=["']dialog["']|aria-modal=/],
  ['manual admission ticket', /className=(?:["'][^"']*\badmit-ticket\b|{`[^`]*\badmit-ticket\b)/],
  ['manual segmented progress', /className=(?:["'][^"']*\bprogress-block\b|{`[^`]*\bprogress-block\b)/],
]

const failures = []
for (const path of screenFiles) {
  const source = await readFile(path, 'utf8')
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) failures.push(`${relative(root, path)}: ${label}`)
  }
}

const controlStylesPath = resolve(root, 'apps/web/src/components/ui/UiControls.css')
const controlStyles = await readFile(controlStylesPath, 'utf8')
if (/\.ui-control\s*\{[^}]*\bfont\s*:/s.test(controlStyles)) {
  failures.push(`${relative(root, controlStylesPath)}: font shorthand overrides canonical button typography`)
}
if (/\.(?:hub|profile|rewatch|review|result|game|title-screen|danetki|friends)-/.test(controlStyles)) {
  failures.push(`${relative(root, controlStylesPath)}: feature-specific selectors must live with their feature`)
}

const legacyScreenStylesPath = resolve(root, 'apps/web/src/styles/screens.css')
const legacyScreenStyles = await readFile(legacyScreenStylesPath, 'utf8')
const migratedSelector = /\.(?:ui-button|app-header|app-footer|admit-ticket|concert-ticket|med-chart|search-box|suggestions|progress-block|profile-|rewatch-|review-|result-|hub-|title-|ticket-mode-tabs|difficulty-|mode-tabs|game-heading|dtf-|content-report|challenge-invite|economy-|resume-|game-screen-shell)/
if (migratedSelector.test(legacyScreenStyles)) {
  failures.push(`${relative(root, legacyScreenStylesPath)}: migrated component or feature styles leaked back into the global sheet`)
}

const titleScreenStylesPath = resolve(root, 'apps/web/src/features/title/TitleScreen.css')
const titleScreenStyles = await readFile(titleScreenStylesPath, 'utf8')
if (!/\.period-option\s*\{[^}]*grid-template-columns:\s*24px\s+minmax\(0,\s*1fr\)\s+max-content/s.test(titleScreenStyles)) {
  failures.push(`${relative(root, titleScreenStylesPath)}: period option must reserve a third column for its explicit status`)
}

const styleOwners = [
  ['apps/web/src/components/ui/AnchoredMenu.css', 'apps/web/src/components/ui/AnchoredMenu.tsx'],
  ['apps/web/src/components/app-shell/AppShell.css', 'apps/web/src/components/app-shell/AppShell.tsx'],
  ['apps/web/src/components/game-shell/GameScreenShell.css', 'apps/web/src/components/game-shell/GameScreenShell.tsx'],
  ['apps/web/src/components/mode-variant/ModeVariantControl.css', 'apps/web/src/components/mode-variant/ModeVariantControl.tsx'],
  ['apps/web/src/components/search-combobox/SearchCombobox.css', 'apps/web/src/components/search-combobox/SearchCombobox.tsx'],
  ['apps/web/src/components/title-ticket/TitleArtifacts.css', 'apps/web/src/components/title-ticket/TitleTicket.tsx'],
  ['apps/web/src/features/challenge/ChallengeInvite.css', 'apps/web/src/features/challenge/ChallengeInvite.tsx'],
  ['apps/web/src/features/content-report/ContentReport.css', 'apps/web/src/features/content-report/ContentReport.tsx'],
  ['apps/web/src/features/economy/EconomyView.css', 'apps/web/src/features/economy/EconomyView.tsx'],
  ['apps/web/src/features/player-modals/PlayerModalViews.css', 'apps/web/src/features/player-modals/PlayerModalViews.tsx'],
  ['apps/web/src/features/profile/ProfileScreen.css', 'apps/web/src/features/profile/ProfileScreen.tsx'],
  ['apps/web/src/features/result/GameResult.css', 'apps/web/src/features/result/GameResult.tsx'],
  ['apps/web/src/features/result/ResultActionBar.css', 'apps/web/src/features/result/ResultActionBar.tsx'],
]
for (const [stylesheet, owner] of styleOwners) {
  const ownerPath = resolve(root, owner)
  const source = await readFile(ownerPath, 'utf8')
  const stylesheetName = stylesheet.split('/').at(-1)
  if (!source.includes(`./${stylesheetName}`)) {
    failures.push(`${relative(root, ownerPath)}: does not import its owned stylesheet ${stylesheetName}`)
  }
}

const tokenFilePath = resolve(root, 'apps/web/src/styles/tokens.css')
const canonicalPalette = [
  '#121512', '#1b1f1b', '#242924', '#303630', '#57b777', '#d6a546',
  '#efe7d7', '#ddd3bd', '#171a17', '#f2ecdf', '#aaa395', '#858b82',
  '#b85c56', '#e6ddc9', '#817660', '#31794b', '#725719', '#81d39c',
  '#e6c478', '#efaaa5',
]
const userCssFiles = (await collectCss(resolve(root, 'apps/web/src'))).filter((path) =>
  path !== tokenFilePath && !path.includes(`${sep}admin${sep}`)
)
for (const path of userCssFiles) {
  const source = await readFile(path, 'utf8')
  for (const literal of canonicalPalette) {
    if (new RegExp(`${literal}(?![0-9a-f])`, 'i').test(source)) {
      failures.push(`${relative(root, path)}: canonical palette literal ${literal} must use a semantic token`)
    }
  }
}

const modePaletteLiterals = [
  '#57b777', '#69b779', '#d6a546', '#d6a33f', '#cf7a5d', '#d97b63',
  '#5270ab', '#6684c7', '#5cb5cc', '#cf6e63', '#8a4c7d', '#8177bf',
  '#ad5e49', '#477558', '#4d8a48',
]
const userScriptFiles = [
  ...await collectScripts(resolve(root, 'apps/web/src/features')),
  ...await collectScripts(resolve(root, 'apps/web/src/components')),
  resolve(root, 'apps/web/src/App.tsx'),
  resolve(root, 'apps/web/src/app/mode-presentation.ts'),
].filter((path) => !path.includes(`${sep}admin${sep}`) && !path.includes(`${sep}ui-kit${sep}`))
for (const path of userScriptFiles) {
  const source = await readFile(path, 'utf8')
  for (const literal of modePaletteLiterals) {
    if (new RegExp(`${literal}(?![0-9a-f])`, 'i').test(source)) {
      failures.push(`${relative(root, path)}: mode palette literal ${literal} must use a --mode-*-brand token`)
    }
  }
}

const sizeContracts = [
  [controlStylesPath, /\.ui-icon-button--sm\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s, 'small icon buttons must keep a 44px target'],
  [resolve(root, 'apps/web/src/components/ui/Tabs.css'), /\.ui-tabs\s*>\s*button\s*\{[^}]*min-height:\s*44px/s, 'tabs must keep a 44px target'],
  [resolve(root, 'apps/web/src/features/friends-room/FriendsRoomScreen.css'), /\.room-pack-options button\s*\{[^}]*min-height:\s*44px/s, 'room pack options must keep a 44px target'],
  [resolve(root, 'apps/web/src/features/friends-room/FriendsRoomScreen.css'), /\.room-rule-grid button\s*\{[^}]*min-height:\s*44px/s, 'room time options must keep a 44px target'],
  [resolve(root, 'apps/web/src/features/friends-room/FriendsRoomScreen.css'), /\.room-rounds input\s*\{[^}]*height:\s*44px/s, 'room range input must keep a 44px target'],
  [resolve(root, 'apps/web/src/features/friends-room/FriendsRoomScreen.css'), /\.room-chat button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s, 'room chat action must keep a 44px target'],
  [resolve(root, 'apps/web/src/features/profile/ProfileScreen.css'), /\.profile-route__cta\s*\{[^}]*min-height:\s*44px/s, 'profile route action must keep a 44px target'],
  [resolve(root, 'apps/web/src/features/result/ResultActionBar.css'), /\.result-after-actions\s*\{[^}]*grid-template-columns:\s*1fr/s, 'mobile result actions must use one full-width column'],
]
for (const [path, pattern, message] of sizeContracts) {
  const source = path === controlStylesPath ? controlStyles : await readFile(path, 'utf8')
  if (!pattern.test(source)) failures.push(`${relative(root, path)}: ${message}`)
}

const leaderboardStylesPath = resolve(root, 'apps/web/src/features/dtf-comments/DtfLeaderboard.css')
const leaderboardStyles = await readFile(leaderboardStylesPath, 'utf8')
if (/font-size:\s*[0-9](?:\.[0-9]+)?px|font:\s*[^;{}]*\s[0-9](?:\.[0-9]+)?px\//.test(leaderboardStyles)) {
  failures.push(`${relative(root, leaderboardStylesPath)}: leaderboard text must not be smaller than 10px`)
}

if (failures.length) {
  console.error('[ui-components] Screen code bypasses the shared component layer.')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error('[ui-components] Add or extend a shared component instead of duplicating markup in a screen.')
  process.exit(1)
}

console.log('[ui-components] shared markup, style ownership and semantic palette contracts: ok')

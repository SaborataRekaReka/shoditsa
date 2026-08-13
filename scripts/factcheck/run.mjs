import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runAiResearch } from './ai.mjs'
import {
  buildPatchPlan, buildResearchTasks, findingsFromAiResult, fingerprint, isRecord, profileItems,
  runDatasetRules, SEVERITIES, summarizeFindings, text,
} from './core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODE_DIRS = {
  movie: 'movies', series: 'series', anime: 'animes', game: 'games', music: 'music', diagnosis: 'diagnoses',
  city: 'cities', animal: 'animals', book: 'books', character: 'characters', danetki: 'danetki', connections: 'connections',
}
const MODE_ALIASES = {
  movies: 'movie', films: 'movie', film: 'movie', 'фильмы': 'movie', 'кино': 'movie',
  series: 'series', serials: 'series', 'сериалы': 'series', animes: 'anime', 'аниме': 'anime',
  games: 'game', 'игры': 'game', music: 'music', 'музыка': 'music', diagnoses: 'diagnosis', 'диагнозы': 'diagnosis',
  cities: 'city', 'города': 'city', animals: 'animal', 'животные': 'animal', books: 'book', 'книги': 'book',
  characters: 'character', 'персонажи': 'character', 'данетки': 'danetki', 'связи': 'connections',
}

const parseArgs = (argv) => {
  const options = {}
  for (const argument of argv) {
    if (!argument.startsWith('--')) continue
    const [key, ...rest] = argument.slice(2).split('=')
    options[key] = rest.length ? rest.join('=') : true
  }
  for (const key of ['source', 'input', 'revision', 'mode', 'fields', 'field', 'ids', 'cards', 'card', 'allowed', 'limit', 'research', 'ai', 'max-ai', 'model', 'concurrency', 'refresh', 'max-output-tokens', 'run-id', 'output', 'strict']) {
    const environmentValue = process.env[`npm_config_${key.replaceAll('-', '_')}`]
    if (options[key] === undefined && environmentValue !== undefined) options[key] = environmentValue
  }
  return options
}
// npm config normalizes comma-separated option values to whitespace on some Windows versions.
const list = (value) => text(value).split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean)
const bool = (value) => value === true || ['1', 'true', 'yes'].includes(text(value).toLowerCase())
const normalizeMode = (value) => MODE_ALIASES[text(value).toLocaleLowerCase('ru-RU')] ?? text(value).toLocaleLowerCase('en-US')
const normalizeModes = (value) => {
  const requested = list(value || 'all').map(normalizeMode)
  return requested.includes('all') ? Object.keys(MODE_DIRS) : [...new Set(requested)]
}

const extractItems = (payload) => {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (Array.isArray(payload?.items)) return payload.items.filter(isRecord)
  if (Array.isArray(payload?.cards)) return payload.cards.filter(isRecord)
  throw new Error('Input JSON must be an array or contain an items/cards array')
}

const readItemsFile = async (file) => extractItems(JSON.parse(await readFile(file, 'utf8')))

const loadDirectory = async (directory, modes) => {
  const result = {}
  const names = await readdir(directory)
  for (const mode of modes) {
    const candidates = [`${mode}.json`, `${MODE_DIRS[mode] ?? mode}.json`, path.join(MODE_DIRS[mode] ?? mode, 'items.json')]
    const match = candidates.find((candidate) => names.includes(candidate) || candidate.includes(path.sep))
    if (!match) continue
    try { result[mode] = await readItemsFile(path.join(directory, match)) } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return result
}

const loadLibrary = async (modes) => {
  const result = {}
  for (const mode of modes) {
    const directory = MODE_DIRS[mode]
    if (!directory) throw new Error(`Mode ${mode} needs --input because it has no local library mapping`)
    result[mode] = await readItemsFile(path.join(ROOT, 'public', 'data', 'libraries', directory, 'items.json'))
  }
  return { itemsByMode: result, sourceMeta: { type: 'library', root: 'public/data/libraries' } }
}

const loadInput = async (input, modes) => {
  const resolved = path.resolve(ROOT, input)
  const stats = await import('node:fs/promises').then(({ stat }) => stat(resolved))
  if (stats.isDirectory()) return { itemsByMode: await loadDirectory(resolved, modes), sourceMeta: { type: 'input-directory', path: resolved } }
  if (modes.length !== 1) throw new Error('A single input file requires exactly one --mode')
  return { itemsByMode: { [modes[0]]: await readItemsFile(resolved) }, sourceMeta: { type: 'input-file', path: resolved } }
}

const loadActive = async (modes, revision) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shoditsa-factcheck-'))
  try {
    const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const args = [tsxCli, 'scripts/content/export.ts', `--output=${temporary}`, ...(revision ? [`--revision=${revision}`] : [])]
    const exported = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: process.env })
    if (exported.status !== 0) throw new Error(`Active revision export failed with exit code ${exported.status}`)
    const manifest = JSON.parse(await readFile(path.join(temporary, 'manifest.json'), 'utf8'))
    return { itemsByMode: await loadDirectory(temporary, modes), sourceMeta: { type: 'active-revision', ...manifest } }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

const filterItems = (itemsByMode, options) => {
  const ids = new Set(list(options.ids || options.cards || options.card))
  const allowedOnly = text(options.allowed).toLowerCase() === 'only'
  const limit = Math.max(0, Number.parseInt(options.limit, 10) || 0)
  return Object.fromEntries(Object.entries(itemsByMode).map(([mode, items]) => {
    let filtered = items.filter((item) => (!ids.size || ids.has(text(item.id))) && (!allowedOnly || item.allowedInGame !== false))
    if (limit) filtered = filtered.slice(0, limit)
    return [mode, filtered]
  }))
}

const markdownReport = ({ manifest, profile, summary, findings, aiResults, patchPlan }) => {
  const byMode = Object.entries(manifest.cardsByMode).map(([mode, count]) => `- ${mode}: ${count}`).join('\n')
  const topRules = Object.entries(findings.reduce((counts, entry) => ({ ...counts, [entry.ruleId]: (counts[entry.ruleId] ?? 0) + 1 }), {}))
    .sort((left, right) => right[1] - left[1]).slice(0, 15).map(([rule, count]) => `- ${rule}: ${count}`).join('\n') || '- none'
  const releaseGate = aiResults.length < manifest.researchTasks
    ? 'INCOMPLETE: semantic AI research tasks remain unprocessed.'
    : summary.bySeverity.critical || summary.bySeverity.high
      ? 'BLOCKED: critical or high findings remain unresolved.'
      : 'PASS: completed checks produced no unresolved critical or high findings.'
  return `# Content fact-check report

Generated: ${manifest.generatedAt}

This run was read-only. It did not change a card, revision, workspace, or production state.

## Scope

- Source: ${manifest.source.type}
- Requested fields: ${manifest.requestedFields.join(', ')}
- Research policy: ${manifest.research}
- AI mode: ${manifest.ai}
- Cards: ${manifest.totalCards}

${byMode}

## Coverage

- Deterministic checks: ${manifest.totalCards}/${manifest.totalCards} cards
- AI research: ${aiResults.length}/${manifest.researchTasks} tasks completed
- Fields profiled: ${Object.values(profile).reduce((sum, entry) => sum + entry.fields.length, 0)} mode-field combinations

## Findings

- Total: ${summary.total}
- Critical: ${summary.bySeverity.critical}
- High: ${summary.bySeverity.high}
- Medium: ${summary.bySeverity.medium}
- Low: ${summary.bySeverity.low}
- Proposed field patches: ${patchPlan.length}

### Most frequent rules

${topRules}

## Release gate

${releaseGate}

Unknown, stale, source-conflict, and incomplete AI tasks remain unresolved even when they are not release blockers.
`
}

const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
const writeJsonl = (file, values) => writeFile(file, values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : ''), 'utf8')

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: npm run content:factcheck -- --mode=animal --fields=legCount,locomotion [--source=library|active] [--input=file-or-dir] [--ids=id1,id2] [--research=all|flagged|none] [--ai=never|web]')
    return
  }
  const source = text(options.source || (options.input ? 'input' : 'library')).toLowerCase()
  const modes = normalizeModes(options.mode)
  const requestedFields = list(options.fields || options.field || '*')
  const research = text(options.research || 'all').toLowerCase()
  const ai = text(options.ai || 'never').toLowerCase()
  if (!['all', 'flagged', 'none'].includes(research)) throw new Error('--research must be all, flagged, or none')
  if (!['never', 'web'].includes(ai)) throw new Error('--ai must be never or web')
  if (source === 'input' && !text(options.input)) throw new Error('--source=input requires --input=file-or-directory')

  const loaded = source === 'active'
    ? await loadActive(modes, text(options.revision))
    : source === 'input' || options.input
      ? await loadInput(text(options.input), modes)
      : await loadLibrary(modes)
  const itemsByMode = filterItems(loaded.itemsByMode, options)
  if (!Object.keys(itemsByMode).length || !Object.values(itemsByMode).some((items) => items.length)) throw new Error('No cards matched the requested scope')
  const requestedFieldsByMode = Object.fromEntries(Object.keys(itemsByMode).map((mode) => [mode, requestedFields]))
  if (!requestedFields.includes('*')) {
    const nonexistent = requestedFields.filter((field) => !Object.values(itemsByMode).some((items) => items.some((item) => field.split('.').reduce((value, key) => isRecord(value) ? value[key] : undefined, item) !== undefined)))
    if (nonexistent.length) throw new Error(`Requested fields were not found in the selected cards: ${nonexistent.join(', ')}`)
  }

  const findings = runDatasetRules(itemsByMode, requestedFieldsByMode)
  const profile = Object.fromEntries(Object.entries(itemsByMode).map(([mode, items]) => [mode, profileItems(items, requestedFields)]))
  let tasks = buildResearchTasks({ itemsByMode, requestedFieldsByMode, findings, research })
  const maxAi = Math.max(0, Number.parseInt(options['max-ai'], 10) || 0)
  if (maxAi) tasks = tasks.slice(0, maxAi)

  const runId = text(options['run-id']) || `${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}_${fingerprint({ source: loaded.sourceMeta, modes, requestedFields, ids: options.ids ?? null }).slice(0, 8)}`
  const output = path.resolve(ROOT, text(options.output) || path.join('var', 'factcheck', 'runs', runId))
  await mkdir(output, { recursive: true })
  const resultsPath = path.join(output, 'ai-results.jsonl')
  await writeFile(resultsPath, '', 'utf8')
  let aiResults = []
  if (ai === 'web' && tasks.length) {
    aiResults = await runAiResearch({
      tasks, apiKey: process.env.OPENAI_API_KEY, model: text(options.model) || 'gpt-5-mini',
      concurrency: Math.max(1, Number.parseInt(options.concurrency, 10) || 3), refresh: bool(options.refresh),
      maxOutputTokens: Math.max(1_200, Number.parseInt(options['max-output-tokens'], 10) || 5_000),
      cacheDir: path.resolve(ROOT, 'var', 'factcheck', 'cache'),
      onResult: (result) => appendFile(resultsPath, `${JSON.stringify(result)}\n`, 'utf8'),
    })
    for (let index = 0; index < aiResults.length; index += 1) findings.push(...findingsFromAiResult(tasks[index], aiResults[index]))
  }
  const summary = summarizeFindings(findings)
  const patchPlan = buildPatchPlan(findings)
  const manifest = {
    protocolVersion: 1, runId, generatedAt: new Date().toISOString(), source: loaded.sourceMeta,
    modes: Object.keys(itemsByMode), requestedFields, research, ai, totalCards: Object.values(itemsByMode).reduce((sum, items) => sum + items.length, 0),
    cardsByMode: Object.fromEntries(Object.entries(itemsByMode).map(([mode, items]) => [mode, items.length])),
    researchTasks: tasks.length, aiCompleted: aiResults.length, readOnly: true,
  }
  await Promise.all([
    writeJson(path.join(output, 'manifest.json'), manifest), writeJson(path.join(output, 'profile.json'), profile),
    writeJsonl(path.join(output, 'findings.jsonl'), findings), writeJsonl(path.join(output, 'research-queue.jsonl'), tasks),
    writeJson(path.join(output, 'patch-plan.json'), { disposition: 'staged_proposals_only', changes: patchPlan }),
    writeFile(path.join(output, 'summary.md'), markdownReport({ manifest, profile, summary, findings, aiResults, patchPlan }), 'utf8'),
  ])
  console.log(JSON.stringify({ output, ...manifest, findings: summary, proposedPatches: patchPlan.length }, null, 2))
  const strict = text(options.strict).toLowerCase()
  const threshold = strict === 'critical' ? 0 : strict === 'high' || options.strict === true ? 1 : null
  if (threshold != null && (aiResults.length < tasks.length || findings.some((entry) => SEVERITIES.indexOf(entry.severity) <= threshold))) process.exitCode = 2
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

import assert from 'node:assert/strict'
import test from 'node:test'
import { requestFactcheck } from './ai.mjs'
import { buildPatchPlan, buildResearchTasks, contextForTask, runDatasetRules } from './core.mjs'
import { expandDependencies } from './packs.mjs'
import { buildContentExchangeDocument } from './prepare-release.mjs'

const animal = (overrides = {}) => ({
  id: 'animal:test', mode: 'animal', titleRu: 'Тестовое животное', scientificName: 'Testus animalis',
  taxonomicClass: 'Млекопитающие', animalOrder: 'Test', animalFamily: 'Testidae', bodyCoverings: ['Шерсть'],
  locomotion: ['Ходьба'], legCount: 4, thermoregulation: 'Теплокровное', reproduction: 'Живорождение',
  bodyMassKg: 10, sizeCategory: 'Средний', ...overrides,
})

test('field scope expands semantic dependencies', () => {
  const fields = expandDependencies('animal', ['legCount'])
  assert.ok(fields.includes('locomotion'))
  assert.ok(fields.includes('taxonomicClass'))
  assert.ok(fields.includes('scientificName'))
})

test('animal rules catch zero legs with walking', () => {
  const itemsByMode = { animal: [animal({ legCount: 0 })] }
  const findings = runDatasetRules(itemsByMode, { animal: ['legCount', 'locomotion'] })
  assert.ok(findings.some((finding) => finding.ruleId === 'ANIMAL-LOCOMOTION-001' && finding.severity === 'critical'))
})

test('zero-legged crawling without walking is semantically consistent', () => {
  const findings = runDatasetRules({ animal: [animal({ legCount: 0, locomotion: ['Ползание'] })] }, { animal: ['legCount', 'locomotion'] })
  assert.ok(!findings.some((finding) => finding.ruleId === 'ANIMAL-LOCOMOTION-001'))
})

test('unknown leg count is not treated as confirmed zero', () => {
  const itemsByMode = { animal: [animal({ legCount: null })] }
  const findings = runDatasetRules(itemsByMode, { animal: ['legCount', 'locomotion'] })
  assert.ok(findings.some((finding) => finding.ruleId === 'ANIMAL-LOCOMOTION-002' && finding.status === 'uncertain'))
  assert.ok(!findings.some((finding) => finding.ruleId === 'ANIMAL-LOCOMOTION-001'))
})

test('multi-field research uses one whole-card task with dependency context', () => {
  const itemsByMode = { animal: [animal()] }
  const requestedFieldsByMode = { animal: ['legCount', 'locomotion'] }
  const tasks = buildResearchTasks({ itemsByMode, requestedFieldsByMode, findings: [], research: 'all' })
  assert.equal(tasks.length, 1)
  assert.deepEqual(tasks[0].targetFields, ['legCount', 'locomotion'])
  assert.equal(tasks[0].card.scientificName, 'Testus animalis')
  assert.equal(tasks[0].card.legCount, 4)
  assert.deepEqual(tasks[0].card.locomotion, ['Ходьба'])
})

test('whole-card context targets factual fields and keeps identity', () => {
  const context = contextForTask(animal({ dataQuality: { verified: false } }), 'animal', ['*'])
  assert.ok(context.targetFields.includes('scientificName'))
  assert.ok(!context.targetFields.includes('dataQuality'))
  assert.equal(context.card.id, 'animal:test')
})

test('a null end year is not treated as year zero', () => {
  const item = { id: 'movie:test', mode: 'movie', titleRu: 'Фильм', year: 2020, endYear: null }
  const findings = runDatasetRules({ movie: [item] }, { movie: ['*'] })
  assert.ok(!findings.some((finding) => finding.ruleId === 'COMMON-TIME-001'))
})

test('BCE publication years remain valid for books and ancient characters', () => {
  const book = { id: 'book:test', mode: 'book', titleRu: 'Эпос', bookPublicationYear: -800 }
  const character = { id: 'character:test', mode: 'character', titleRu: 'Герой', characterFirstAppearanceYear: -1800 }
  const findings = runDatasetRules({ book: [book], character: [character] }, { book: ['*'], character: ['*'] })
  assert.ok(!findings.some((finding) => finding.ruleId === 'COMMON-YEAR-001'))
})

test('zero remains an invalid sentinel for a release year', () => {
  const item = { id: 'game:test', mode: 'game', titleRu: 'Игра', releaseYear: 0 }
  const findings = runDatasetRules({ game: [item] }, { game: ['*'] })
  assert.ok(findings.some((finding) => finding.ruleId === 'COMMON-YEAR-001'))
})

test('custom input accepts an existing arbitrary mode label', () => {
  const item = { id: 'entity:test', mode: 'product', titleRu: 'Товар', price: 10 }
  const findings = runDatasetRules({ custom: [item] }, { custom: ['price'] })
  assert.ok(!findings.some((finding) => finding.ruleId === 'COMMON-MODE-001'))
})

test('patch plan excludes unchanged AI proposals', () => {
  const base = {
    ruleId: 'AI-FIELD-FACTCHECK', mode: 'animal', cardId: 'animal:test', fields: ['legCount'],
    status: 'contradiction', severity: 'high', confidence: 0.9, current: { legCount: 4 },
    evidence: [{ url: 'https://example.test/source' }], message: 'Test', origin: 'ai-research',
  }
  const plan = buildPatchPlan([{ ...base, proposed: 4 }, { ...base, proposed: 2 }])
  assert.equal(plan.length, 1)
  assert.equal(plan[0].proposedValue, 2)
})

test('reviewed proposals become a revision-pinned content exchange', () => {
  const snapshot = [animal({ id: 'animal:test', legCount: 4 })]
  const document = buildContentExchangeDocument({
    snapshot,
    manifest: { source: { type: 'active-revision', revision: { id: '6151a93f-4f71-4a6e-929d-3d8e4754d5d2', version: 'test' } } },
    candidates: [{
      mode: 'animal', cardId: 'animal:test', field: 'legCount', currentValue: 4, proposedValue: 2,
      sourceUrls: ['https://example.test/evidence'], disposition: 'human_review_required',
    }],
    expected: 1,
  })
  assert.equal(document.items.length, 1)
  assert.equal(document.items[0].data.legCount, 2)
  assert.equal(document.items[0].base.revisionId, '6151a93f-4f71-4a6e-929d-3d8e4754d5d2')
  assert.match(document.items[0].base.fieldHashes.legCount, /^[a-f0-9]{64}$/)
})

test('fact-check research rotates a pinned IPRoyal session after a regional refusal', async () => {
  let attempts = 0
  let closes = 0
  const sessions = []
  const delays = []
  const result = await requestFactcheck({
    task: {
      cardId: 'character:test', mode: 'character', fingerprint: 'task-fingerprint', webSearch: true,
      targetFields: ['titleRu'], card: { id: 'character:test', mode: 'character', titleRu: 'Тест' },
      sourcePolicy: 'Use authoritative sources.', semantics: [], deterministicFindings: [],
    },
    apiKey: 'test-key', model: 'gpt-5-mini', maxOutputTokens: 1_200,
    proxyUrl: 'http://user:password@geo.iproyal.com:12321', proxyCountry: 'de',
    createTransport: (_url, options) => {
      sessions.push(options.stabilizeIproyal.sessionId)
      return {
        fetchImpl: async () => {
          attempts += 1
          if (attempts === 1) return new Response(JSON.stringify({ error: { message: 'Country, region, or territory not supported' } }), { status: 403 })
          return new Response(JSON.stringify({
            id: 'resp_test', output_text: JSON.stringify({
              overallVerdict: 'pass', confidence: 0.9, summary: 'Supported by evidence.',
              fieldResults: [{ field: 'titleRu', verdict: 'pass', confidence: 0.9, reason: 'Confirmed.', proposedValue: 'Тест', sourceUrls: ['https://example.test/source'] }],
              crossFieldFindings: [],
            }),
            output: [{ type: 'web_search_call' }], usage: { input_tokens: 10, output_tokens: 5 },
          }), { status: 200 })
        },
        close: async () => { closes += 1 },
      }
    },
    waitForRetry: async (delay) => { delays.push(delay) },
  })
  assert.equal(attempts, 2)
  assert.equal(closes, 2)
  assert.equal(new Set(sessions).size, 2)
  assert.deepEqual(delays, [300])
  assert.equal(result.overallVerdict, 'pass')
})

test('fact-check research rotates the proxy session after a request timeout', async () => {
  let attempts = 0
  let closes = 0
  const result = await requestFactcheck({
    task: {
      cardId: 'character:timeout', mode: 'character', fingerprint: 'timeout-fingerprint', webSearch: true,
      targetFields: ['titleRu'], card: { id: 'character:timeout', mode: 'character', titleRu: 'Тест' },
      sourcePolicy: 'Use authoritative sources.', semantics: [], deterministicFindings: [],
    },
    apiKey: 'test-key', model: 'gpt-5-mini', maxOutputTokens: 1_200,
    proxyUrl: 'http://user:password@geo.iproyal.com:12321', requestTimeoutMs: 5,
    createTransport: () => ({
      fetchImpl: async (_input, init) => {
        attempts += 1
        if (attempts === 1) {
          await new Promise((resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true })
          })
        }
        return new Response(JSON.stringify({
          id: 'resp_timeout_retry', output_text: JSON.stringify({
            overallVerdict: 'pass', confidence: 0.9, summary: 'Supported by evidence.',
            fieldResults: [{ field: 'titleRu', verdict: 'pass', confidence: 0.9, reason: 'Confirmed.', proposedValue: 'Тест', sourceUrls: ['https://example.test/source'] }],
            crossFieldFindings: [],
          }),
          output: [{ type: 'web_search_call' }], usage: { input_tokens: 10, output_tokens: 5 },
        }), { status: 200 })
      },
      close: async () => { closes += 1 },
    }),
    waitForRetry: async () => {},
  })
  assert.equal(attempts, 2)
  assert.equal(closes, 2)
  assert.equal(result.overallVerdict, 'pass')
})

test('fact-check research retries malformed structured output with a larger token budget', async () => {
  let attempts = 0
  let closes = 0
  const outputBudgets = []
  const result = await requestFactcheck({
    task: {
      cardId: 'character:malformed', mode: 'character', fingerprint: 'malformed-fingerprint', webSearch: true,
      targetFields: ['titleRu'], card: { id: 'character:malformed', mode: 'character', titleRu: 'Тест' },
      sourcePolicy: 'Use authoritative sources.', semantics: [], deterministicFindings: [],
    },
    apiKey: 'test-key', model: 'gpt-5-mini', maxOutputTokens: 5_000,
    proxyUrl: 'http://user:password@geo.iproyal.com:12321',
    createTransport: () => ({
      fetchImpl: async (_input, init) => {
        attempts += 1
        outputBudgets.push(JSON.parse(init.body).max_output_tokens)
        if (attempts === 1) {
          return new Response(JSON.stringify({ id: 'resp_malformed', output_text: '{"overallVerdict":"pass","fieldResults":[' }), { status: 200 })
        }
        return new Response(JSON.stringify({
          id: 'resp_valid_retry', output_text: JSON.stringify({
            overallVerdict: 'pass', confidence: 0.9, summary: 'Supported by evidence.',
            fieldResults: [{ field: 'titleRu', verdict: 'pass', confidence: 0.9, reason: 'Confirmed.', proposedValue: 'Тест', sourceUrls: ['https://example.test/source'] }],
            crossFieldFindings: [],
          }),
          output: [{ type: 'web_search_call' }], usage: { input_tokens: 10, output_tokens: 5 },
        }), { status: 200 })
      },
      close: async () => { closes += 1 },
    }),
    waitForRetry: async () => {},
  })
  assert.equal(attempts, 2)
  assert.equal(closes, 2)
  assert.deepEqual(outputBudgets, [5_000, 7_500])
  assert.equal(result.overallVerdict, 'pass')
})

test('fact-check research strips JSON-unsafe control characters and unknown model metadata', async () => {
  const result = await requestFactcheck({
    task: {
      cardId: 'character:frog-prince', mode: 'character', fingerprint: 'unsafe-json-fingerprint', webSearch: true,
      targetFields: ['titleRu'], card: { id: 'character:frog-prince', mode: 'character', titleRu: 'Король-лягушонок' },
      sourcePolicy: 'Use authoritative sources.', semantics: [], deterministicFindings: [],
    },
    apiKey: 'test-key', model: 'gpt-5-mini', maxOutputTokens: 5_000,
    directFetch: async () => new Response(JSON.stringify({
      id: 'resp_unsafe_json', output_text: JSON.stringify({
        overallVerdict: 'pass', confidence: 0.9, summary: 'Confirmed\u0000 by evidence.',
        fieldResults: [{
          field: 'titleRu', verdict: 'pass', confidence: 0.9, reason: 'Confirmed.\u0000',
          proposedValue: 'Король-лягушонок', sourceUrls: ['https://www.gutenberg.org/ebooks/2591'],
          sources: [{ label: 'Project Gutenberg\u0000 edition' }],
        }],
        crossFieldFindings: [],
        internalMetadata: { label: 'unsafe\u0000' },
      }),
      output: [{ type: 'web_search_call' }], usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200 }),
  })
  assert.equal(JSON.stringify(result).includes('\\u0000'), false)
  assert.equal(Object.hasOwn(result, 'internalMetadata'), false)
  assert.equal(Object.hasOwn(result.fieldResults[0], 'sources'), false)
  assert.equal(result.summary, 'Confirmed by evidence.')
})

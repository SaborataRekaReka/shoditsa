import { describe, expect, it } from 'vitest'
import { calculateResponseCost, collectMusicRecordUsage } from '../src/modules/admin/pipeline-cost.js'

describe('music pipeline OpenAI cost accounting', () => {
  it('uses billed and cached token rates plus web search calls', () => {
    expect(calculateResponseCost({
      responseId: 'resp_1', model: 'gpt-5-mini', webSearchCalls: 2,
      usage: { input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 200_000 }, output_tokens: 100_000 },
    })?.costUsd).toBe(0.425)
  })

  it('uses the lower GPT-5 nano token rates', () => {
    expect(calculateResponseCost({
      responseId: 'resp_nano', model: 'gpt-5-nano',
      usage: { input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 200_000 }, output_tokens: 100_000 },
    })?.costUsd).toBe(0.081)
  })

  it('deduplicates one discovery response copied into several candidates', () => {
    const discovery = { responseId: 'resp_discovery', model: 'gpt-5-mini', webSearchCalls: 1, usage: { input_tokens: 1_000, output_tokens: 500 } }
    const result = collectMusicRecordUsage([
      { record: { input: { provenance: discovery } } },
      { record: { input: { provenance: discovery } } },
    ])
    expect(result.responses).toHaveLength(1)
    expect(result.webSearchCalls).toBe(1)
    expect(result.costUsd).toBeGreaterThan(0.01)
  })
})

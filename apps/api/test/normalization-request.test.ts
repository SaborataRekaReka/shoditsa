import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('undici', () => ({
  ProxyAgent: class {},
  fetch: vi.fn(),
}))

import { fetch as undiciFetch } from 'undici'
import { requestNormalization } from '../src/modules/admin/normalization-pipeline.js'

const response = (status: number, payload: Record<string, unknown>) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
})

describe('normalization request transport', () => {
  beforeEach(() => vi.mocked(undiciFetch).mockReset())

  it('falls back to a request without web search when the provider rejects the region twice', async () => {
    vi.mocked(undiciFetch)
      .mockResolvedValueOnce(response(400, { error: { message: 'Country, region, or territory not supported' } }) as never)
      .mockResolvedValueOnce(response(400, { error: { message: 'Country, region, or territory not supported' } }) as never)
      .mockResolvedValueOnce(response(200, {
        id: 'resp_test',
        output_text: JSON.stringify({ decision: 'update', value: 'Updated hint', confidence: 0.9, reason: 'Fixed', sourceUrls: [] }),
        output: [],
        usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 0 } },
      }) as never)

    const result = await requestNormalization({
      apiKey: 'test', model: 'gpt-5-mini', webSearch: true, webSearchRequired: true, mode: 'game', field: 'plotHint',
      prompt: 'Rewrite the hint for %title%', cardId: 'game:1',
      payload: { id: 'game:1', mode: 'game', titleRu: 'Game', titleOriginal: 'Game', plotHint: 'Old hint' },
    })

    expect(result).toMatchObject({ decision: 'update', value: 'Updated hint', responseId: 'resp_test' })
    expect(undiciFetch).toHaveBeenCalledTimes(3)
    const bodies = vi.mocked(undiciFetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    expect(bodies[0].tools).toEqual([{ type: 'web_search', search_context_size: 'low' }])
    expect(bodies[0].tool_choice).toBe('required')
    expect(bodies[1].tools).toEqual([{ type: 'web_search', search_context_size: 'low', external_web_access: false }])
    expect(bodies[1].tool_choice).toBe('required')
    expect(bodies[2]).not.toHaveProperty('tools')
    expect(bodies[2]).not.toHaveProperty('tool_choice')
  })
})

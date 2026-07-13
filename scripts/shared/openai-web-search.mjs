export const createOpenAiWebSearchTool = ({ cacheOnly = false } = {}) => ({
  type: 'web_search',
  search_context_size: 'low',
  ...(cacheOnly ? { external_web_access: false } : {}),
})

export const isOpenAiWebSearchRegionalError = (error) => /country,\s*region,\s*or\s*territory/i.test(
  error instanceof Error ? error.message : String(error),
)

export const isTransientOpenAiError = (error) => /fetch failed|network|socket|econnreset|econnrefused|etimedout|openai http (408|409|429|5\d\d)|an error occurred while processing your request/i.test(
  error instanceof Error ? error.message : String(error),
)

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export const requestOpenAiWithRetry = async (request, { attempts = 3, baseDelayMs = 400, waitForRetry = wait } = {}) => {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await request() }
    catch (error) {
      lastError = error
      if (!isTransientOpenAiError(error) || attempt === attempts - 1) throw error
      await waitForRetry(baseDelayMs * (2 ** attempt))
    }
  }
  throw lastError
}
export const createOpenAiWebSearchTool = ({ cacheOnly = false } = {}) => ({
  type: 'web_search',
  search_context_size: 'low',
  ...(cacheOnly ? { external_web_access: false } : {}),
})

export const isOpenAiWebSearchRegionalError = (error) => /country,\s*region,\s*or\s*territory/i.test(
  error instanceof Error ? error.message : String(error),
)
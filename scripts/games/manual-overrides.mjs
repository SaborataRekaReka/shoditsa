const uniqueStrings = (values) => [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))]

export const applyGameManualOverride = (item, overrides) => {
  if (!item || item.mode !== 'game') return item
  const key = item.canonicalGameId || item.id
  const override = overrides?.byCanonicalGameId?.[key]
  if (!override) return item

  const { reason, ...fields } = override
  return {
    ...item,
    ...fields,
    notes: uniqueStrings([...(item.notes ?? []), 'game_manual_identity_override', reason]),
    sourceFlags: uniqueStrings([...(item.sourceFlags ?? []), 'game_manual_overrides']),
    dataQuality: {
      ...(item.dataQuality ?? {}),
      source: uniqueStrings([...(item.dataQuality?.source ?? []), 'game_manual_overrides']),
    },
  }
}

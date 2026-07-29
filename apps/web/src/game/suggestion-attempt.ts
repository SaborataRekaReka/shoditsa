export function selectSuggestionForAttempt<T>(
  item: T,
  select: (value: T) => void,
) {
  select(item)
}

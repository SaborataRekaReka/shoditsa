export function commitSuggestionAttempt<T>(
  item: T,
  select: (value: T) => void,
  submit: (value: T) => void,
) {
  select(item)
  submit(item)
}

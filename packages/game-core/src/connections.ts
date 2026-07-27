import {
  CONNECTIONS_COLORS,
  CONNECTIONS_DIFFICULTIES,
  type ConnectionsColor,
  type ConnectionsRoundPayload,
} from '@shoditsa/contracts'

export type ConnectionsValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  path: string
  message: string
}

export type ConnectionsRuntimeTile = {
  id: string
  label: string
  initialPosition: number
}

export type ConnectionsRuntimeGroup = {
  color: ConnectionsColor
  title: string
  hint: string | null
  tileIds: [string, string, string, string]
}

export type ConnectionsRuntimeRound = {
  id: string
  difficulty: ConnectionsRoundPayload['difficulty']
  tiles: ConnectionsRuntimeTile[]
  groups: ConnectionsRuntimeGroup[]
}

const normalizeWord = (value: unknown) => String(value ?? '')
  .normalize('NFC')
  .trim()
  .replace(/\s+/g, ' ')

const wordKey = (value: unknown) => normalizeWord(value).toLocaleLowerCase('ru-RU')

export const validateConnectionsRound = (input: unknown): ConnectionsValidationIssue[] => {
  const issues: ConnectionsValidationIssue[] = []
  const round = input as Partial<ConnectionsRoundPayload> | null
  const error = (code: string, path: string, message: string) => issues.push({ severity: 'error', code, path, message })
  const warning = (code: string, path: string, message: string) => issues.push({ severity: 'warning', code, path, message })

  if (!round || typeof round !== 'object') {
    error('round.invalid', '', 'Раунд должен быть объектом')
    return issues
  }
  if (!normalizeWord(round.id)) error('round.id_required', 'id', 'Укажите ID раунда')
  if (!CONNECTIONS_DIFFICULTIES.includes(round.difficulty as ConnectionsRoundPayload['difficulty'])) {
    error('round.difficulty_invalid', 'difficulty', 'Недопустимая сложность')
  }

  const tiles = Array.isArray(round.tiles) ? round.tiles : []
  if (tiles.length !== 16) error('tiles.count', 'tiles', 'В раунде должно быть ровно 16 карточек')
  const tileKeys = new Map<string, number>()
  tiles.forEach((tile, index) => {
    const normalized = normalizeWord(tile)
    if (!normalized) error('tile.empty', `tiles.${index}`, 'Карточка не может быть пустой')
    if (normalized.length > 32) error('tile.too_long', `tiles.${index}`, 'Карточка длиннее 32 символов')
    if (normalized.length > 14) warning('tile.visual_review', `tiles.${index}`, 'Проверьте длинное слово на мобильном экране')
    const key = wordKey(normalized)
    const duplicate = tileKeys.get(key)
    if (duplicate != null) error('tile.duplicate', `tiles.${index}`, `Карточка повторяет tiles.${duplicate}`)
    else if (key) tileKeys.set(key, index)
  })

  const groups = Array.isArray(round.groups) ? round.groups : []
  if (groups.length !== 4) error('groups.count', 'groups', 'В раунде должно быть ровно четыре группы')
  const colors = new Set<string>()
  const groupedWords = new Map<string, number>()
  groups.forEach((group, groupIndex) => {
    const path = `groups.${groupIndex}`
    if (!group || typeof group !== 'object') {
      error('group.invalid', path, 'Группа должна быть объектом')
      return
    }
    if (!CONNECTIONS_COLORS.includes(group.color as ConnectionsColor)) {
      error('group.color_invalid', `${path}.color`, 'Недопустимый цвет группы')
    } else if (colors.has(group.color)) {
      error('group.color_duplicate', `${path}.color`, 'Цвет группы повторяется')
    } else {
      colors.add(group.color)
    }
    const title = normalizeWord(group.title)
    if (!title) error('group.title_required', `${path}.title`, 'Укажите название связи')
    if (title.length > 120) error('group.title_too_long', `${path}.title`, 'Название связи длиннее 120 символов')
    const hint = normalizeWord(group.hint)
    if (!hint) warning('group.hint_missing', `${path}.hint`, 'Добавьте подсказку')
    if (hint.length > 240) error('group.hint_too_long', `${path}.hint`, 'Подсказка длиннее 240 символов')

    const words = Array.isArray(group.words) ? group.words : []
    if (words.length !== 4) error('group.words_count', `${path}.words`, 'В группе должно быть ровно четыре слова')
    words.forEach((word, wordIndex) => {
      const key = wordKey(word)
      if (!tileKeys.has(key)) error('group.word_unknown', `${path}.words.${wordIndex}`, 'Слова нет среди 16 карточек')
      const previousGroup = groupedWords.get(key)
      if (previousGroup != null) {
        error('group.word_duplicate', `${path}.words.${wordIndex}`, `Слово уже входит в groups.${previousGroup}`)
      } else if (key) {
        groupedWords.set(key, groupIndex)
      }
    })
  })
  if (tileKeys.size && (groupedWords.size !== tileKeys.size || [...tileKeys.keys()].some((key) => !groupedWords.has(key)))) {
    error('groups.coverage', 'groups', 'Группы должны без остатка покрывать все 16 карточек')
  }
  if (round.allowedInGame === true && round.contentStatus !== 'ready') {
    error('round.publish_status', 'allowedInGame', 'В игру можно допускать только готовый раунд')
  }
  if (!(round.editorial?.intendedTraps?.length)) {
    warning('editorial.trap_missing', 'editorial.intendedTraps', 'Зафиксируйте хотя бы одну ложную почти-группу')
  }
  return issues
}

export const buildConnectionsRuntimeRound = (payload: ConnectionsRoundPayload): ConnectionsRuntimeRound => {
  const errors = validateConnectionsRound(payload).filter((issue) => issue.severity === 'error')
  if (errors.length) throw new Error(`Invalid connections round: ${errors.map((issue) => issue.code).join(', ')}`)
  const tiles = payload.tiles.map((label, index) => ({
    id: `t${String(index + 1).padStart(2, '0')}`,
    label: normalizeWord(label),
    initialPosition: index,
  }))
  const tileIdByWord = new Map(tiles.map((tile) => [wordKey(tile.label), tile.id]))
  const groups = payload.groups.map((group) => ({
    color: group.color,
    title: normalizeWord(group.title),
    hint: normalizeWord(group.hint) || null,
    tileIds: group.words.map((word) => tileIdByWord.get(wordKey(word))!) as [string, string, string, string],
  })).sort((left, right) => CONNECTIONS_COLORS.indexOf(left.color) - CONNECTIONS_COLORS.indexOf(right.color))
  return { id: payload.id, difficulty: payload.difficulty, tiles, groups }
}

export const canonicalGuessSignature = (tileIds: readonly string[]) => [...tileIds].sort().join('|')

export const remainingTileIds = (round: ConnectionsRuntimeRound, solvedColors: readonly ConnectionsColor[]) => {
  const solved = new Set(solvedColors)
  const solvedTiles = new Set(round.groups.filter((group) => solved.has(group.color)).flatMap((group) => group.tileIds))
  return round.tiles.filter((tile) => !solvedTiles.has(tile.id)).map((tile) => tile.id)
}

export const evaluateConnectionsGuess = (
  round: ConnectionsRuntimeRound,
  solvedColors: readonly ConnectionsColor[],
  tileIds: readonly string[],
) => {
  const signature = canonicalGuessSignature(tileIds)
  const solved = new Set(solvedColors)
  const matched = round.groups.find((group) => !solved.has(group.color) && canonicalGuessSignature(group.tileIds) === signature)
  return matched
    ? { result: 'correct' as const, matchedColor: matched.color, oneAway: false }
    : { result: findOneAway(round, solvedColors, tileIds) ? 'one_away' as const : 'wrong' as const, matchedColor: null, oneAway: findOneAway(round, solvedColors, tileIds) }
}

export const findOneAway = (
  round: ConnectionsRuntimeRound,
  solvedColors: readonly ConnectionsColor[],
  tileIds: readonly string[],
) => {
  const selected = new Set(tileIds)
  const solved = new Set(solvedColors)
  return round.groups.some((group) => (
    !solved.has(group.color)
    && group.tileIds.filter((tileId) => selected.has(tileId)).length === 3
  ))
}

export const shouldAutoSolveFinalGroup = (solvedColors: readonly ConnectionsColor[]) => new Set(solvedColors).size === 3

export type ConnectionsShareGuess = {
  tileIds: [string, string, string, string]
  result: 'correct' | 'wrong' | 'one_away'
}

export const buildConnectionsShareRows = (
  guessHistory: readonly ConnectionsShareGuess[],
  round: ConnectionsRuntimeRound,
) => {
  const colorByTile = new Map(round.groups.flatMap((group) => group.tileIds.map((tileId) => [tileId, group.color] as const)))
  return guessHistory.map((guess) => guess.tileIds.map((tileId) => colorByTile.get(tileId)!) as [
    ConnectionsColor,
    ConnectionsColor,
    ConnectionsColor,
    ConnectionsColor,
  ])
}

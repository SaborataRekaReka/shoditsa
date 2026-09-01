import {
  TERRITORY_CAPITAL_TOWERS,
  TERRITORY_DIFFICULTIES,
  TERRITORY_MAP_VERSION,
  TERRITORY_MAX_CELL_COUNT,
  TERRITORY_MAX_DUELS,
  TERRITORY_MIN_CELL_COUNT,
  TERRITORY_RULES_VERSION,
  TERRITORY_SPEED_TIE_WINDOW_MS,
  type TerritoryDuelResultReason,
  type TerritoryFinishReason,
  type TerritoryMapCell,
  type TerritoryMapPoint,
  type TerritoryMapSnapshot,
  type TerritoryOwnership,
  type TerritoryQuestionItem,
  type TerritorySiegeState,
} from '@shoditsa/contracts'

export type TerritoryValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  path: string
  message: string
}

export type TerritoryDuelAnswer = {
  userId: string
  correct: boolean
  distance: number | null
  elapsedMs: number | null
}

export type TerritoryDuelResolution = {
  winnerUserId: string | null
  result: TerritoryDuelResultReason
}

export type TerritoryMatchPlayerStats = {
  userId: string
  correctAnswers: number
  totalCorrectAnswerTimeMs: number
}

export type TerritoryMatchPlayerScore = TerritoryMatchPlayerStats & {
  territoryCount: number
  territoryValueTotal: number
}

export type TerritoryMatchResolution = {
  status: 'active' | 'finished'
  winnerUserId: string | null
  finishReason: Exclude<TerritoryFinishReason, 'forfeit'> | null
  scores: [TerritoryMatchPlayerScore, TerritoryMatchPlayerScore]
}

const VIEW_BOX = { x: 0, y: 0, width: 1_200, height: 560 } as const
const CENTER: TerritoryMapPoint = [VIEW_BOX.width / 2, VIEW_BOX.height / 2]
const ISLAND_RADIUS_X = 550
const ISLAND_RADIUS_Y = 225
const GENERATION_ATTEMPTS = 32
const GEOMETRY_EPSILON = 1e-7
const ORGANIC_EDGE_SEGMENTS = 7
const TERRITORY_ISLAND_ASPECT = 2.5
const TERRITORY_ISLAND_ASPECT_MIN = 2.45
const TERRITORY_ISLAND_ASPECT_MAX = 2.55
const BASE_MIN_AREA_MEDIAN_RATIO = 0.7
const BASE_MIN_MARKER_CLEARANCE = 22
const BASE_MIN_LABEL_CLEARANCE = 60
const BASE_PREFERRED_LABEL_CLEARANCE = 64
const FALLBACK_BASE_MIN_LABEL_CLEARANCE = 28
const BASE_SELECTION_BUFFER = 0.5

const normalizeText = (value: unknown) => String(value ?? '')
  .normalize('NFC')
  .trim()
  .replace(/\s+/g, ' ')

const normalizedKey = (value: unknown) => normalizeText(value).toLocaleLowerCase('ru-RU')

const isHttpUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const validateTerritoryQuestion = (input: unknown): TerritoryValidationIssue[] => {
  const issues: TerritoryValidationIssue[] = []
  const question = input as Partial<TerritoryQuestionItem> | null
  const error = (code: string, path: string, message: string) => issues.push({ severity: 'error', code, path, message })
  const warning = (code: string, path: string, message: string) => issues.push({ severity: 'warning', code, path, message })

  if (!question || typeof question !== 'object') {
    error('question.invalid', '', 'Вопрос должен быть объектом')
    return issues
  }

  if (!normalizeText(question.id)) error('question.id_required', 'id', 'Укажите ID вопроса')
  if (question.mode != null && question.mode !== 'territory') error('question.mode_invalid', 'mode', 'Режим вопроса должен быть territory')
  if (question.schemaVersion !== 1) error('question.schema_version', 'schemaVersion', 'Поддерживается schemaVersion 1')
  if (question.questionType !== 'choice') error('question.type_invalid', 'questionType', 'Поддерживаются только вопросы с выбором ответа')
  if (question.type != null && question.type !== 'multiple_choice') error('question.type_alias_invalid', 'type', 'Допустимый alias — multiple_choice')
  if (!/^ru(?:-|$)/i.test(normalizeText(question.locale))) error('question.locale_invalid', 'locale', 'Вопрос должен быть на русском языке')

  const prompt = normalizeText(question.prompt)
  if (prompt.length < 10) error('question.prompt_short', 'prompt', 'Вопрос короче 10 символов')
  if (prompt.length > 500) error('question.prompt_long', 'prompt', 'Вопрос длиннее 500 символов')
  if (/<[^>]+>/.test(prompt)) error('question.prompt_html', 'prompt', 'HTML в вопросе не допускается')

  const options = Array.isArray(question.options) ? question.options : []
  if (options.length !== 4) error('options.count', 'options', 'Должно быть ровно четыре варианта ответа')
  const optionIds = new Map<string, number>()
  const optionTexts = new Map<string, number>()
  options.forEach((option, index) => {
    const id = normalizeText(option?.id)
    const text = normalizeText(option?.text)
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) error('option.id_invalid', `options.${index}.id`, 'Недопустимый ID варианта')
    if (!text) error('option.text_required', `options.${index}.text`, 'Текст варианта обязателен')
    if (text.length > 160) error('option.text_long', `options.${index}.text`, 'Вариант длиннее 160 символов')
    if (/<[^>]+>/.test(text)) error('option.text_html', `options.${index}.text`, 'HTML в вариантах не допускается')
    const previousId = optionIds.get(id)
    if (id && previousId != null) error('option.id_duplicate', `options.${index}.id`, `ID повторяет options.${previousId}`)
    else if (id) optionIds.set(id, index)
    const textKey = normalizedKey(text)
    const previousText = optionTexts.get(textKey)
    if (textKey && previousText != null) error('option.text_duplicate', `options.${index}.text`, `Вариант повторяет options.${previousText}`)
    else if (textKey) optionTexts.set(textKey, index)
  })

  const correctOptionId = normalizeText(question.correctOptionId)
  if (!correctOptionId || !optionIds.has(correctOptionId)) {
    error('question.correct_option_missing', 'correctOptionId', 'Правильный вариант должен входить в options')
  }
  const explanation = normalizeText(question.explanation)
  if (!explanation) error('question.explanation_required', 'explanation', 'Добавьте объяснение ответа')
  if (explanation.length > 800) error('question.explanation_long', 'explanation', 'Объяснение длиннее 800 символов')

  if (!normalizeText(question.category?.id) || !/^[a-z0-9_-]{1,60}$/.test(String(question.category?.id ?? ''))) {
    error('question.category_id', 'category.id', 'Недопустимый ID категории')
  }
  if (!normalizeText(question.category?.label)) error('question.category_label', 'category.label', 'Добавьте название категории')
  if (!TERRITORY_DIFFICULTIES.includes(question.difficulty as TerritoryQuestionItem['difficulty'])) {
    error('question.difficulty', 'difficulty', 'Недопустимая сложность')
  }

  const provenance = question.provenance
  if (!provenance || typeof provenance !== 'object') {
    error('provenance.required', 'provenance', 'Добавьте происхождение вопроса')
  } else {
    if (!normalizeText(provenance.dataset)) error('provenance.dataset', 'provenance.dataset', 'Укажите набор данных')
    if (!normalizeText(provenance.license)) error('provenance.license', 'provenance.license', 'Укажите лицензию')
    if (provenance.sourceUrl != null && !isHttpUrl(provenance.sourceUrl)) error('provenance.source_url', 'provenance.sourceUrl', 'Некорректный URL источника')
    if (provenance.licenseUrl != null && !isHttpUrl(provenance.licenseUrl)) error('provenance.license_url', 'provenance.licenseUrl', 'Некорректный URL лицензии')
    if (provenance.retrievedAt != null && Number.isNaN(Date.parse(provenance.retrievedAt))) {
      error('provenance.retrieved_at', 'provenance.retrievedAt', 'Некорректная дата получения источника')
    }
    const entityIds = new Set(provenance.entityIds ?? [])
    const propertyIds = new Set(provenance.propertyIds ?? [])
    ;(provenance.verificationClaims ?? []).forEach((claim, index) => {
      if (entityIds.size && !entityIds.has(claim.entityId)) {
        error('provenance.claim_entity', `provenance.verificationClaims.${index}.entityId`, 'Entity отсутствует в entityIds')
      }
      if (propertyIds.size && !propertyIds.has(claim.propertyId)) {
        error('provenance.claim_property', `provenance.verificationClaims.${index}.propertyId`, 'Property отсутствует в propertyIds')
      }
    })
    if (!(provenance.sourceUrl || provenance.sourceTitle)) {
      warning('provenance.source_label', 'provenance', 'Добавьте URL или название первичного источника')
    }
  }

  if (question.allowedInGame === true && question.contentStatus !== 'ready') {
    error('question.publish_status', 'allowedInGame', 'В игру можно допускать только готовый вопрос')
  }
  return issues
}

const hashSeed = (value: string) => {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

const seededRandom = (seed: string) => {
  let state = hashSeed(seed)
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

const rounded = (value: number) => Math.round(value * 1_000) / 1_000
const roundedPoint = (point: TerritoryMapPoint): TerritoryMapPoint => [rounded(point[0]), rounded(point[1])]

const cross = (origin: TerritoryMapPoint, left: TerritoryMapPoint, right: TerritoryMapPoint) => (
  (left[0] - origin[0]) * (right[1] - origin[1]) - (left[1] - origin[1]) * (right[0] - origin[0])
)

const convexHull = (points: TerritoryMapPoint[]): TerritoryMapPoint[] => {
  const sorted = [...points].sort((left, right) => left[0] - right[0] || left[1] - right[1])
  const lower: TerritoryMapPoint[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: TerritoryMapPoint[] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

const buildIslandBoundary = (random: () => number): TerritoryMapPoint[] => {
  const points: TerritoryMapPoint[] = []
  const pointCount = 32
  const phaseA = random() * Math.PI * 2
  const phaseB = random() * Math.PI * 2
  const phaseC = random() * Math.PI * 2
  const phaseD = random() * Math.PI * 2
  const horizontalBias = (random() - 0.5) * 52
  const verticalBias = (random() - 0.5) * 22
  for (let index = 0; index < pointCount; index += 1) {
    const angle = (index / pointCount) * Math.PI * 2
    const localRoughness = (random() - 0.5) * 0.05
    const broadLobes = Math.sin(angle * 2 + phaseA) * 0.075
      + Math.sin(angle * 3 + phaseB) * 0.055
    const horizontalContour = 0.97
      + broadLobes
      + Math.sin(angle + phaseC) * 0.055
      + Math.sin(angle * 5 + phaseD) * 0.025
      + localRoughness
    const verticalContour = 0.96
      + broadLobes * 0.8
      + Math.sin(angle + phaseD) * 0.045
      + Math.sin(angle * 4 + phaseC) * 0.035
      + localRoughness * 0.7
    points.push([
      CENTER[0] + horizontalBias + Math.cos(angle) * ISLAND_RADIUS_X * horizontalContour,
      CENTER[1] + verticalBias + Math.sin(angle) * ISLAND_RADIUS_Y * verticalContour,
    ])
  }
  // Keep the ordered radial contour instead of collapsing it to a convex hull.
  // The hull discarded most inward lobes and made every island read as the
  // same geometric lens. The contour is still simple (points stay in angular
  // order), but now each seed keeps its broad, board-game-like silhouette.
  return points
}

const buildSites = (cellCount: number, random: () => number): TerritoryMapPoint[] => {
  const rowCounts = cellCount === 11 ? [4, 3, 4] : cellCount === 13 ? [4, 5, 4] : [4, 4, 4]
  const sites: TerritoryMapPoint[] = []
  const horizontalDrift = (random() - 0.5) * 0.08
  const verticalDrift = (random() - 0.5) * 0.06
  const globalShear = (random() - 0.5) * 0.07

  rowCounts.forEach((rowCount, rowIndex) => {
    const rowPosition = rowIndex - 1
    const rowWidth = 0.72 + (random() - 0.5) * 0.09
    const rowShiftX = horizontalDrift + (random() - 0.5) * 0.14 + rowPosition * globalShear
    const rowShiftY = verticalDrift + (random() - 0.5) * 0.065
    const rowSlope = (random() - 0.5) * 0.07
    const rowBow = (random() - 0.5) * 0.09
    const horizontalJitter = rowCount === 5 ? 0.045 : 0.065

    for (let columnIndex = 0; columnIndex < rowCount; columnIndex += 1) {
      const columnPosition = rowCount === 1 ? 0 : (columnIndex / (rowCount - 1)) * 2 - 1
      let normalizedX = columnPosition * rowWidth
        + rowShiftX
        + (random() - 0.5) * horizontalJitter * 2
      let normalizedY = rowPosition * 0.49
        + rowShiftY
        + columnPosition * rowSlope
        + (columnPosition ** 2 - 0.4) * rowBow
        + (random() - 0.5) * 0.1

      // Keep the jittered row corners comfortably inside every generated hull.
      const ellipticalRadius = Math.hypot(normalizedX, normalizedY)
      if (ellipticalRadius > 0.84) {
        normalizedX *= 0.84 / ellipticalRadius
        normalizedY *= 0.84 / ellipticalRadius
      }
      sites.push([
        CENTER[0] + normalizedX * ISLAND_RADIUS_X,
        CENTER[1] + normalizedY * ISLAND_RADIUS_Y,
      ])
    }
  })

  // IDs must not encode a stable top-to-bottom tactical ordering.
  for (let index = sites.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[sites[index], sites[swapIndex]] = [sites[swapIndex], sites[index]]
  }
  return sites
}

const dedupePolygon = (polygon: TerritoryMapPoint[]): TerritoryMapPoint[] => {
  const result: TerritoryMapPoint[] = []
  for (const point of polygon) {
    const previous = result[result.length - 1]
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > GEOMETRY_EPSILON) result.push(point)
  }
  if (result.length > 1 && Math.hypot(result[0][0] - result[result.length - 1][0], result[0][1] - result[result.length - 1][1]) <= GEOMETRY_EPSILON) {
    result.pop()
  }
  return result
}

const clipToCloserHalfPlane = (
  polygon: TerritoryMapPoint[],
  site: TerritoryMapPoint,
  competitor: TerritoryMapPoint,
): TerritoryMapPoint[] => {
  if (!polygon.length) return []
  const coefficientX = 2 * (competitor[0] - site[0])
  const coefficientY = 2 * (competitor[1] - site[1])
  const constant = competitor[0] ** 2 + competitor[1] ** 2 - site[0] ** 2 - site[1] ** 2
  const signedDistance = (point: TerritoryMapPoint) => coefficientX * point[0] + coefficientY * point[1] - constant
  const result: TerritoryMapPoint[] = []

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    const startDistance = signedDistance(start)
    const endDistance = signedDistance(end)
    const startInside = startDistance <= GEOMETRY_EPSILON
    const endInside = endDistance <= GEOMETRY_EPSILON
    if (startInside) result.push(start)
    if (startInside !== endInside) {
      const ratio = startDistance / (startDistance - endDistance)
      result.push([
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ])
    }
  }
  return dedupePolygon(result)
}

const buildVoronoiPolygons = (boundary: TerritoryMapPoint[], sites: TerritoryMapPoint[]) => sites.map((site, siteIndex) => {
  let polygon = [...boundary]
  sites.forEach((competitor, competitorIndex) => {
    if (competitorIndex !== siteIndex) polygon = clipToCloserHalfPlane(polygon, site, competitor)
  })
  return polygon
})

const buildOrganicWarp = (seed: string) => {
  const random = seededRandom(`${seed}:organic-warp`)
  const phaseA = random() * Math.PI * 2
  const phaseB = random() * Math.PI * 2
  const phaseC = random() * Math.PI * 2
  const phaseD = random() * Math.PI * 2
  return (point: TerritoryMapPoint): TerritoryMapPoint => {
    const normalizedX = (point[0] - CENTER[0]) / ISLAND_RADIUS_X
    const normalizedY = (point[1] - CENTER[1]) / ISLAND_RADIUS_Y
    const offsetX = Math.sin(normalizedY * Math.PI * 2.8 + phaseA) * 12
      + Math.sin((normalizedX + normalizedY) * Math.PI * 3.2 + phaseB) * 5
    const offsetY = Math.sin(normalizedX * Math.PI * 4 + phaseC) * 13
      + Math.sin((normalizedX - normalizedY) * Math.PI * 2.8 + phaseD) * 5
    return [point[0] + offsetX, point[1] + offsetY]
  }
}

/**
 * Subdividing before one shared coordinate warp gives both cells the same
 * organic border instead of two independently-jittered edges with gaps.
 */
const organicPolygon = (
  polygon: TerritoryMapPoint[],
  warp: (point: TerritoryMapPoint) => TerritoryMapPoint,
): TerritoryMapPoint[] => {
  const result: TerritoryMapPoint[] = []
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    for (let segment = 0; segment < ORGANIC_EDGE_SEGMENTS; segment += 1) {
      const ratio = segment / ORGANIC_EDGE_SEGMENTS
      result.push(warp([
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ]))
    }
  }
  return dedupePolygon(result)
}

const normalizeWideGeometry = (polygons: TerritoryMapPoint[][], centers: TerritoryMapPoint[]) => {
  const points = polygons.flat()
  const minX = Math.min(...points.map((point) => point[0]))
  const maxX = Math.max(...points.map((point) => point[0]))
  const minY = Math.min(...points.map((point) => point[1]))
  const maxY = Math.max(...points.map((point) => point[1]))
  const width = maxX - minX
  const height = maxY - minY
  const middleX = (minX + maxX) / 2
  const scaleX = width > 0 && height > 0 ? TERRITORY_ISLAND_ASPECT * height / width : 1
  const scale = (point: TerritoryMapPoint): TerritoryMapPoint => [middleX + (point[0] - middleX) * scaleX, point[1]]
  return {
    polygons: polygons.map((polygon) => polygon.map(scale)),
    centers: centers.map(scale),
  }
}

const sharedBoundaryLength = (
  startA: TerritoryMapPoint,
  endA: TerritoryMapPoint,
  startB: TerritoryMapPoint,
  endB: TerritoryMapPoint,
) => {
  const vectorA: TerritoryMapPoint = [endA[0] - startA[0], endA[1] - startA[1]]
  const vectorB: TerritoryMapPoint = [endB[0] - startB[0], endB[1] - startB[1]]
  const lengthA = Math.hypot(vectorA[0], vectorA[1])
  const lengthB = Math.hypot(vectorB[0], vectorB[1])
  if (lengthA < GEOMETRY_EPSILON || lengthB < GEOMETRY_EPSILON) return 0
  const parallelError = Math.abs(vectorA[0] * vectorB[1] - vectorA[1] * vectorB[0]) / (lengthA * lengthB)
  const offsetError = Math.abs((startB[0] - startA[0]) * vectorA[1] - (startB[1] - startA[1]) * vectorA[0]) / lengthA
  if (parallelError > 1e-6 || offsetError > 1e-4) return 0
  const unitX = vectorA[0] / lengthA
  const unitY = vectorA[1] / lengthA
  const projectionStart = (startB[0] - startA[0]) * unitX + (startB[1] - startA[1]) * unitY
  const projectionEnd = (endB[0] - startA[0]) * unitX + (endB[1] - startA[1]) * unitY
  return Math.max(0, Math.min(lengthA, Math.max(projectionStart, projectionEnd)) - Math.max(0, Math.min(projectionStart, projectionEnd)))
}

const polygonsShareEdge = (left: TerritoryMapPoint[], right: TerritoryMapPoint[]) => {
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      if (sharedBoundaryLength(
        left[leftIndex],
        left[(leftIndex + 1) % left.length],
        right[rightIndex],
        right[(rightIndex + 1) % right.length],
      ) > 0.1) return true
    }
  }
  return false
}

const buildAdjacency = (polygons: TerritoryMapPoint[][]) => {
  const adjacency = polygons.map(() => new Set<number>())
  for (let left = 0; left < polygons.length; left += 1) {
    for (let right = left + 1; right < polygons.length; right += 1) {
      if (!polygonsShareEdge(polygons[left], polygons[right])) continue
      adjacency[left].add(right)
      adjacency[right].add(left)
    }
  }
  return adjacency
}

const graphDistanceByIndex = (adjacency: Array<Set<number>>, start: number, end: number) => {
  const queue: Array<[number, number]> = [[start, 0]]
  const visited = new Set([start])
  while (queue.length) {
    const [current, distance] = queue.shift()!
    if (current === end) return distance
    for (const next of adjacency[current]) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push([next, distance + 1])
    }
  }
  return null
}

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const pointToSegmentDistance = (point: TerritoryMapPoint, start: TerritoryMapPoint, end: TerritoryMapPoint) => {
  const deltaX = end[0] - start[0]
  const deltaY = end[1] - start[1]
  const lengthSquared = deltaX ** 2 + deltaY ** 2
  const projection = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared))
    : 0
  return Math.hypot(
    point[0] - (start[0] + deltaX * projection),
    point[1] - (start[1] + deltaY * projection),
  )
}

const polygonCenterClearance = (center: TerritoryMapPoint, polygon: TerritoryMapPoint[]) => Math.min(
  ...polygon.map((point, index) => pointToSegmentDistance(center, point, polygon[(index + 1) % polygon.length])),
)

const pointInsidePolygon = (point: TerritoryMapPoint, polygon: TerritoryMapPoint[]) => {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const start = polygon[index]
    const end = polygon[previous]
    if ((start[1] > point[1]) !== (end[1] > point[1])
      && point[0] < ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0]) inside = !inside
  }
  return inside
}

const polygonClearanceBelow = (center: TerritoryMapPoint, polygon: TerritoryMapPoint[]) => {
  let clearance = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    const deltaX = end[0] - start[0]
    if (Math.abs(deltaX) <= GEOMETRY_EPSILON) {
      if (Math.abs(center[0] - start[0]) <= GEOMETRY_EPSILON) {
        for (const y of [start[1], end[1]]) {
          if (y >= center[1]) clearance = Math.min(clearance, y - center[1])
        }
      }
      continue
    }
    const ratio = (center[0] - start[0]) / deltaX
    if (ratio < 0 || ratio > 1) continue
    const y = start[1] + (end[1] - start[1]) * ratio
    if (y >= center[1] - GEOMETRY_EPSILON) clearance = Math.min(clearance, Math.max(0, y - center[1]))
  }
  return Number.isFinite(clearance) ? clearance : 0
}

const selectBasePair = (
  sites: TerritoryMapPoint[],
  polygons: TerritoryMapPoint[][],
  adjacency: Array<Set<number>>,
  minimumLabelClearance: number,
): [number, number] => {
  const areas = polygons.map(polygonArea)
  const medianArea = median(areas)
  const geometryPoints = polygons.flat()
  const geometryWidth = Math.max(...geometryPoints.map((point) => point[0])) - Math.min(...geometryPoints.map((point) => point[0]))
  let best: [number, number] | null = null
  let bestQualityTier = -1
  let bestQualityFloor = -1
  let bestGraphDistance = -1
  let bestHorizontalDistance = -1

  for (let left = 0; left < sites.length; left += 1) {
    for (let right = left + 1; right < sites.length; right += 1) {
      const graphDistance = graphDistanceByIndex(adjacency, left, right)
      const horizontalDistance = Math.abs(sites[left][0] - sites[right][0])
      if (graphDistance == null || graphDistance < 3 || horizontalDistance < geometryWidth * 0.5) continue

      const leftInside = pointInsidePolygon(sites[left], polygons[left])
      const rightInside = pointInsidePolygon(sites[right], polygons[right])
      const minimumAreaRatio = Math.min(areas[left], areas[right]) / medianArea
      const minimumMarkerClearance = Math.min(
        polygonCenterClearance(sites[left], polygons[left]),
        polygonCenterClearance(sites[right], polygons[right]),
      )
      const minimumPairLabelClearance = Math.min(
        polygonClearanceBelow(sites[left], polygons[left]),
        polygonClearanceBelow(sites[right], polygons[right]),
      )
      const qualityFloor = leftInside && rightInside ? Math.min(
        minimumAreaRatio / BASE_MIN_AREA_MEDIAN_RATIO,
        minimumMarkerClearance / BASE_MIN_MARKER_CLEARANCE,
        minimumPairLabelClearance / minimumLabelClearance,
      ) : 0
      const bufferedQualityFloor = leftInside && rightInside ? Math.min(
        minimumAreaRatio / (BASE_MIN_AREA_MEDIAN_RATIO + 0.005),
        minimumMarkerClearance / (BASE_MIN_MARKER_CLEARANCE + BASE_SELECTION_BUFFER),
        minimumPairLabelClearance / (minimumLabelClearance + BASE_SELECTION_BUFFER),
      ) : 0
      const qualityTier = bufferedQualityFloor >= 1 ? 2 : qualityFloor >= 1 ? 1 : 0

      if (qualityTier > bestQualityTier
        || (qualityTier === bestQualityTier && qualityFloor > bestQualityFloor)
        || (qualityTier === bestQualityTier && qualityFloor === bestQualityFloor && graphDistance > bestGraphDistance)
        || (qualityTier === bestQualityTier && qualityFloor === bestQualityFloor && graphDistance === bestGraphDistance && horizontalDistance > bestHorizontalDistance)) {
        best = [left, right]
        bestQualityTier = qualityTier
        bestQualityFloor = qualityFloor
        bestGraphDistance = graphDistance
        bestHorizontalDistance = horizontalDistance
      }
    }
  }

  if (!best) {
    const byX = sites.map((site, index) => ({ index, x: site[0] })).sort((left, right) => left.x - right.x || left.index - right.index)
    best = [byX[0].index, byX[byX.length - 1].index]
  }
  return sites[best[0]][0] <= sites[best[1]][0] ? best : [best[1], best[0]]
}

const shuffled = <Value>(values: Value[], random: () => number) => {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

const assignCellValues = (cellIds: string[], baseCellIds: [string, string], seed: string) => {
  const nonBaseIds = cellIds.filter((cellId) => !baseCellIds.includes(cellId))
  const values = shuffled(nonBaseIds.map((_, index) => [100, 150, 200][index % 3] as 100 | 150 | 200), seededRandom(`${seed}:values`))
  const result = new Map<string, 100 | 150 | 200>(baseCellIds.map((cellId) => [cellId, 100]))
  nonBaseIds.forEach((cellId, index) => result.set(cellId, values[index]))
  return result
}

const ensureCellCount = (cellCount: number) => {
  if (!Number.isInteger(cellCount) || cellCount < TERRITORY_MIN_CELL_COUNT || cellCount > TERRITORY_MAX_CELL_COUNT) {
    throw new RangeError(`Territory map must contain ${TERRITORY_MIN_CELL_COUNT}-${TERRITORY_MAX_CELL_COUNT} cells`)
  }
}

const ensureSeed = (seed: string) => {
  if (!seed.trim()) throw new TypeError('Territory map seed must not be empty')
}

const buildProceduralCandidate = (seed: string, cellCount: number, attempt: number): TerritoryMapSnapshot => {
  const attemptSeed = `${seed}:attempt:${attempt}`
  const random = seededRandom(attemptSeed)
  const boundary = buildIslandBoundary(random)
  const sites = buildSites(cellCount, random)
  const polygons = buildVoronoiPolygons(boundary, sites)
  const adjacency = buildAdjacency(polygons)
  const warp = buildOrganicWarp(attemptSeed)
  const normalizedGeometry = normalizeWideGeometry(
    polygons.map((polygon) => organicPolygon(polygon, warp)),
    sites.map(warp),
  )
  const visualSites = normalizedGeometry.centers
  const visualPolygons = normalizedGeometry.polygons
  const ids = sites.map((_, index) => `t${String(index + 1).padStart(2, '0')}`)
  const baseIndexes = selectBasePair(visualSites, visualPolygons, adjacency, BASE_PREFERRED_LABEL_CLEARANCE)
  const baseCellIds: [string, string] = [ids[baseIndexes[0]], ids[baseIndexes[1]]]
  const cellValues = assignCellValues(ids, baseCellIds, attemptSeed)
  const cells: TerritoryMapCell[] = visualSites.map((site, index) => ({
    id: ids[index],
    value: cellValues.get(ids[index])!,
    center: roundedPoint(site),
    polygon: visualPolygons[index].map(roundedPoint),
    adjacentCellIds: [...adjacency[index]].map((neighbor) => ids[neighbor]).sort(),
  }))
  return {
    version: TERRITORY_MAP_VERSION,
    seed,
    generation: 'procedural',
    viewBox: { ...VIEW_BOX },
    cellCount,
    baseCellIds,
    cells,
  }
}

export const createTerritoryFallbackMap = (seed: string, cellCount = 12): TerritoryMapSnapshot => {
  ensureSeed(seed)
  ensureCellCount(cellCount)
  const random = seededRandom(`${seed}:fallback`)
  const rotation = random() * Math.PI * 2
  const ids = Array.from({ length: cellCount }, (_, index) => `t${String(index + 1).padStart(2, '0')}`)
  const outerPoints = ids.map((_, index): TerritoryMapPoint => {
    const angle = rotation + (index / cellCount) * Math.PI * 2
    const horizontalContour = 0.95 + 0.03 * Math.sin(angle * 3 + rotation) + 0.015 * Math.sin(angle + rotation * 0.5)
    const verticalContour = 0.97 + 0.035 * Math.sin(angle * 2 + rotation)
    return [
      CENTER[0] + Math.cos(angle) * ISLAND_RADIUS_X * horizontalContour,
      CENTER[1] + Math.sin(angle) * ISLAND_RADIUS_Y * verticalContour,
    ]
  })
  const adjacency = ids.map((_, index) => new Set([
    (index - 1 + cellCount) % cellCount,
    (index + 1) % cellCount,
  ]))
  const rawPolygons = ids.map((_, index): TerritoryMapPoint[] => [CENTER, outerPoints[index], outerPoints[(index + 1) % cellCount]])
  const warp = buildOrganicWarp(`${seed}:fallback`)
  const normalizedGeometry = normalizeWideGeometry(
    rawPolygons.map((polygon) => organicPolygon(polygon, warp)),
    rawPolygons.map((polygon) => warp([
      (polygon[0][0] + polygon[1][0] + polygon[2][0]) / 3,
      (polygon[0][1] + polygon[1][1] + polygon[2][1]) / 3,
    ])),
  )
  const visualPolygons = normalizedGeometry.polygons
  const visualSites = normalizedGeometry.centers
  const baseIndexes = selectBasePair(visualSites, visualPolygons, adjacency, FALLBACK_BASE_MIN_LABEL_CLEARANCE)
  const baseCellIds: [string, string] = [ids[baseIndexes[0]], ids[baseIndexes[1]]]
  const cellValues = assignCellValues(ids, baseCellIds, `${seed}:fallback`)
  const cells: TerritoryMapCell[] = ids.map((id, index) => {
    const nextIndex = (index + 1) % cellCount
    const previousIndex = (index - 1 + cellCount) % cellCount
    return {
      id,
      value: cellValues.get(id)!,
      center: roundedPoint(visualSites[index]),
      polygon: visualPolygons[index].map(roundedPoint),
      adjacentCellIds: [ids[previousIndex], ids[nextIndex]].sort(),
    }
  })
  return {
    version: TERRITORY_MAP_VERSION,
    seed,
    generation: 'fallback',
    viewBox: { ...VIEW_BOX },
    cellCount,
    baseCellIds,
    cells,
  }
}

function polygonArea(polygon: TerritoryMapPoint[]) {
  return Math.abs(polygon.reduce((area, point, index) => {
  const next = polygon[(index + 1) % polygon.length]
  return area + point[0] * next[1] - next[0] * point[1]
  }, 0) / 2)
}

const pointOnSegment = (point: TerritoryMapPoint, start: TerritoryMapPoint, end: TerritoryMapPoint) => (
  Math.abs(cross(start, end, point)) <= 1e-6
  && point[0] >= Math.min(start[0], end[0]) - 1e-6
  && point[0] <= Math.max(start[0], end[0]) + 1e-6
  && point[1] >= Math.min(start[1], end[1]) - 1e-6
  && point[1] <= Math.max(start[1], end[1]) + 1e-6
)

const segmentsIntersect = (
  startA: TerritoryMapPoint,
  endA: TerritoryMapPoint,
  startB: TerritoryMapPoint,
  endB: TerritoryMapPoint,
) => {
  const orientationA = cross(startA, endA, startB)
  const orientationB = cross(startA, endA, endB)
  const orientationC = cross(startB, endB, startA)
  const orientationD = cross(startB, endB, endA)
  if (((orientationA > 1e-6 && orientationB < -1e-6) || (orientationA < -1e-6 && orientationB > 1e-6))
    && ((orientationC > 1e-6 && orientationD < -1e-6) || (orientationC < -1e-6 && orientationD > 1e-6))) return true
  return (Math.abs(orientationA) <= 1e-6 && pointOnSegment(startB, startA, endA))
    || (Math.abs(orientationB) <= 1e-6 && pointOnSegment(endB, startA, endA))
    || (Math.abs(orientationC) <= 1e-6 && pointOnSegment(startA, startB, endB))
    || (Math.abs(orientationD) <= 1e-6 && pointOnSegment(endA, startB, endB))
}

const polygonSelfIntersects = (polygon: TerritoryMapPoint[]) => {
  for (let left = 0; left < polygon.length; left += 1) {
    const leftNext = (left + 1) % polygon.length
    for (let right = left + 1; right < polygon.length; right += 1) {
      const rightNext = (right + 1) % polygon.length
      if (left === right || leftNext === right || rightNext === left) continue
      if (segmentsIntersect(polygon[left], polygon[leftNext], polygon[right], polygon[rightNext])) return true
    }
  }
  return false
}

const geometryPointKey = (point: TerritoryMapPoint) => `${point[0].toFixed(3)},${point[1].toFixed(3)}`

const territoryGeometryBounds = (map: TerritoryMapSnapshot) => {
  const points = map.cells.flatMap((cell) => cell.polygon).filter((point) => point.every(Number.isFinite))
  if (!points.length) return null
  const minX = Math.min(...points.map((point) => point[0]))
  const maxX = Math.max(...points.map((point) => point[0]))
  const minY = Math.min(...points.map((point) => point[1]))
  const maxY = Math.max(...points.map((point) => point[1]))
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY }
}

export const validateTerritoryMap = (input: TerritoryMapSnapshot): TerritoryValidationIssue[] => {
  const issues: TerritoryValidationIssue[] = []
  const error = (code: string, path: string, message: string) => issues.push({ severity: 'error', code, path, message })
  if (input.version !== TERRITORY_MAP_VERSION) error('map.version', 'version', 'Неизвестная версия карты')
  if (!Number.isInteger(input.cellCount) || input.cellCount < TERRITORY_MIN_CELL_COUNT || input.cellCount > TERRITORY_MAX_CELL_COUNT) {
    error('map.cell_count', 'cellCount', 'Карта должна содержать от 11 до 13 территорий')
  }
  if (input.cells.length !== input.cellCount) error('map.cells_count', 'cells', 'Число ячеек не совпадает с cellCount')
  if (!(input.viewBox.width > 0) || !(input.viewBox.height > 0)) error('map.view_box', 'viewBox', 'Размер SVG должен быть положительным')
  const geometryBounds = territoryGeometryBounds(input)
  if (geometryBounds && geometryBounds.height > 0) {
    const aspectRatio = geometryBounds.width / geometryBounds.height
    if (aspectRatio < TERRITORY_ISLAND_ASPECT_MIN || aspectRatio > TERRITORY_ISLAND_ASPECT_MAX) {
      error('map.aspect_ratio', 'cells', 'Остров должен быть широким, с отношением сторон около 2.5')
    }
  }

  const cellsById = new Map<string, TerritoryMapCell>()
  input.cells.forEach((cell, index) => {
    if (!cell.id || cellsById.has(cell.id)) error('cell.id', `cells.${index}.id`, 'ID территории должен быть уникальным')
    else cellsById.set(cell.id, cell)
    if (![100, 150, 200].includes(cell.value)) error('cell.value', `cells.${index}.value`, 'Недопустимая ценность территории')
    if (cell.polygon.length < 3 || polygonArea(cell.polygon) < 1) error('cell.polygon', `cells.${index}.polygon`, 'Полигон территории вырожден')
    if (cell.polygon.length > 64) error('cell.polygon_complexity', `cells.${index}.polygon`, 'Полигон территории содержит слишком много точек')
    if (polygonSelfIntersects(cell.polygon)) error('cell.polygon_self_intersection', `cells.${index}.polygon`, 'Полигон территории пересекает сам себя')
    if (![cell.center, ...cell.polygon].every((point) => point.length === 2 && point.every(Number.isFinite))) {
      error('cell.coordinates', `cells.${index}`, 'Координаты территории должны быть конечными числами')
    }
    if (!cell.adjacentCellIds.length) error('cell.isolated', `cells.${index}.adjacentCellIds`, 'У территории должен быть сосед')
    if (new Set(cell.adjacentCellIds).size !== cell.adjacentCellIds.length) error('cell.adjacency_duplicate', `cells.${index}.adjacentCellIds`, 'Соседи не должны повторяться')
  })

  input.cells.forEach((cell, index) => {
    cell.adjacentCellIds.forEach((neighborId) => {
      const neighbor = cellsById.get(neighborId)
      if (!neighbor) error('cell.adjacency_unknown', `cells.${index}.adjacentCellIds`, `Неизвестный сосед ${neighborId}`)
      else if (neighborId === cell.id) error('cell.adjacency_self', `cells.${index}.adjacentCellIds`, 'Территория не может соседствовать сама с собой')
      else if (!neighbor.adjacentCellIds.includes(cell.id)) error('cell.adjacency_asymmetric', `cells.${index}.adjacentCellIds`, `Связь с ${neighborId} несимметрична`)
      else {
        const ownPoints = new Set(cell.polygon.map(geometryPointKey))
        const sharedPointCount = neighbor.polygon.filter((point) => ownPoints.has(geometryPointKey(point))).length
        if (sharedPointCount < ORGANIC_EDGE_SEGMENTS + 1) error('cell.adjacency_geometry', `cells.${index}.adjacentCellIds`, `Граница с ${neighborId} имеет разрыв`)
      }
    })
  })

  const start = input.cells[0]?.id
  if (start) {
    const visited = new Set([start])
    const queue = [start]
    while (queue.length) {
      const current = cellsById.get(queue.shift()!)
      for (const next of current?.adjacentCellIds ?? []) {
        if (!cellsById.has(next) || visited.has(next)) continue
        visited.add(next)
        queue.push(next)
      }
    }
    if (visited.size !== input.cells.length) error('map.disconnected', 'cells', 'Граф территорий должен быть связным')
  }

  const [leftBase, rightBase] = input.baseCellIds
  if (leftBase === rightBase || !cellsById.has(leftBase) || !cellsById.has(rightBase)) {
    error('map.bases', 'baseCellIds', 'У карты должны быть две разные существующие базы')
  } else {
    const distance = territoryGraphDistance(input, leftBase, rightBase)
    if (distance == null || distance < 3) error('map.bases_distance', 'baseCellIds', 'Базы должны быть удалены минимум на три перехода')
    const leftCell = cellsById.get(leftBase)!
    const rightCell = cellsById.get(rightBase)!
    if (geometryBounds && Math.abs(leftCell.center[0] - rightCell.center[0]) < geometryBounds.width * 0.5) {
      error('map.bases_opposition', 'baseCellIds', 'Базы должны находиться на противоположных сторонах острова')
    }
    const medianCellArea = median(input.cells.map((cell) => polygonArea(cell.polygon)))
    const minimumLabelClearance = input.generation === 'fallback' ? FALLBACK_BASE_MIN_LABEL_CLEARANCE : BASE_MIN_LABEL_CLEARANCE
    ;[leftCell, rightCell].forEach((cell, baseIndex) => {
      const path = `baseCellIds.${baseIndex}`
      if (medianCellArea > 0 && polygonArea(cell.polygon) < medianCellArea * BASE_MIN_AREA_MEDIAN_RATIO) {
        error('map.base_area', path, 'База должна занимать не менее 70% медианной площади территории')
      }
      if (!pointInsidePolygon(cell.center, cell.polygon)) error('map.base_center', path, 'Центр базы должен находиться внутри территории')
      if (polygonCenterClearance(cell.center, cell.polygon) < BASE_MIN_MARKER_CLEARANCE) {
        error('map.base_marker_clearance', path, 'Вокруг маркера базы недостаточно свободного места')
      }
      if (polygonClearanceBelow(cell.center, cell.polygon) < minimumLabelClearance) {
        error('map.base_label_clearance', path, 'Под маркером базы недостаточно места для подписи стоимости')
      }
    })
  }
  return issues
}

export const createTerritoryMap = (seed: string, cellCount = 12): TerritoryMapSnapshot => {
  ensureSeed(seed)
  ensureCellCount(cellCount)
  let bestCandidate: TerritoryMapSnapshot | null = null
  let bestBalance = Number.NEGATIVE_INFINITY
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = buildProceduralCandidate(seed, cellCount, attempt)
    if (validateTerritoryMap(candidate).some((issue) => issue.severity === 'error')) continue
    const areas = candidate.cells.map((cell) => polygonArea(cell.polygon))
    const medianArea = median(areas)
    const smallestAreaRatio = Math.min(...areas) / medianArea
    const largestAreaRatio = Math.max(...areas) / medianArea
    const minimumCenterClearance = Math.min(...candidate.cells.map((cell) => polygonCenterClearance(cell.center, cell.polygon)))
    const balance = smallestAreaRatio * 4
      - Math.max(0, largestAreaRatio - 1.75) * 1.2
      - Math.max(0, 14 - minimumCenterClearance) / 14
    if (balance > bestBalance) {
      bestCandidate = candidate
      bestBalance = balance
    }
    if (smallestAreaRatio >= 0.62 && largestAreaRatio <= 1.75 && minimumCenterClearance >= 14) return candidate
  }
  return bestCandidate ?? createTerritoryFallbackMap(seed, cellCount)
}

export const territoryGraphDistance = (map: TerritoryMapSnapshot, startCellId: string, endCellId: string): number | null => {
  const cellsById = new Map(map.cells.map((cell) => [cell.id, cell]))
  if (!cellsById.has(startCellId) || !cellsById.has(endCellId)) return null
  const queue: Array<[string, number]> = [[startCellId, 0]]
  const visited = new Set([startCellId])
  while (queue.length) {
    const [cellId, distance] = queue.shift()!
    if (cellId === endCellId) return distance
    for (const adjacentCellId of cellsById.get(cellId)?.adjacentCellIds ?? []) {
      if (visited.has(adjacentCellId) || !cellsById.has(adjacentCellId)) continue
      visited.add(adjacentCellId)
      queue.push([adjacentCellId, distance + 1])
    }
  }
  return null
}

export const createInitialTerritoryOwnership = (
  map: TerritoryMapSnapshot,
  playerIds: readonly [string, string],
): TerritoryOwnership => {
  if (!playerIds[0] || !playerIds[1] || playerIds[0] === playerIds[1]) throw new TypeError('Territory match requires two distinct players')
  return Object.fromEntries(map.cells.map((cell) => [
    cell.id,
    cell.id === map.baseCellIds[0] ? playerIds[0] : cell.id === map.baseCellIds[1] ? playerIds[1] : null,
  ]))
}

export const legalTerritoryCaptures = (
  map: TerritoryMapSnapshot,
  ownership: TerritoryOwnership,
  playerId: string,
): string[] => {
  const cellsById = new Map(map.cells.map((cell) => [cell.id, cell]))
  const legal = new Set<string>()
  for (const cell of map.cells) {
    if ((ownership[cell.id] ?? null) !== playerId) continue
    for (const adjacentCellId of cell.adjacentCellIds) {
      if (cellsById.has(adjacentCellId) && (ownership[adjacentCellId] ?? null) !== playerId) legal.add(adjacentCellId)
    }
  }
  return [...legal].sort()
}

export const applyTerritoryCapture = (
  map: TerritoryMapSnapshot,
  ownership: TerritoryOwnership,
  playerId: string,
  cellId: string,
): TerritoryOwnership => {
  if (!legalTerritoryCaptures(map, ownership, playerId).includes(cellId)) throw new RangeError('Territory capture is not legal')
  return { ...ownership, [cellId]: playerId }
}

export const applyTerritoryCapitalCapture = (
  map: TerritoryMapSnapshot,
  ownership: TerritoryOwnership,
  attackerUserId: string,
  defenderUserId: string,
  capitalCellId: string,
): TerritoryOwnership => {
  if (!map.baseCellIds.includes(capitalCellId)) throw new RangeError('Territory capital cell is invalid')
  if ((ownership[capitalCellId] ?? null) !== defenderUserId) throw new RangeError('Territory capital is not owned by the defender')
  if (!legalTerritoryCaptures(map, ownership, attackerUserId).includes(capitalCellId)) throw new RangeError('Territory capital capture is not legal')
  return Object.fromEntries(map.cells.map((cell) => [
    cell.id,
    (ownership[cell.id] ?? null) === defenderUserId ? attackerUserId : ownership[cell.id] ?? null,
  ]))
}

export const resolveTerritorySiegeDuel = (input: {
  map: TerritoryMapSnapshot
  ownership: TerritoryOwnership
  siegeState: TerritorySiegeState
  playerIds: readonly [string, string]
  winnerUserId: string | null
}) => {
  const active = input.siegeState.active
  if (!active) throw new TypeError('Territory siege requires an active attack')
  const targetIndex = input.map.baseCellIds.indexOf(active.targetCellId)
  if (targetIndex < 0) throw new RangeError('Territory siege target must be a capital')
  const defenderUserId = input.playerIds[targetIndex]
  if (!defenderUserId || defenderUserId === active.attackerUserId) throw new RangeError('Territory siege defender is invalid')
  if (input.winnerUserId !== active.attackerUserId) {
    return {
      ownership: input.ownership,
      siegeState: { ...input.siegeState, active: null } satisfies TerritorySiegeState,
      capitalCaptured: false,
      previousOwnerUserId: null,
    }
  }
  const remaining = Math.max(0, (input.siegeState.towersRemaining[active.targetCellId] ?? TERRITORY_CAPITAL_TOWERS) - 1)
  const siegeState: TerritorySiegeState = {
    active: remaining > 0 ? active : null,
    towersRemaining: { ...input.siegeState.towersRemaining, [active.targetCellId]: remaining },
  }
  if (remaining > 0) {
    return { ownership: input.ownership, siegeState, capitalCaptured: false, previousOwnerUserId: null }
  }
  const previousOwnerUserId = input.ownership[active.targetCellId] ?? null
  return {
    ownership: applyTerritoryCapitalCapture(input.map, input.ownership, active.attackerUserId, defenderUserId, active.targetCellId),
    siegeState,
    capitalCaptured: true,
    previousOwnerUserId,
  }
}

export const territoryComparableOptionValues = (
  options: readonly { id: string; text: string }[],
): ReadonlyMap<string, number> | null => {
  const values = new Map<string, number>()
  let sharedUnit: string | null = null
  for (const option of options) {
    const normalized = option.text.normalize('NFKC').trim().replace(/[\u00a0\u202f]/gu, ' ')
    const match = normalized.match(/^([+-]?\d[\d\s]*(?:[.,]\d+)?)\s*([^\d]*)$/u)
    if (!match) return null
    const value = Number(match[1].replace(/\s/gu, '').replace(',', '.'))
    if (!Number.isFinite(value)) return null
    const unit = match[2].toLocaleLowerCase('ru-RU').replace(/[\s.]/gu, '')
    if (sharedUnit == null) sharedUnit = unit
    else if (sharedUnit !== unit) return null
    values.set(option.id, value)
  }
  return values.size === options.length ? values : null
}

export const territoryAnswerDistance = (
  options: readonly { id: string; text: string }[],
  correctOptionId: string,
  selectedOptionId: string,
): number | null => {
  const values = territoryComparableOptionValues(options)
  const correct = values?.get(correctOptionId)
  const selected = values?.get(selectedOptionId)
  return correct == null || selected == null ? null : Math.abs(selected - correct)
}

export const territoryCountForPlayer = (map: TerritoryMapSnapshot, ownership: TerritoryOwnership, playerId: string) => (
  map.cells.reduce((total, cell) => total + ((ownership[cell.id] ?? null) === playerId ? 1 : 0), 0)
)

export const territoryValueForPlayer = (map: TerritoryMapSnapshot, ownership: TerritoryOwnership, playerId: string) => (
  map.cells.reduce((total, cell) => total + ((ownership[cell.id] ?? null) === playerId ? cell.value : 0), 0)
)

export const territoryMajority = (cellCount: number) => {
  ensureCellCount(cellCount)
  return Math.floor(cellCount / 2) + 1
}

export const resolveTerritoryDuel = (input: {
  playerIds: readonly [string, string]
  answers: readonly TerritoryDuelAnswer[]
}): TerritoryDuelResolution => {
  const [leftPlayer, rightPlayer] = input.playerIds
  if (!leftPlayer || !rightPlayer || leftPlayer === rightPlayer) throw new TypeError('Territory duel requires two distinct players')
  const allowedPlayers = new Set(input.playerIds)
  const answersByPlayer = new Map<string, TerritoryDuelAnswer>()
  for (const answer of input.answers) {
    if (!allowedPlayers.has(answer.userId)) throw new TypeError('Territory answer belongs to an unknown player')
    if (answersByPlayer.has(answer.userId)) throw new TypeError('Territory player may answer only once')
    if (answer.elapsedMs != null && (!Number.isFinite(answer.elapsedMs) || answer.elapsedMs < 0)) throw new RangeError('Territory answer time must be non-negative')
    if (answer.distance != null && (!Number.isFinite(answer.distance) || answer.distance < 0)) throw new RangeError('Territory answer distance must be non-negative')
    if (answer.correct && answer.elapsedMs == null) throw new TypeError('Correct territory answer requires elapsed time')
    answersByPlayer.set(answer.userId, answer)
  }
  const left = answersByPlayer.get(leftPlayer)
  const right = answersByPlayer.get(rightPlayer)
  const leftCorrect = left?.correct === true
  const rightCorrect = right?.correct === true
  if (leftCorrect !== rightCorrect) return { winnerUserId: leftCorrect ? leftPlayer : rightPlayer, result: 'single_correct' }
  if (!leftCorrect && !rightCorrect) {
    if (!left || !right || left.distance == null || right.distance == null) return { winnerUserId: null, result: 'no_correct' }
    if (left.distance !== right.distance) {
      return { winnerUserId: left.distance < right.distance ? leftPlayer : rightPlayer, result: 'closer' }
    }
  }
  if (left?.elapsedMs == null || right?.elapsedMs == null) {
    if (left?.elapsedMs != null || right?.elapsedMs != null) {
      return { winnerUserId: left?.elapsedMs != null ? leftPlayer : rightPlayer, result: 'faster' }
    }
    return { winnerUserId: null, result: 'no_correct' }
  }
  const difference = Math.abs(left.elapsedMs - right.elapsedMs)
  if (difference < TERRITORY_SPEED_TIE_WINDOW_MS) return { winnerUserId: null, result: 'speed_tie' }
  return { winnerUserId: left.elapsedMs < right.elapsedMs ? leftPlayer : rightPlayer, result: 'faster' }
}

export const resolveTerritoryMatch = (input: {
  map: TerritoryMapSnapshot
  ownership: TerritoryOwnership
  players: readonly [TerritoryMatchPlayerStats, TerritoryMatchPlayerStats]
  duelCount: number
}): TerritoryMatchResolution => {
  const [left, right] = input.players
  if (!left.userId || !right.userId || left.userId === right.userId) throw new TypeError('Territory match requires two distinct players')
  if (!Number.isInteger(input.duelCount) || input.duelCount < 0) throw new RangeError('Territory duel count must be a non-negative integer')
  for (const player of input.players) {
    if (!Number.isInteger(player.correctAnswers) || player.correctAnswers < 0) throw new RangeError('Correct answer count must be a non-negative integer')
    if (!Number.isFinite(player.totalCorrectAnswerTimeMs) || player.totalCorrectAnswerTimeMs < 0) throw new RangeError('Correct answer time must be non-negative')
  }
  const knownPlayers = new Set(input.players.map((player) => player.userId))
  for (const cell of input.map.cells) {
    const owner = input.ownership[cell.id] ?? null
    if (owner != null && !knownPlayers.has(owner)) throw new TypeError(`Unknown territory owner: ${owner}`)
  }
  const scores = input.players.map((player): TerritoryMatchPlayerScore => ({
    ...player,
    territoryCount: territoryCountForPlayer(input.map, input.ownership, player.userId),
    territoryValueTotal: territoryValueForPlayer(input.map, input.ownership, player.userId),
  })) as [TerritoryMatchPlayerScore, TerritoryMatchPlayerScore]
  const capturedCapitalIndex = input.map.baseCellIds.findIndex((cellId, index) => {
    const ownerUserId = input.ownership[cellId] ?? null
    return ownerUserId != null && ownerUserId !== input.players[index].userId
  })
  if (capturedCapitalIndex >= 0) {
    const winnerUserId = input.ownership[input.map.baseCellIds[capturedCapitalIndex]] ?? null
    if (winnerUserId) return { status: 'finished', winnerUserId, finishReason: 'capital', scores }
  }
  const majority = territoryMajority(input.map.cellCount)
  const majorityWinner = scores.find((score) => score.territoryCount >= majority)
  if (majorityWinner) return { status: 'finished', winnerUserId: majorityWinner.userId, finishReason: 'majority', scores }
  if (input.duelCount < TERRITORY_MAX_DUELS) return { status: 'active', winnerUserId: null, finishReason: null, scores }

  const higherWins = (selector: (score: TerritoryMatchPlayerScore) => number) => {
    const difference = selector(scores[0]) - selector(scores[1])
    return difference === 0 ? null : difference > 0 ? scores[0].userId : scores[1].userId
  }
  const lowerWins = (selector: (score: TerritoryMatchPlayerScore) => number) => {
    const difference = selector(scores[0]) - selector(scores[1])
    return difference === 0 ? null : difference < 0 ? scores[0].userId : scores[1].userId
  }
  const byTerritories = higherWins((score) => score.territoryCount)
  if (byTerritories) return { status: 'finished', winnerUserId: byTerritories, finishReason: 'territories', scores }
  const byTerritoryValue = higherWins((score) => score.territoryValueTotal)
  if (byTerritoryValue) return { status: 'finished', winnerUserId: byTerritoryValue, finishReason: 'territory_value', scores }
  const byCorrectAnswers = higherWins((score) => score.correctAnswers)
  if (byCorrectAnswers) return { status: 'finished', winnerUserId: byCorrectAnswers, finishReason: 'correct_answers', scores }
  const byCorrectTime = lowerWins((score) => score.totalCorrectAnswerTimeMs)
  if (byCorrectTime) return { status: 'finished', winnerUserId: byCorrectTime, finishReason: 'correct_time', scores }
  return { status: 'finished', winnerUserId: null, finishReason: 'draw', scores }
}

export const TERRITORY_CORE_RULES_VERSION = TERRITORY_RULES_VERSION

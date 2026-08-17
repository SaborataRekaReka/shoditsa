export type DanetkiDifficulty = 'easy' | 'medium' | 'hard'
export type DanetkiAudience = 'family' | 'teen' | 'adult'
export type DanetkiTone = 'light' | 'warm' | 'wonder' | 'mystery' | 'tense' | 'dark'
export type DanetkiRoomMode = 'solo' | 'group'
export type DanetkiAiStatus = 'idle' | 'queued' | 'processing' | 'error'
export type DanetkiSenderKind = 'user' | 'ai' | 'system'
export type DanetkiMessageType = 'question' | 'answer' | 'hint' | 'guess' | 'event' | 'solution'

export type DanetkiKeyFact = {
  id: string
  text: string
  required: boolean
  aliases?: string[]
}

export type DanetkiPayload = {
  id: string
  mode: 'danetki'
  slug?: string
  titleRu: string
  titleOriginal: ''
  alternativeTitles?: string[]
  condition: string
  solution: string
  difficulty: DanetkiDifficulty
  genres: string[]
  tags: string[]
  keyFacts: DanetkiKeyFact[]
  hints: Array<{ level: 1 | 2 | 3; text: string }>
  starterQuestions: string[]
  answerRules: { requiredFactIds: string[]; minCoverage: number }
  contentWarnings: string[]
  audience?: DanetkiAudience
  tone?: DanetkiTone
  estimatedMinutes?: number
  isClassic?: boolean
  sourceNote?: string
  publishedAt?: string
  indexable?: boolean
  contentStatus: 'draft' | 'test' | 'ready' | 'blocked'
  allowedInGame: boolean
  popularityScore?: number
}

export type PublicDanetka = Pick<DanetkiPayload,
  'id' | 'slug' | 'titleRu' | 'condition' | 'difficulty' | 'genres' | 'starterQuestions' | 'contentWarnings' | 'audience' | 'tone' | 'estimatedMinutes'
>

export type DanetkiMember = {
  userId: string
  role: 'owner' | 'player'
  displayName: string
  colorKey: string
  joinedAt: string
  leftAt: string | null
  lastSeenAt: string
}

export type DanetkiMessage = {
  id: string
  seq: number
  senderKind: DanetkiSenderKind
  senderUserId: string | null
  senderName: string | null
  senderColorKey: string | null
  messageType: DanetkiMessageType
  text: string
  classification: 'yes' | 'no' | 'irrelevant' | 'unclear' | 'invalid' | null
  importance: 'critical' | 'useful' | 'neutral' | null
  parentMessageId: string | null
  createdAt: string
}

export type DanetkiGameState = {
  puzzle: PublicDanetka
  roomMode: DanetkiRoomMode
  startedAt: string | null
  currentTurnUserId: string | null
  capacity: number
  questionCount: number
  questionWarningAt: number
  questionLimit: number
  questionsRemaining: number
  hintLevel: number
  aiStatus: DanetkiAiStatus
  members: DanetkiMember[]
  messages: DanetkiMessage[]
  currentUserId: string
  canStart: boolean
  canInvite: boolean
  lastSeq: number
  outcome: 'playing' | 'won' | 'lost' | 'expired'
  solution?: string
}

export type DanetkiAnswerClassification = 'yes' | 'no' | 'irrelevant' | 'unclear' | 'invalid'

export type DanetkiAiAnswer = {
  classification: DanetkiAnswerClassification
  answer: string
  importance: 'critical' | 'useful' | 'neutral'
  revealedFactIds: string[]
  shouldUpdateSummary: boolean
}

export type DanetkiGuessEvaluation = {
  isCorrect: boolean
  coverage: number
  matchedFactIds: string[]
  missingRequiredFactIds: string[]
  feedback: string
}

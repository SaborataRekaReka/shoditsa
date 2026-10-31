/** Versioned room API. Questions and answers never travel in the lobby catalog. */
export const SVOYAK_API = '/api/v1/svoyak'
export const SVOYAK_AVATARS = [
  { id: 'cat', face: '🐱', label: 'Кот' }, { id: 'fox', face: '🦊', label: 'Лиса' },
  { id: 'frog', face: '🐸', label: 'Лягушка' }, { id: 'panda', face: '🐼', label: 'Панда' },
  { id: 'lion', face: '🦁', label: 'Лев' }, { id: 'penguin', face: '🐧', label: 'Пингвин' },
  { id: 'octopus', face: '🐙', label: 'Осьминог' }, { id: 'unicorn', face: '🦄', label: 'Единорог' },
] as const
export type AvatarId = typeof SVOYAK_AVATARS[number]['id']
export type Preferences = { topics: string[] }
export type Member = { id: string; name: string; avatar: AvatarId; role: 'host' | 'player'; ready: boolean; preferences: Preferences; score: number; connected?: boolean }
export type RoomSettings = { rounds: number; themesPerRound: number; secondsPerQuestion: number; age: 16 | 18 }
export type Catalog = {
  revision: string; localOnly: boolean; total: number; playable: number
  packs: { id: number; title: string; total: number; playable: number; topics: string[] }[]
  topics: { id: string; label: string; playable: number }[]
}
export type ThemeInfo = { id: string; name: string; topic: string; round: number; packTitle: string }
export type MixPlan = {
  algorithm?: 'topics-v2'
  distribution?: { topic: string; weight: number; questions: number }[]
  id: string; libraryRevision: string; questions: number; estimatedMinutes: number; themes: ThemeInfo[]
  coverage: { playerId: string; name: string; themes: number }[]
}
export type BoardTheme = ThemeInfo & { questions: { id: string; points: number; played: boolean }[] }
export type ActiveQuestion = {
  id: string; theme: string; points: number; prompt: string
  phase: 'reading' | 'buzzed' | 'timeout' | 'resolved'; deadline: number | null; durationMs: number; remainingMs: number
  answeringId: string | null; rejectedIds: string[]; result: 'correct' | 'skipped' | null
  media?: QuestionMedia[]
  answer?: { text: string; aliases: string[]; note: string; source: string; packTitle: string }
}
export type QuestionMedia = { kind: 'image' | 'audio' | 'video'; url: string; caption: string; phase: 'question' | 'answer' }
export type EditableQuestion = {
  id: string; hash: string; themeId: string; theme: string; topic: string; packId: number; packTitle: string
  prompt: string; answer: string; aliases: string[]; note: string; source: string; difficulty: number; age: number
  duplicateIds: string[]; media?: QuestionMedia[]; enabled: boolean
  sourceQuestionId?: string
  review?: { checks: Record<string, boolean>; textOnlyAdaptation: boolean; missingMediaResolved: boolean }
}
export type SvoyakSourceMedia = Omit<QuestionMedia, 'url'> & { url: string | null; reference: string; status: string; issues: string[]; review: string }
export type SvoyakSourceQuestion = {
  id: string; originalPrompt: string; originalAnswer: string; originalHash: string
  reviewStatus: string; blockers: string[]; checks: Record<string, boolean>; evidence: unknown[]; revision: number
  genre: string; mediaPolicy: string; format: string; media: SvoyakSourceMedia[]; originalMedia: SvoyakSourceMedia[]
  originalAtoms: unknown[]; history: unknown[]; edition: unknown; reviewNote: string
}
export type SvoyakLibrarySnapshot = {
  version: 1; importedAt: string; summary: { total: number; packs: number; withMedia: number; unavailableMedia: number; assets: number; bytes: number }
  questions: EditableQuestion[]; sources: Record<string, SvoyakSourceQuestion>
  assets: Record<string, { path: string; mime: string; bytes: number }>
  packs: Catalog['packs']; topics: Catalog['topics']
}
export type SvoyakWorkspace = { version: number; baseRevision: string; catalog: Catalog; questions: EditableQuestion[] }
export type SvoyakAdminState = { activeRevision: string; draft: boolean; workspace: SvoyakWorkspace; sources?: Record<string, SvoyakSourceQuestion>; library?: Pick<SvoyakLibrarySnapshot, 'summary' | 'importedAt'>; revisions: { id: string; status: string; createdAt: string; count: number }[] }
export type RoomView = {
  apiVersion: 1; code: string; revision: number; stage: 'lobby' | 'playing' | 'result' | 'closed'
  hostId: string; settings: RoomSettings; members: Member[]; me: Member | null; plan: MixPlan | null
  preparation: { status: 'waiting' | 'building' | 'ready' | 'error'; message?: string }
  board: BoardTheme[]; current: ActiveQuestion | null; chooserId: string | null
  played: number; total: number; completed: boolean; serverNow: number
}
export type Credentials = { code: string; token: string; memberId: string }
export type Command =
  | { type: 'profile'; name: string; avatar: AvatarId; preferences?: Preferences }
  | { type: 'preferences'; preferences: Preferences }
  | { type: 'ready'; ready: boolean }
  | { type: 'prepare' | 'start' | 'reveal' | 'next' | 'finish' | 'leave' | 'rematch' }
  | { type: 'choose'; questionId: string }
  | { type: 'buzz' }
  | { type: 'judge'; correct: boolean | null }
  | { type: 'settings'; settings: RoomSettings }
  | { type: 'kick'; memberId: string }
export type ApiFailure = { code: string; message: string }
export const svoyakHref = {
  title: '/games/svoyak', create: '/svoyak/create', join: (code: string) => `/svoyak/join/${encodeURIComponent(code)}`,
  room: (code: string) => `/svoyak/rooms/${encodeURIComponent(code)}`,
  result: (code: string) => `/svoyak/rooms/${encodeURIComponent(code)}/result`,
}

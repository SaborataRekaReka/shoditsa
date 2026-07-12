import type { Attempt, GameStatus, HintChoice, HintCheckpoint, TitleItem } from '../types'

export type GameSessionState = {
  attempts: Attempt[]
  status: GameStatus
  query: string
  selected: TitleItem | null
  activeSuggestionIndex: number
  message: string
  hintChoices: HintChoice[]
  dismissedHintRounds: HintCheckpoint[]
}

export type GameSessionResetPayload = Pick<GameSessionState, 'attempts' | 'status' | 'hintChoices' | 'dismissedHintRounds'>

type GameSessionAction =
  | { type: 'reset'; payload: GameSessionResetPayload }
  | { type: 'set_query'; query: string }
  | { type: 'append_query_char'; char: string }
  | { type: 'backspace_query' }
  | { type: 'set_selected'; selected: TitleItem | null }
  | { type: 'set_active_index'; index: number }
  | { type: 'set_message'; message: string }
  | { type: 'set_hint_choices'; hintChoices: HintChoice[] }
  | { type: 'set_dismissed_rounds'; rounds: HintCheckpoint[] }
  | { type: 'submit_attempt'; attempts: Attempt[]; status: GameStatus }

export const createInitialGameSessionState = (): GameSessionState => ({
  attempts: [],
  status: 'playing',
  query: '',
  selected: null,
  activeSuggestionIndex: -1,
  message: '',
  hintChoices: [],
  dismissedHintRounds: [],
})

export const gameSessionReducer = (state: GameSessionState, action: GameSessionAction): GameSessionState => {
  switch (action.type) {
    case 'reset':
      return {
        ...state,
        attempts: action.payload.attempts,
        status: action.payload.status,
        hintChoices: action.payload.hintChoices,
        dismissedHintRounds: action.payload.dismissedHintRounds,
        query: '',
        selected: null,
        activeSuggestionIndex: -1,
        message: '',
      }
    case 'set_query':
      return { ...state, query: action.query }
    case 'append_query_char':
      return { ...state, query: `${state.query}${action.char}` }
    case 'backspace_query':
      return { ...state, query: state.query.slice(0, -1) }
    case 'set_selected':
      return { ...state, selected: action.selected }
    case 'set_active_index':
      return { ...state, activeSuggestionIndex: action.index }
    case 'set_message':
      return { ...state, message: action.message }
    case 'set_hint_choices':
      return { ...state, hintChoices: action.hintChoices }
    case 'set_dismissed_rounds':
      return { ...state, dismissedHintRounds: action.rounds }
    case 'submit_attempt':
      return {
        ...state,
        attempts: action.attempts,
        status: action.status,
        query: '',
        selected: null,
        activeSuggestionIndex: -1,
        message: '',
      }
    default:
      return state
  }
}

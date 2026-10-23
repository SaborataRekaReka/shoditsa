import { GameArtwork } from '../../components/ui/GameArtwork'
import type { TitleMode } from '../../types'

const notes: Record<TitleMode, string> = {
  movie: 'Хорошее кино\nделает день лучше!',
  series: 'Ещё одна серия…\nто есть попытка!',
  anime: 'Хорошее\nаниме делает\nдень лучше!',
  game: 'Твой игровой опыт\nточно пригодится!',
  city: 'У любопытства\nнет границ.',
  music: 'Ответ где-то\nмежду нот.',
  diagnosis: 'Все детали\nимеют значение.',
  animal: 'Кто притаился\nв этой загадке?',
  book: 'Разгадка —\nмежду строк.',
  character: 'Кажется,\nмы знакомы!',
}

export function ReferenceSessionArt({ mode }: { mode: TitleMode }) {
  return <div className="reference-session-visual" aria-hidden="true">
    <span className="reference-session-note">{notes[mode]}<span>♡</span></span>
    <GameArtwork mode={mode === 'anime' ? 'anime-hero' : mode} className="reference-session-art" width={200} height={190} alt="" />
  </div>
}

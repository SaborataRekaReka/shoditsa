import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { LockKeyhole } from 'lucide-react'
import { InlineAlert } from '../../components/ui'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import type { ClubLibraryItem } from './club-library-model'
import { clubLibraryCover } from './club-library-covers'

type Props = {
  previews: readonly Pick<ClubLibraryItem, 'id' | 'title' | 'mode' | 'coverUrl'>[]
  state: 'loading' | 'error' | 'ready'
  onRetry: () => void
}

/** Only public artwork and titles appear here; launches and progress stay gated. */
export function StudyClubLockedPreviews({ previews, state, onRetry }: Props) {
  if (state === 'loading') return <p className="club-library-preview-status" role="status">Загружаем превью спецпоказов…</p>
  if (state === 'error') return <InlineAlert tone="warning">Не удалось загрузить превью.<QuestButton kind="text" onClick={onRetry}>Повторить</QuestButton></InlineAlert>
  if (!previews.length) return <p className="club-library-preview-status">Новые спецпоказы появятся здесь.</p>
  return <ul className="club-library-locked-previews" aria-label="Превью закрытых спецпоказов">{previews.map(pack => <li className="club-library-locked-preview" key={pack.id}>
    <div className="club-library-locked-cover"><ThemedArtwork src={clubLibraryCover(pack)} alt="" width="300" height="200" loading="lazy" /><span className="club-library-preview-lock"><LockKeyhole size={18} aria-hidden="true" /><span>В Клубе</span></span></div>
    <h3>{pack.title}</h3>
  </li>)}</ul>
}

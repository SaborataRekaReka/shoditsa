import { QuestGlyph, type GlyphName } from './QuestArt'
import { GeneratedShoditsaGlyph } from './GeneratedShoditsaArt'
import { APPLICATION_DESIGN } from '../../app/application-design'

export const isShoditsaStudy = APPLICATION_DESIGN || (typeof document !== 'undefined' && document.documentElement.dataset.questSkin === 'shoditsa')

/** One illustration family per study; shared game mechanics stay identical. */
export function StudyGlyph({ name, size = 36, className = '' }: { name: GlyphName; size?: number; className?: string }) {
  if (!isShoditsaStudy) return <QuestGlyph name={name} size={size} className={className} />
  return <GeneratedShoditsaGlyph name={name} size={size} className={className} />
}

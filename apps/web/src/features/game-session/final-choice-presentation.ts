import type { FinalChoiceCandidateSnapshot } from '@shoditsa/contracts'
import type { TitleItem, TitleMode } from '../../types'

export const finalChoiceCandidateTitleItem = (
  mode: TitleMode,
  candidate: FinalChoiceCandidateSnapshot,
): TitleItem => ({
  id: candidate.item.id,
  mode,
  titleRu: candidate.item.titleRu,
  titleOriginal: candidate.item.titleOriginal ?? '',
  alternativeTitles: [],
  popularityScore: 0,
  posterUrl: candidate.item.posterUrl ?? null,
})

export const finalChoiceCandidateLabel = (candidate: FinalChoiceCandidateSnapshot) => [
  candidate.item.titleRu,
  candidate.item.titleOriginal && candidate.item.titleOriginal !== candidate.item.titleRu
    ? candidate.item.titleOriginal
    : null,
  candidate.primaryMeta,
  ...candidate.facts.map((fact) => fact.ariaLabel),
].filter(Boolean).join('. ')

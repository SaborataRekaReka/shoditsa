import { useId } from 'react'
import { publicAssetUrl } from '../../app/public-asset'
import './generated-shoditsa-art.css'

export type VectorSectionName = 'play' | 'archive' | 'league' | 'medal' | 'profile'

function ellipsePath(cx: number, cy: number, rx: number, ry: number) {
  const angle = -20 * Math.PI / 180
  const dx = rx * Math.cos(angle)
  const dy = rx * Math.sin(angle)
  return `M${cx - dx} ${cy - dy}A${rx} ${ry} -20 1 0 ${cx + dx} ${cy + dy}A${rx} ${ry} -20 1 0 ${cx - dx} ${cy - dy}Z`
}

/** Every <use> references editable paths, including the separately moving parts. */
export function SectionIconArtwork({ name }: { name: VectorSectionName }) {
  const id = useId().replace(/:/g, '')
  const src = `${publicAssetUrl(`images/shoditsa-study/generated-icons-v2/${name}.svg`)}#art`
  const art = (className?: string, clipPath?: string) => <use className={className} href={src} width="1280" height="1280" clipPath={clipPath ? `url(#${id}-${clipPath})` : undefined} />

  if (name === 'play') return <svg viewBox="0 0 1280 1280" width="48" height="48">
    <defs>
      <clipPath id={`${id}-purple`}><ellipse cx="969" cy="601" rx="121" ry="117" transform="rotate(-20 969 601)" /></clipPath>
      <clipPath id={`${id}-yellow`}><ellipse cx="797" cy="735" rx="116" ry="113" transform="rotate(-20 797 735)" /></clipPath>
      <clipPath id={`${id}-body`}><path clipRule="evenodd" d={`M0 0H1280V1280H0Z ${ellipsePath(969, 601, 121, 117)} ${ellipsePath(797, 735, 116, 113)}`} /></clipPath>
    </defs>
    {/* Keep the body visible throughout hover. Buttons move independently;
        there is no opacity/visibility handoff. */}
    <g className="section-controller">
      <ellipse cx="969" cy="601" rx="125" ry="121" fill="#caf1bd" />
      <ellipse cx="797" cy="735" rx="120" ry="117" fill="#caf1bd" />
      {art('section-controller__body', 'body')}
      <g className="section-controller__purple">{art(undefined, 'purple')}</g>
      <g className="section-controller__yellow">{art(undefined, 'yellow')}</g>
    </g>
  </svg>

  if (name === 'archive') return <svg viewBox="0 0 1280 1280" width="48" height="48">
    <defs>
      <clipPath id={`${id}-card`}><path d="M300 635L326 485Q335 437 387 445L738 500Q795 511 794 567L778 674L736 696Z" /></clipPath>
      <clipPath id={`${id}-front`}><path d="M0 595L744 707L1280 481V1280H0Z" /></clipPath>
    </defs>
    {art()}
    <g className="section-icon__parts">
      <g className="section-archive__card">{art(undefined, 'card')}</g>
      {art(undefined, 'front')}
    </g>
  </svg>

  return <svg viewBox="0 0 1280 1280" width="48" height="48">
    <defs>
      <mask id={`${id}-silhouette`} style={{ maskType: 'alpha' }}>{art()}</mask>
    </defs>
    <g className={`section-${name}`}>
      {art()}
      {name !== 'medal' && <g mask={`url(#${id}-silhouette)`}>
        <path className={`section-icon__gleam section-${name}__gleam`} d="M-290 -200H-150L330 1480H190Z" fill="white" fillOpacity=".52" />
      </g>}
    </g>
  </svg>
}


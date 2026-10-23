import { publicAssetUrl } from '../../app/public-asset'
import { useId } from 'react'
import type { GlyphName } from './QuestArt'
import './generated-shoditsa-art.css'
import { SectionIconArtwork } from './SectionIconArtwork'

// Follow the original ink seam, including the star clasp attached to the lid.
// The closed icon and both moving pieces share the same vector geometry.
const chestLid = 'M0 0H1280V644H1150L1120 658L1080 683L1040 705L1000 726L960 746L920 767L890 778L860 771L820 759L780 757L740 754L700 745L678 734L662 732L654 741L642 753L630 763L618 772L614 810L610 838L606 849L598 860L586 870L574 874L562 874L550 871L538 866L526 858L514 851L502 842L490 831L478 835L462 840L446 844L430 846L418 845L406 841L398 836L390 828L386 820L382 803L378 697L374 687L366 686L340 680L320 671L300 662L260 655L220 646L180 638L140 630H0Z'

function ChestArtwork({ src }: { src: string }) {
  const id = useId().replace(/:/g, '')
  return <svg viewBox="0 0 1280 1280" width="48" height="48" overflow="visible">
    <defs>
      <clipPath id={`${id}-lid`}><path d={chestLid} /></clipPath>
      <clipPath id={`${id}-body`}><path d={`M0 0H1280V1280H0Z ${chestLid}`} clipRule="evenodd" /></clipPath>
      <linearGradient id={`${id}-gold`}><stop stopColor="#fde899" /><stop offset="1" stopColor="#fde89b" /></linearGradient>
    </defs>
    <use className="shoditsa-chest__original" href={`${src}#art`} width="1280" height="1280" />
    <g className="shoditsa-chest__parts">
      <path d="M180 638L430 520L1140 644L879 774Z" fill="#67508d" stroke="#141416" strokeWidth="32" strokeLinejoin="round" />
      <path d="M239 634L434 555L1060 650L875 735Z" fill="#382d52" />
      <use href={`${src}#art`} width="1280" height="1280" clipPath={`url(#${id}-body)`} />
      {/* The only newly exposed surface sits underneath the original clasp. */}
      <path d="M350 675L692 741L672 900L350 846Z" fill={`url(#${id}-gold)`} />
      <path d="M194 655L875 788" fill="none" stroke="#f9d87e" strokeWidth="20" />
      <path d="M180 638L879 774L1120 652" fill="none" stroke="#141416" strokeWidth="28" strokeLinejoin="round" strokeLinecap="round" />
      <g className="shoditsa-chest__lid"><use href={`${src}#art`} width="1280" height="1280" clipPath={`url(#${id}-lid)`} /></g>
    </g>
  </svg>
}

/** Section artwork uses vector paths; utility glyphs keep their approved art. */
export function GeneratedShoditsaGlyph({ name, size = 36, className = '' }: { name: GlyphName; size?: number; className?: string }) {
  const src = publicAssetUrl(`images/shoditsa-study/generated-icons-v2/${name}.${name === 'quests' ? 'svg' : 'webp'}`)
  return <svg className={`quest-glyph shoditsa-generated-glyph ${className}`.trim()} data-glyph={name} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
    {name === 'quests' ? <ChestArtwork src={src} /> : name === 'play' || name === 'archive' || name === 'league' || name === 'medal' ? <SectionIconArtwork name={name} /> : <image href={src} x="0" y="0" width="48" height="48" preserveAspectRatio="xMidYMid meet" />}
  </svg>
}

import type { ReactNode } from 'react'
import type { GlyphName } from './QuestArt'

/* Owned illustration family: slightly irregular ink contours and flat pastel fills.
   Keep the SVG root and its 48-unit canvas so the study's geometry stays intact. */
const color = {
  ink: 'var(--shg-art-ink)', cream: 'var(--shg-art-cream)', mint: 'var(--shg-art-mint)',
  lime: 'var(--shg-art-lime)', lilac: 'var(--shg-art-lilac)', purple: 'var(--shg-art-purple)',
  yellow: 'var(--shg-art-yellow)', peach: 'var(--shg-art-peach)', coral: 'var(--shg-art-coral)',
  blue: 'var(--shg-art-blue)',
}

const art: Record<GlyphName, ReactNode> = {
  play: <>
    <path d="M15 13c5 1.2 13 1.2 18-.2 5 .5 7.4 7.5 9.2 17.6 1.4 8-3.6 10.7-8.5 4.1l-3.1-4.2H17.1l-3.7 4.8c-4.8 6-9.5 3.7-8-4.4C7.3 20.6 9.5 13.7 15 13Z" fill={color.mint} />
    <path d="m10.4 22.5 9.7.2m-4.9-5-.2 9.8" />
    <circle cx="31.1" cy="20.5" r="3" fill={color.lilac} /><circle cx="36.5" cy="26.8" r="2.5" fill={color.yellow} />
    <path d="m19 35 9-.1" stroke={color.purple} /><path d="m13 7 3.2 2m20-4-1.3 3.2" />
  </>,
  archive: <>
    <path d="m9 10 25-3 3.4 28.6-25.2 3Z" fill={color.lilac} />
    <path d="m5.4 17.3 13-.7 3.1 4.2 20.7-.6-2.8 19-31.1.8Z" fill={color.yellow} />
    <path d="m13 13 15-1.8m-13 6 11-1.3" stroke={color.purple} />
    <path d="m20 29 8-.3" /><path d="m35 4 1-2m4 6 2-.8" />
    <path d="m11 32 1 4.1" stroke={color.cream} strokeWidth="3.5" />
  </>,
  league: <>
    <path d="M12 11 5.4 11.5l.5 7.7c.4 4.6 4 7.1 9.7 6.3m20.5-14.7 6.4.8-.5 7.5c-.4 4.7-4.2 7.3-9.5 6.4" fill={color.peach} />
    <path d="m13 6 22.2.6-.8 13c-.5 8-4.6 12-10.2 12-6.2 0-10.3-4.6-10.7-12.4Z" fill={color.yellow} />
    <path d="m24 31 .1 8M16 42l16-.2" strokeWidth="4" />
    <path d="m24 12 2.1 4.1 4.6.7-3.3 3.2.7 4.5-4.1-2.1-4 2.1.8-4.5-3.3-3.2 4.5-.7Z" fill={color.cream} strokeWidth="1.7" />
    <path d="m7 3 1.7 2.1m32-2-1.7 2.1" />
  </>,
  quests: <>
    <path d="m6.1 22.7 35.7-.8-.3 19.1-34.8.8Z" fill={color.yellow} />
    <path d="M6 23c.1-10.8 6.2-16.5 17.5-16.5 11.6-.3 18 4.8 18.4 15.4l.1 5-36 1Z" fill={color.lilac} />
    <path d="m12 12 1 27m22-27-1 27" stroke={color.purple} strokeWidth="3.5" />
    <path d="m6 28 36-1" />
    <path d="m18.5 23 10-.3-.1 11-9.5.3Z" fill={color.cream} />
    <circle cx="24" cy="28" r="2.4" fill={color.yellow} strokeWidth="1" />
    <path d="m5 6 2 2m34-3-1 3" />
  </>,
  profile: <>
    <path d="m15 14-2.6-6M33 14l2.2-6" />
    <circle cx="11.4" cy="5.7" r="3.3" fill={color.lime} /><circle cx="36.2" cy="5.3" r="3.2" fill={color.lime} />
    <path d="m9.1 23-1.7-8 9 3.1c4.5-2 10.8-2 15.4 0l9-3.6-1.5 9c2.8 3.2 3.4 7.7.6 11.6-6 8.2-27.8 8.4-33.1-.3-2.3-3.8-1.4-8.3 2.3-11.8Z" fill={color.lime} />
    <path d="m13 27 5 2m17-2-5 2" strokeWidth="3.5" />
    <path d="m22 31 2 1.6 2-1.7m-5 4c2.2 2.1 4.4 2 6.3-.1" strokeWidth="1.7" />
    <path d="m10 32 3 1m22-1-3 1" stroke={color.purple} strokeWidth="1.7" />
  </>,
  more: <>
    <path d="m7 8 33 1-1 26-13.4.4-8.3 7 .2-6.7L7 35Z" fill={color.lilac} />
    {[15, 24, 33].map((x,i)=><circle key={x} cx={x} cy={22+i*.2} r="2.6" fill={color.cream} strokeWidth="1.5" />)}
    <path d="m12 13 8 .2" stroke={color.cream} strokeWidth="3" />
  </>,
  flame: <>
    <path d="M26 3c3.4 8-2.9 12.6-2.1 16.5 2.2-1.1 4-3.3 4.4-6.5C41.7 22.1 43 35 33.4 41.2 23.7 47.6 9 41.9 9 30.5c0-7.5 6-13 6.8-19.1 1.5 2 2.2 4.7 2.8 6.5C21 12.3 25.1 10.2 26 3Z" fill={color.peach} />
    <path d="M25.5 25c.1 4.6 5.3 5.4 5.2 10.3 0 4.4-4.4 7.7-8.1 6.5-7.9-2.2-6.1-11.1 2.9-16.8Z" fill={color.yellow} strokeWidth="1.7" />
  </>,
  ticket: <>
    <path d="m5 10 36-1 .2 10c-6 0-6.3 9-.1 9l-.1 10-35.6 1-.5-10c5.9-.2 5.6-9.2-.1-9.2Z" fill={color.blue} />
    <path d="m30 12 .1 4m0 5 .1 4m0 5 .1 5" strokeDasharray="2 3" />
    <path d="m12 24 4 4 8-9" fill="none" stroke={color.purple} strokeWidth="3" />
  </>,
  heart: <>
    <path d="M24.1 41.4C12 33.8 3.8 26 5.5 17.7 7.3 8.5 17 6.2 23.9 14c6.5-8.2 17-6 18.8 3.2 1.8 8.9-6.6 17-18.6 24.2Z" fill={color.coral} />
    <path d="M12 17c1.1-2 3.1-2.8 5.3-2" fill="none" stroke={color.cream} strokeWidth="3.6" />
    <path d="m30 34 3-2.8" stroke={color.peach} strokeWidth="3" />
  </>,
  bolt: <>
    <path d="m29 3-21 23 12-.2-2.2 19 23-26-13 .4Z" fill={color.yellow} />
    <path d="m27 11-5 10.2 6.7-.1-5.2 11" stroke={color.peach} strokeWidth="3" />
    <path d="m6 10 4 2M37 36l4 2" />
  </>,
  hint: <>
    <path d="M16 31c-6-4.1-9.1-8.7-8-15.1C9.1 9.6 15.5 5.1 23.3 5.2c8.4-.1 15.6 5.5 15.4 13.8-.1 5.5-3.7 9.1-7.5 12l-.6 7-13.4.3Z" fill={color.yellow} />
    <path d="m18 19 5.6 5.8 5.8-6.3m-5.8 6.3.2 11" strokeWidth="1.8" />
    <path d="m16.9 33 14-.3-.5 7.9-12.9.3Z" fill={color.mint} />
    <path d="m21 44 6-.2m-23-26-2-.1M43 17l2.3-.5M9 5 7 3m30 1 2-2" />
    <path d="m15 12-2.1 3" stroke={color.cream} strokeWidth="3.1" />
  </>,
  lock: <>
    <path d="m14 21-.1-7c-.2-13.6 20.5-13.9 20.5-.1l-.2 7.4" fill="none" stroke={color.ink} strokeWidth="5" />
    <path d="m8 20.4 32-1 .2 23-31.5.8Z" fill={color.lilac} />
    <path d="M27 30a3 3 0 0 0-6 0c0 1.2.7 2.1 1.5 2.6l-.1 3.9 3.1-.1-.1-3.8c.9-.6 1.6-1.5 1.6-2.6Z" fill={color.cream} strokeWidth="1.7" />
    <path d="m13 25 4-.1" stroke={color.cream} strokeWidth="3" />
  </>,
  medal: <>
    <path d="m13 27-3 17 10-4 5 5 2-17" fill={color.lilac} />
    <path d="m25 27 4 17 5-5 7 2-6-16" fill={color.mint} />
    <path d="m24 3 5.1 3.2 6-.1 2.3 5.4 4.6 3.7-1.6 5.8.2 6-5.3 2.7-3.6 4.7-5.9-1.3-5.8 1-3.8-4.6-5.2-2.8.3-6-1.4-5.8 4.7-3.6 2.5-5.3 6 .2Z" fill={color.yellow} />
    <path d="m17 18 5 5 9-11" fill="none" strokeWidth="3.5" />
  </>,
}

export function ShoditsaGlyph({ name, size = 36, className = '' }: { name: GlyphName; size?: number; className?: string }) {
  return <svg className={`quest-glyph shoditsa-glyph ${className}`.trim()} width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color.ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>{art[name]}</svg>
}

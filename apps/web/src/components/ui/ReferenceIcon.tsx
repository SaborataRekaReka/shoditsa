import type { ReactNode, SVGProps } from 'react'

// A small, rounded ink drawing for public editorial and game navigation.
// Meaningful controls retain their native label; decorative SVGs stay silent.
const drawings = {
  idea: <><path d="M8.2 15.5C5 13.6 5.1 7.8 8.7 6.3c5.1-2.5 10.7 3.6 6.6 8.3l-1.2 1.1-.4 3.1-4.4.2-.4-3.4Z" /><path d="m9.8 22 3.5-.2M12 1.5l.2 1.5M3.2 6l1.4 1M19.7 5.7l-1.3 1M2 12.1l1.5.2M20 12l1.5-.2" /></>,
  guide: <><path d="M12 5.5C9.7 3.8 5.4 3.9 2.7 5l.6 14c3-1.2 6.2-1 8.8.7 2.7-1.6 5.9-2 8.7-.8l.5-14c-2.9-1-6.7-.7-9.3.6Zm0 0 .1 14.2" /><path d="m6 8 3 .3m-2.8 3 2.7.2M15 8h2.8m-2.7 3 2.5-.2" /></>,
  search: <><path d="M16.7 10.2c.4 8.4-12.9 9-13.2.5C3.2 1.8 16.4 1.7 16.7 10.2Z" /><path d="m15.2 15 5.7 6.1" /></>,
  check: <path d="m4 12.2 5.3 5.1L20 6.3" />,
  arrow: <path d="m3 12 17-.3m-6-6 6.3 6-6.1 6.2" />,
  movie: <><path d="m3 10 18-4-1-4L2 6l1 4Zm0 0 .6 11L21 20.5l-.2-10.8Z" /><path d="m6 5 2 3m4-4 2 3m4-4 1 2M4 13h15" /></>,
  series: <><path d="m8 2 4 4 4-4M4 6.5l16-.4.5 14-17 .4L4 6.5Z" /><path d="m7 10 8-.2v7.4l-8 .2ZM18 11v1m0 3v1" /></>,
  anime: <><path d="M4.6 9.5 4 3l6 4.1c1.5-.4 2.9-.5 4.1-.1l5.7-4.6-.5 7c6.1 11.8-20.8 13-14.7.1Z" /><path d="M8 12.7v.6m8-.8v.6m-6 3c1.2 1.5 2.8 1.4 4 0M2 13l3 1m14-.5 3-1" /></>,
  game: <><path d="M7 7c3.3.6 6.7.5 10 0 3.2.9 6 12 2.6 12.5-1.7.2-3.8-3.7-5.3-3.5h-5c-1.5-.2-3.8 4-5.3 3.6C.7 18.8 3.8 7.7 7 7Z" /><path d="m5.8 11 4.4.1M8 9v4m7-2.5v.2m3 2v.2" /></>,
  city: <><path d="m2 21 20-.3M4 20V9l6-4 5 3v12M15 12l5-1v9M7 10v1m4-1v1m-4 3v1m4-1v1m-3 6v-3h3v3" /></>,
  music: <><path d="m10 16 .4-11L20 3l-.2 11M10.4 8l9.5-2" /><path d="M10 16c0 4-7 5-7 1.7 0-2.5 7-4 7-1.7Zm9.8-2c.1 4-7 5-7 1.7 0-2.5 7-4 7-1.7Z" /></>,
  diagnosis: <><path d="M4 3 3.5 9c.2 6.5 9.7 6.5 10-.2L13 3M4 3l2 .3M13 3l-2 .3M8.6 14c-.1 9 10 8.8 10.3 1" /><circle cx="19" cy="12.5" r="2.5" /></>,
  animal: <><path d="M7 15c2.8-5.9 7-5.9 9.9-.2 4 6-2 6.9-5 4.6-3.6 2.5-9.2 1.2-4.9-4.4Z" /><ellipse cx="4.5" cy="10" rx="2" ry="2.7" transform="rotate(-22 4.5 10)" /><ellipse cx="9" cy="5.5" rx="2" ry="2.7" /><ellipse cx="15" cy="5.5" rx="2" ry="2.7" /><ellipse cx="20" cy="10" rx="2" ry="2.7" transform="rotate(22 20 10)" /></>,
  character: <><path d="m4 3 16-.4.5 18L3.5 21 4 3Z" /><path d="M9 9c-.4-4 6-4.3 6-.2.3 4.4-6 4.5-6 .2ZM7 17c.8-5 9-5.2 10-.1" /></>,
  word: <><circle cx="12" cy="12" r="4" /><path d="M12 2v6m0 8v6M2 12h6m8 0h6M5 5l4 4m6 6 4 4M5 19l4-4m6-6 4-4" /></>,
  connections: <><path d="m3 3 6.5.2.2 6.5-6.6-.2L3 3Zm11.5.2L21 3l-.2 6.5-6.6.2.3-6.5ZM3.2 14.5l6.6-.2-.3 6.4L3 21l.2-6.5Zm11.1-.2 6.4.3.3 6.1-6.5.3-.2-6.7Z" /></>,
  danetki: <><path d="M3 4.5 21 4l-.5 13-10 .4-5 4 .3-4.2-3-.2L3 4.5Z" /><path d="M10 8c.1-2 4.9-2 4.3.5-.3 1.2-2.6 1.2-2.5 3M12 14v.1" /></>,
  calendar: <><path d="m3.5 5 17-.3.5 16-18 .3.5-16Zm4-3v5m9-5v5M4 10l16-.2M8 14v.1m4-.1v.1m4-.1v.1m-8 3v.1m4-.1v.1" /></>,
  user: <><path d="M8 7.7c-.3-5.4 8-5.7 8-.3.5 5.7-7.7 6-8 .3ZM4.5 21c0-10.8 15.3-10.5 15 0" /></>,
  flame: <path d="M13 2c.6 6-4.3 6.6-4.4 10.8-1.6-.5-2.5-2-2.6-3.8C.8 19 10.5 25 16.7 19.7 22.8 14.5 17.5 7 13 2Z" />,
  globe: <><path d="M21 12c.3 12-18.4 12-18-.2C3.4.2 20.7.3 21 12Z" /><path d="M12 3c-5 4.4-5 13.8 0 18 5-4.2 5-13.8 0-18ZM3 12l18-.3" /></>,
} satisfies Record<string, ReactNode>

export type ReferenceIconName = keyof typeof drawings | 'book'

export function ReferenceIcon({ name, size = 24, ...props }: SVGProps<SVGSVGElement> & { name: ReferenceIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{drawings[name === 'book' ? 'guide' : name]}</svg>
}

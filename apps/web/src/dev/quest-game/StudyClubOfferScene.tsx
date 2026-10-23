import { useId } from 'react'

/** A quiet corner of the Club garden. The mascot remains a single static image. */
export function StudyClubOfferScene() {
  const id = useId()
  return <svg className="club-offer-scene" viewBox="0 0 800 280" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-hill`} x1="0" y1="0" x2="1" y2="1">
        <stop className="club-offer-scene__hill-light" />
        <stop className="club-offer-scene__hill-shade" offset="1" />
      </linearGradient>
      <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="white" stopOpacity="0" offset=".28" />
        <stop stopColor="white" offset=".64" />
      </linearGradient>
      <mask id={`${id}-garden`}><rect width="800" height="280" fill={`url(#${id}-fade)`} /></mask>
    </defs>
    <g mask={`url(#${id}-garden)`}>
      <g className="club-offer-scene__sunlight"><circle cx="685" cy="68" r="39" /><circle cx="685" cy="68" r="54" /></g>
      <circle className="club-offer-scene__sun" cx="685" cy="68" r="27" />
      <path className="club-offer-scene__cloud" d="M497 95h90c17 0 17-17 5-20-3-15-20-23-34-16-10-22-43-17-47 8-21-5-29 28-14 28Z" />
      <path className="club-offer-scene__distant" d="M240 280Q410 208 528 210T800 177V280Z" />
      <path fill={`url(#${id}-hill)`} d="M284 280Q465 219 598 234T800 210V280Z" />
      <path className="club-offer-scene__seam" d="M487 238Q570 222 663 242M732 229l49-10" />
      <path className="club-offer-scene__near" d="M395 280Q580 245 800 247V280Z" />
      <path className="club-offer-scene__path" d="M634 230q-41 14-16 29l36 21h-79l-9-8q-18-21 68-42Z" />
      <g className="club-offer-scene__sprig">
        <path className="club-offer-scene__leaf" d="M773 268c-31-5-41-20-37-39 24 1 36 14 37 39Zm1-3c-9-34 2-57 21-65 10 28 0 51-21 65Z" />
        <path className="club-offer-scene__stem" d="M774 275q-9-34 14-64m-18 48-23-20" />
      </g>
      <g className="club-offer-scene__flower">
        <path className="club-offer-scene__stem" d="M470 273q-6-20 0-46" />
        <path className="club-offer-scene__leaf" d="M467 261q-19-2-20-16 17-2 20 16Z" />
        <g className="club-offer-scene__petals">
          <ellipse cx="470" cy="216" rx="8" ry="12" />
          <ellipse cx="459" cy="224" rx="8" ry="12" transform="rotate(-65 459 224)" />
          <ellipse cx="463" cy="236" rx="8" ry="12" transform="rotate(40 463 236)" />
          <ellipse cx="478" cy="235" rx="8" ry="12" transform="rotate(-40 478 235)" />
          <ellipse cx="482" cy="223" rx="8" ry="12" transform="rotate(65 482 223)" />
        </g>
        <circle className="club-offer-scene__flower-center" cx="471" cy="226" r="7" />
      </g>
    </g>
  </svg>
}

import { useId } from 'react'

export function MeadowLandscape() {
  const id = useId()
  return <svg className="club-sky__landscape" viewBox="0 0 1000 360" preserveAspectRatio="none">
    <defs>
      <linearGradient id={`${id}-hill`} x1="0" y1="0" x2="0" y2="1"><stop className="meadow-hill-light" /><stop className="meadow-hill-shade" offset="1" /></linearGradient>
      <linearGradient id={`${id}-grass`} x1="0" y1="0" x2="0" y2="1"><stop className="meadow-grass-light" /><stop className="meadow-grass-shade" offset="1" /></linearGradient>
    </defs>
    <path className="club-sky__hill--distant" d="M0 227Q104 144 232 197T478 239Q610 228 727 182T1000 222V360H0Z" />
    <path fill={`url(#${id}-hill)`} d="M0 265Q119 188 269 239T536 265Q657 250 784 228T1000 262V360H0Z" />
    <path className="club-sky__field-seam" d="M0 268Q140 213 272 253M672 260Q843 210 1000 267" />
    <path className="club-sky__hill--near" d="M0 299Q142 249 310 282T610 293Q812 260 1000 292V360H0Z" />
    <path className="club-sky__path-shadow" d="M508 269Q466 286 521 305T671 360H394Q516 322 467 306T508 269Z" />
    <path className="club-sky__path" d="M507 269Q477 287 532 305T646 360H417Q539 321 483 303T507 269Z" />
    <path fill={`url(#${id}-grass)`} d="M0 326Q146 306 276 329L281 316L289 331L298 321L301 332Q355 336 397 340L381 346Q211 324 0 349ZM1000 322Q857 307 738 333L733 320L724 334L716 326L713 335Q681 339 655 345L674 354Q847 323 1000 346Z" />
    <g className="club-sky__field-details">
      <path d="M116 263q9-8 18 0m39-10q8-7 15 0m69 19q9-7 18 0m425-19q9-7 17 0m85-8q8-7 15 0m67 19q9-7 18 0" />
      <path d="M49 294l2-9 4 9m295 3 3-10 4 10m311-9 3-9 4 9m268 12 3-10 4 10" />
    </g>
    <path className="club-sky__edge" d="M0 350Q230 335 425 351Q563 368 718 351T1000 350V360H0Z" />
  </svg>
}

export function MeadowPlant() {
  return <svg viewBox="0 0 150 170" fill="none">
    <g className="meadow-plant__back">
      <path d="M60 166C25 143 17 101 33 66C60 81 73 120 60 166Z" />
      <path d="M61 164C40 116 50 51 83 20C106 66 95 125 61 164Z" />
      <path d="M68 164C79 116 109 87 141 90C142 126 113 156 68 164Z" />
    </g>
    <g className="meadow-plant__front">
      <path d="M66 165C35 165 10 146 6 121C36 112 61 133 66 165Z" />
      <path d="M70 166C53 127 67 92 94 76C111 109 98 143 70 166Z" />
      <path d="M73 166C86 141 111 130 136 138C131 160 105 171 73 166Z" />
    </g>
    <g className="meadow-plant__veins">
      <path d="M62 158Q69 93 82 41M58 155Q41 116 35 88M78 156Q110 115 127 104M60 158Q35 138 20 133M74 157Q90 119 92 95M85 161L120 147" />
    </g>
  </svg>
}

export function MeadowFlower({ daisy = false }: { daisy?: boolean }) {
  return <svg viewBox="0 0 80 124" fill="none">
    <path className="meadow-flower__stem" d="M39 119Q34 92 42 55L42 34" />
    <path className="meadow-flower__leaf" d="M39 98C18 98 13 87 13 76C29 74 39 83 39 98ZM40 84C56 84 66 72 64 63C49 63 39 71 40 84Z" />
    <path className="meadow-flower__vein" d="M19 81L38 96M58 69L41 81" />
    <g className={daisy ? 'meadow-flower__bloom meadow-flower__bloom--daisy' : 'meadow-flower__bloom'}>
      {Array.from({ length: daisy ? 8 : 6 }, (_, i) => <ellipse key={i} cx="40" cy="19" rx={daisy ? 7 : 10} ry={daisy ? 16 : 17} transform={`rotate(${i * (daisy ? 45 : 60)} 40 35)`} />)}
      <circle className="meadow-flower__center" cx="40" cy="35" r={daisy ? 10 : 9} />
      <path className="meadow-flower__center-detail" d="M37 32h.1m7 2h.1m-5 6h.1" />
    </g>
  </svg>
}

export function MeadowButterfly() {
  return <svg viewBox="0 0 72 64" fill="none">
    <g className="meadow-butterfly__wing meadow-butterfly__wing--left">
      <path className="meadow-butterfly__upper" d="M35 32C19-3 1 3 5 23C6 33 19 40 35 36Z" />
      <path className="meadow-butterfly__lower" d="M35 35C17 30 6 40 14 51C21 59 31 49 35 39Z" />
      <path className="meadow-butterfly__vein" d="M32 30Q22 12 13 14M30 39L21 46" />
      <ellipse className="meadow-butterfly__spot" cx="14" cy="22" rx="4" ry="6" transform="rotate(-35 14 22)" />
    </g>
    <g className="meadow-butterfly__wing meadow-butterfly__wing--right">
      <path className="meadow-butterfly__upper" d="M37 32C53-3 71 3 67 23C66 33 53 40 37 36Z" />
      <path className="meadow-butterfly__lower" d="M37 35C55 30 66 40 58 51C51 59 41 49 37 39Z" />
      <path className="meadow-butterfly__vein" d="M40 30Q50 12 59 14M42 39L51 46" />
      <ellipse className="meadow-butterfly__spot" cx="58" cy="22" rx="4" ry="6" transform="rotate(35 58 22)" />
    </g>
    <path className="meadow-butterfly__antennae" d="M34 25Q29 18 30 15M38 25Q43 18 42 15" />
    <path className="meadow-butterfly__body" d="M36 23C31 24 31 43 36 48C41 43 41 24 36 23Z" />
    <circle className="meadow-butterfly__body" cx="36" cy="24" r="4" />
  </svg>
}

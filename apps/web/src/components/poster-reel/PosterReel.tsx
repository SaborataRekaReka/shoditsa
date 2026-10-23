import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Pause, Play } from 'lucide-react'
import { IconButton } from '../ui/UiControls'
import { ReferenceIcon, type ReferenceIconName } from '../ui/ReferenceIcon'
import './PosterReel.css'

export type ReelPoster = { title: string; src?: string; fit?: 'cover' | 'contain' }

export const MOVIE_POSTERS: readonly ReelPoster[] = [
  { title: 'Амели', src: '/data/libraries/movies/img/kp_341/poster.webp' },
  { title: 'Интерстеллар', src: '/data/libraries/movies/img/kp_258687/poster.webp' },
  { title: 'Отель «Гранд Будапешт»', src: '/data/libraries/movies/img/kp_683999/poster.webp' },
  { title: 'Матрица', src: '/data/libraries/movies/img/kp_301/poster.webp' },
  { title: 'Ла-Ла Ленд', src: '/data/libraries/movies/img/kp_841081/poster.webp' },
  { title: 'Назад в будущее', src: '/data/libraries/movies/img/kp_476/poster.webp' },
  { title: 'Гарри Поттер и философский камень', src: '/data/libraries/movies/img/kp_689/poster.webp' },
  { title: 'Король Лев', src: '/data/libraries/movies/img/kp_2360/poster.webp' },
  { title: 'Начало', src: '/data/libraries/movies/img/kp_447301/poster.webp' },
  { title: '1+1', src: '/data/libraries/movies/img/kp_535341/poster.webp' },
  { title: 'Унесённые призраками', src: '/data/libraries/movies/img/kp_370/poster.webp' },
  { title: 'Титаник', src: '/data/libraries/movies/img/kp_2213/poster.webp' },
  { title: 'Достучаться до небес', src: '/data/libraries/movies/img/kp_32898/poster.webp' },
  { title: 'Дюна', src: '/data/libraries/movies/img/kp_2882/poster.webp' },
  { title: 'Шоу Трумана', src: '/data/libraries/movies/img/kp_4541/poster.webp' },
]

function PosterTile({ poster, decorative, fallbackIcon }: { poster: ReelPoster; decorative: boolean; fallbackIcon: ReferenceIconName }) {
  const [failed, setFailed] = useState(false)
  const covered = poster.src && !failed
  return <figure className={`poster-reel__poster${covered ? '' : ' poster-reel__poster--fallback'}`} role="listitem" aria-hidden={decorative || undefined} title={poster.title} data-fit={poster.fit}>
    {covered ? <><img src={poster.src} alt={decorative || poster.fit === 'contain' ? '' : poster.title} width="200" height="300" decoding="async" draggable={false} onError={() => setFailed(true)} />{poster.fit === 'contain' && <figcaption>{poster.title}</figcaption>}</> : <><ReferenceIcon name={fallbackIcon} size={30} /><figcaption>{poster.title}</figcaption></>}
  </figure>
}

export function PosterReel({ posters, label = 'Постеры из каталога фильмов', fallbackIcon = 'movie' }: { posters: readonly ReelPoster[]; label?: string; fallbackIcon?: ReferenceIconName }) {
  const regionRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const controlRef = useRef<HTMLButtonElement>(null)
  const [layout, setLayout] = useState({ copies: 1, duration: 66 })
  const [manualPaused, setManualPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [touchPaused, setTouchPaused] = useState(false)
  const [focusPaused, setFocusPaused] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const [inView, setInView] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || posters.length === 0) return
    const measure = () => {
      const style = getComputedStyle(viewport)
      const stride = parseFloat(style.getPropertyValue('--poster-width')) + parseFloat(style.getPropertyValue('--poster-gap'))
      const copies = Math.max(1, Math.ceil(viewport.clientWidth / (posters.length * stride)))
      const duration = posters.length * copies * stride / 30
      setLayout(previous => previous.copies === copies && previous.duration === duration ? previous : { copies, duration })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [posters.length])

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => setReducedMotion(motion.matches)
    const updateVisibility = () => setHidden(document.hidden)
    const clearOutsideFocus = (event: Event) => {
      if (event.target instanceof Node && !regionRef.current?.contains(event.target)) setFocusPaused(false)
    }
    motion.addEventListener('change', updateMotion)
    document.addEventListener('visibilitychange', updateVisibility)
    document.addEventListener('pointerdown', clearOutsideFocus)
    document.addEventListener('focusin', clearOutsideFocus)
    const observer = new IntersectionObserver(entries => setInView(entries[0].isIntersecting))
    if (viewportRef.current) observer.observe(viewportRef.current)
    return () => {
      motion.removeEventListener('change', updateMotion)
      document.removeEventListener('visibilitychange', updateVisibility)
      document.removeEventListener('pointerdown', clearOutsideFocus)
      document.removeEventListener('focusin', clearOutsideFocus)
      observer.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    if (!reducedMotion && viewportRef.current) viewportRef.current.scrollLeft = 0
  }, [reducedMotion])

  const paused = manualPaused || hovered || touchPaused || focusPaused || hidden || !inView || reducedMotion
  const toggle = () => {
    if (manualPaused || focusPaused) { setManualPaused(false); setFocusPaused(false) }
    else setManualPaused(true)
  }
  if (posters.length === 0) return null
  return <section ref={regionRef} id="mini-posters" className="poster-reel" aria-label={label} aria-roledescription="карусель" tabIndex={reducedMotion ? -1 : 0} data-paused={paused} style={{ '--poster-duration': `${layout.duration}s` } as CSSProperties}
    onFocusCapture={event => { if (event.target !== controlRef.current) setFocusPaused(true) }}
    onKeyDown={event => { if (event.target === event.currentTarget && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); event.stopPropagation(); toggle() } }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusPaused(false) }}>
    <div className="poster-reel__viewport" ref={viewportRef} tabIndex={reducedMotion ? 0 : undefined}
      onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true) }}
      onPointerLeave={() => { setHovered(false); setTouchPaused(false) }}
      onPointerDown={event => { if (event.pointerType === 'touch') setTouchPaused(true) }}
      onPointerUp={() => setTouchPaused(false)} onPointerCancel={() => setTouchPaused(false)}>
      <div className="poster-reel__track">
        {[false, true].map(clone => <div className={`poster-reel__group${clone ? ' poster-reel__group--clone' : ''}`} key={String(clone)} role="list" aria-hidden={clone || undefined} inert={clone || undefined}>
          {Array.from({ length: layout.copies }, (_, copy) => posters.map(poster => <PosterTile key={`${copy}-${poster.title}-${poster.src ?? ''}`} poster={poster} decorative={clone || copy > 0} fallbackIcon={fallbackIcon} />))}
        </div>)}
      </div>
    </div>
    {!reducedMotion && <IconButton ref={controlRef} className="poster-reel__control" onClick={toggle} label={manualPaused || focusPaused ? 'Продолжить движение постеров' : 'Приостановить движение постеров'}>
      {manualPaused || focusPaused ? <Play size={15} strokeWidth={1.7} /> : <Pause size={15} strokeWidth={1.7} />}
    </IconButton>}
  </section>
}

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Pause, Play } from 'lucide-react'
import { Mascot } from '../../components/mascot/Mascot'
import { BrandWordmark } from '../../components/app-shell/BrandWordmark'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { MeadowButterfly, MeadowFlower, MeadowLandscape, MeadowPlant } from '../../components/mascot/MeadowArt'
import './study-club-sky.css'

/** One branded scene for the Club invitation and the membership offer. */
export function StudyClubSky({ heading, headingId, page = false }: { heading: ReactNode; headingId: string; page?: boolean }) {
  const ticketId = useId()
  const scene = useRef<HTMLElement>(null)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(true)
  const Heading = page ? 'h1' : 'h2'

  useEffect(() => {
    if (!scene.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(scene.current)
    return () => observer.disconnect()
  }, [])

  return <header ref={scene} className="club-sky club-sky--meadow" data-motion-paused={paused || !visible || undefined}>
    <div className="club-sky__sunlight" aria-hidden="true" />
    <span className="club-sky__badge">
      <svg className="club-sky__badge-ticket" viewBox="0 0 176 48" aria-hidden="true">
        <defs><linearGradient id={`${ticketId}-pass`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e2d5fa" /><stop offset=".5" stopColor="#eee6fb" /><stop offset="1" stopColor="#c9ece4" /></linearGradient></defs>
        <path fill={`url(#${ticketId}-pass)`} d="M9 1h158a8 8 0 0 1 8 8v9a6 6 0 0 0 0 12v9a8 8 0 0 1-8 8H9a8 8 0 0 1-8-8v-9a6 6 0 0 0 0-12V9a8 8 0 0 1 8-8Z" />
      </svg>
      <span className="club-sky__badge-copy"><span>Клуб</span><BrandWordmark variant="compact" /></span>
    </span>
    <Heading id={headingId} className="club-sky__heading">{heading}</Heading>
    <div className="club-sky__animation" aria-hidden="true">
      <div className="club-sky__sun" />
      <div className="club-sky__cloud club-sky__cloud--left" />
      <div className="club-sky__cloud club-sky__cloud--right" />
      <MeadowLandscape />
      <div className="club-sky__plants club-sky__plants--left"><MeadowPlant /></div>
      <div className="club-sky__plants club-sky__plants--right"><MeadowPlant /></div>
      <div className="club-sky__flowers">{Array.from({ length: 5 }, (_, i) => <span key={i}><MeadowFlower daisy={i % 2 === 1} /></span>)}</div>
      <div className="club-sky__butterfly club-sky__butterfly--lilac"><MeadowButterfly /></div>
      <div className="club-sky__butterfly club-sky__butterfly--gold"><MeadowButterfly /></div>
      <div className="club-sky__seat" />
      <div className="club-sky__arrival"><div className="club-sky__flyer">
        <Mascot pose="club" width={208} height={208} fetchPriority="high" />
      </div></div>
    </div>
    <QuestButton kind="icon" className="club-sky__motion" aria-label={paused ? 'Включить анимацию' : 'Остановить анимацию'} aria-pressed={paused} onClick={() => setPaused(value => !value)}>
      {paused ? <Play size={16} /> : <Pause size={16} />}
    </QuestButton>
  </header>
}

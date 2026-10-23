import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import type { GlyphName } from './QuestArt'
import { useStudyPlayer } from './study-player'
import { StudyAccountMenu } from './StudyAccountMenu'
import { STUDY_CLUB_OFFER_HREF } from './account-routing'
import { StudyBrandLogo } from './StudyBrandLogo'
import { useStudyTheme } from './StudyTheme'
import { useStudyClubActive } from './use-study-club'
import './study-shell.css'
import { useStudyPanels } from './study-panels'

type Props = {
  Glyph: ComponentType<{ name: GlyphName; size?: number; className?: string }>
  profileHref?: string
  onProfile?: () => void
  onHome?: () => void
  onSettings?: () => void
  refreshKey?: string
  currentPage?: 'club' | 'club-offer'
}

const stats = [
  { id: 'streak', glyph: 'flame', label: 'Серия дней', detail: 'Каждая разгаданная загадка — ещё один повод вернуться завтра.' },
  { id: 'tickets', glyph: 'ticket', label: 'Билетики', detail: 'Билетики открывают дополнительные партии. Здесь показан баланс, сохранённый в этом браузере.' },
] as const

/** Account controls belong to the application, attempts belong to the session. */
export function StudyHeader({ Glyph, profileHref = '/profile', onProfile, onHome, onSettings, refreshKey, currentPage }: Props) {
  useStudyTheme()
  const hasClub = useStudyClubActive()
  const player = useStudyPlayer(refreshKey)
  const [open, setOpen] = useState<string | null>(null)
  const wrap = useRef<HTMLElement>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const panels = useStudyPanels()
  const [sidebarHost, setSidebarHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setSidebarHost(anchor.current?.closest('.study-layout')?.querySelector<HTMLElement>('.study-right-header-slot') ?? null) })
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(null); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const header = <header className="study-header" id="study-screen-ready" data-study-header ref={wrap} aria-label="Панель игрока">
    <a className="study-header-brand" href="/" aria-label="Сходится! — на главную" onClick={onHome ? event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onHome() } } : undefined}><StudyBrandLogo /></a>
    <div className="study-header-controls">
      {stats.map(stat => <div className={`study-header-stat study-header-stat--${stat.id}`} key={stat.id}>
        <QuestButton kind="icon" aria-label={`${stat.label}: ${stat.id === 'streak' ? player.streak : player.balance}`} aria-expanded={open === stat.id} aria-controls={open === stat.id ? `${titleId}-${stat.id}` : undefined} onClick={event => { trigger.current = event.currentTarget; setOpen(value => value === stat.id ? null : stat.id) }}><Glyph name={stat.glyph} size={29} /><strong>{stat.id === 'streak' ? player.streak : player.balance}</strong></QuestButton>
        {open === stat.id && <div id={`${titleId}-${stat.id}`} className="qg-popover study-header-popover" role="region" aria-labelledby={titleId}><Glyph name={stat.glyph} size={48} /><h3 id={titleId}>{stat.label}</h3><p>{stat.detail}</p><QuestButton kind="text" onClick={() => { setOpen(null); trigger.current?.focus() }}>Понятно</QuestButton></div>}
      </div>)}
      {!hasClub && <a className="study-club-link" href={STUDY_CLUB_OFFER_HREF} aria-current={typeof window !== 'undefined' && window.location.pathname === '/club/membership' ? 'page' : undefined}><Glyph name="medal" size={25} /><span>Клуб</span></a>}
      <StudyAccountMenu Glyph={Glyph} profileHref={profileHref} onProfile={onProfile} onSettings={onSettings} onOpen={() => setOpen(null)} />
    </div>
  </header>
  return <><span ref={anchor} hidden />{sidebarHost && panels.desktopRight && !panels.rightCollapsed ? createPortal(header, sidebarHost) : header}</>
}

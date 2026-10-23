import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { ChevronDown, LogIn, ShieldCheck, UserRoundPlus } from 'lucide-react'
import type { GlyphName } from './QuestArt'
import { studyAccountHref, STUDY_CLUB_HREF } from './account-routing'
import { StudyProfileIcon, StudySettingsIcon, StudySupportIcon } from './StudyProfileArt'
import { UserAvatar } from '../../components/ui/UserAvatar'
import { StudyThemeToggle } from './StudyTheme'
import './study-account.css'
import type { MeResponse } from '@shoditsa/contracts'
import { queryKeys } from '../../api/client'
import { useStudyAccountCache } from './study-account-cache'
import { useStudyClubActive } from './use-study-club'

type Props = {
  Glyph: ComponentType<{ name: GlyphName; size?: number; className?: string }>
  placement?: 'rail' | 'header'
  profileHref?: string
  onProfile?: () => void
  onSettings?: () => void
  onOpen?: () => void
}

export function StudyAccountMenu({ Glyph, placement = 'header', profileHref = '/profile', onProfile, onSettings, onOpen }: Props) {
  const account = useStudyAccountCache<MeResponse>(queryKeys.me)
  const signedIn = !!account?.user && !account.user.isAnonymous
  const hasClub = useStudyClubActive() && signedIn
  const name = signedIn ? account.user.name || 'Игрок' : 'Гость'
  const [open, setOpen] = useState(false)
  const [compact, setCompact] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = () => { setOpen(false); trigger.current?.focus() }
  useLayoutEffect(() => {
    if (placement !== 'header') return
    const accountElement = root.current
    const button = trigger.current
    const controls = accountElement?.closest<HTMLElement>('.study-header-controls')
    const header = controls?.closest<HTMLElement>('.study-header')
    if (!accountElement || !button || !controls || !header) return
    const measure = () => {
      const visibleChildren = (element: HTMLElement) => Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.getClientRects().length > 0)
      const width = (element: Element) => element.getBoundingClientRect().width
      const pixels = (value: string) => Number.parseFloat(value) || 0
      const headerStyle = getComputedStyle(header)
      const headerChildren = visibleChildren(header)
      const controlsChildren = visibleChildren(controls)
      const buttonStyle = getComputedStyle(button)
      const fixedButtonWidth = Array.from(button.children).filter(child => !child.classList.contains('study-account-name')).reduce((sum, child) => sum + width(child), 0)
      // Measure the space before collapsing the name, so it can return when the
      // sidebar, balance or mobile header changes without a resize feedback loop.
      const available = header.clientWidth - pixels(headerStyle.paddingLeft) - pixels(headerStyle.paddingRight)
        - headerChildren.filter(child => child !== controls).reduce((sum, child) => sum + width(child), 0)
        - pixels(headerStyle.columnGap) * Math.max(0, headerChildren.length - 1)
        - controlsChildren.filter(child => child !== accountElement).reduce((sum, child) => sum + width(child), 0)
        - pixels(getComputedStyle(controls).columnGap) * Math.max(0, controlsChildren.length - 1)
        - fixedButtonWidth - pixels(buttonStyle.paddingLeft) - pixels(buttonStyle.paddingRight) - pixels(buttonStyle.columnGap) * 2
      setCompact(available < 64)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    for (const child of [...header.children, ...controls.children]) if (child !== accountElement) observer.observe(child)
    return () => observer.disconnect()
  }, [placement, signedIn])
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [open])
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter(item => item.getClientRects().length > 0)
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    } else if (event.key === 'Tab') setOpen(false)
  }
  return <div className={`study-account study-account--${placement}`} data-account-compact={compact || undefined} ref={root}>
    <button ref={trigger} className="study-account-trigger" type="button" aria-label={`Меню аккаунта${placement === 'rail' ? ' слева' : ''}: ${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { if (!open) onOpen?.(); setOpen(value => !value) }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); onOpen?.(); setOpen(true) } }}>
      <UserAvatar className="study-account-avatar" club={hasClub} name={signedIn ? account.user.name : null} src={signedIn ? account.user.avatarUrl : null} /><span className="study-account-name"><strong>{name}</strong>{placement === 'rail' && <small>{hasClub ? 'Участник Клуба' : 'Твой аккаунт'}</small>}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div className="study-account-popover" id={id} ref={menu} role="menu" aria-label="Аккаунт" onKeyDown={keys}>
      <div className="study-account-intro"><div><strong>{signedIn ? name : 'Твой аккаунт'}</strong><p>{signedIn ? 'Профиль, настройки и результаты игр.' : 'Войди, чтобы сохранять прогресс и продолжать игры на любом устройстве.'}</p></div></div>
      {!signedIn && <>
      <a role="menuitem" className="study-account-signin" href={studyAccountHref('login')}><LogIn size={20} />Войти в аккаунт</a>
      <a role="menuitem" className="study-account-register" href={studyAccountHref('register')}><UserRoundPlus size={20} />Создать аккаунт</a>
      </>}
      <div className="study-account-divider" />
      {onProfile ? <button role="menuitem" type="button" onClick={() => { setOpen(false); onProfile() }}><StudyProfileIcon size={24} />Мой профиль</button> : <a role="menuitem" href={profileHref}><StudyProfileIcon size={24} />Мой профиль</a>}
      {onSettings ? <button role="menuitem" type="button" onClick={() => { setOpen(false); onSettings() }}><StudySettingsIcon />Настройки</button> : <a role="menuitem" href="/settings"><StudySettingsIcon />Настройки</a>}
      <a role="menuitem" href={STUDY_CLUB_HREF}><Glyph name="medal" size={23} />Клуб</a>
      <a role="menuitem" href="/support" onClick={() => setOpen(false)}><StudySupportIcon />Поддержка</a>
      {signedIn && account.user.role === 'admin' && <a role="menuitem" href={studyAccountHref('admin')}><ShieldCheck size={21} /><span>Админ-панель<small>Для администраторов</small></span></a>}
      <div className="study-account-theme-row"><span>Тема</span><StudyThemeToggle menuItem /></div>
    </div>}
  </div>
}

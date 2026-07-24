import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Archive, BarChart3, ChevronDown, ChevronLeft, Crown, Gamepad2, LayoutDashboard, LogIn, LogOut, Plus, Settings, ShieldCheck, Ticket, Trophy, UserPlus, UserRound, X } from 'lucide-react'
import { trackMetrikaGoal } from '../../app/metrics'
import { publicAssetUrl } from '../../app/public-asset'
import { api } from '../../api/client'
import { EconomyView } from '../../features/economy/EconomyView'
import { notifyAuthSessionChanged, useAuthSession } from '../../features/auth/use-auth-session'
import { canUseFriendsRoom, friendsRoomRegistrationHref } from '../../features/friends-room/friends-room-access'
import { toLegacyAttendance, toLegacyWallet } from '../../features/server-runtime/adapters'
import { SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'
import { loadAttendanceStats, loadWallet } from '../../storage'

export const PROFILE_OPEN_EVENT = 'seans:open-profile'
export type ProfileMenuTab = 'overview' | 'stats' | 'achievements' | 'settings'

const dialogFocusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocusTrap<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const dialogRef = useRef<T>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusables = () => [...dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector)]
      .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
    const frame = window.requestAnimationFrame(() => (focusables()[0] ?? dialog).focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus()
    }
  }, [open])

  return dialogRef
}

const brandSymbolUrl = publicAssetUrl('images/symbol.svg')
const brandLogoUrl = publicAssetUrl('images/logo.svg')

export function BrandLogo({ className = '' }: { className?: string }) {
  return <picture className={className}>
    <source media="(max-width: 719px)" srcSet={brandSymbolUrl} />
    <img src={brandLogoUrl} alt="Сходится!" />
  </picture>
}

export function ActionButton({ variant = 'primary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'hint'
}) {
  return <button className={`ui-button ui-button--${variant} ${className}`.trim()} {...props}>{children}</button>
}

export function ScreenBack({ onBack, href, label = 'Назад', keyboardShortcut = true, trailing, className = '' }: {
  onBack?: () => void
  href?: string
  label?: string
  keyboardShortcut?: boolean
  trailing?: ReactNode
  className?: string
}) {
  useEffect(() => {
    if (!keyboardShortcut) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (onBack) onBack()
      else if (href) window.location.assign(href)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [href, keyboardShortcut, onBack])

  return <div className={`screen-back-row ${className}`.trim()}>
    {href
      ? <a className="screen-back" href={href} aria-label={label} title={label}><ChevronLeft /></a>
      : <button className="screen-back" type="button" onClick={onBack} aria-label={label} title={label}><ChevronLeft /></button>}
    <span className="keycap-hint" aria-hidden="true">Esc</span>
    {trailing}
  </div>
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(true, onClose)
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <div className="modal-head"><h2>{title}</h2><button onClick={onClose} aria-label="Закрыть"><X /></button></div>
      {children}
    </div>
  </div>
}

export type AppHeaderProps = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onCreateRoom?: () => void
  profileActive?: boolean
}

export function AppHeader({ onHome, onArchive, onStats, onCreateRoom, profileActive = false }: AppHeaderProps) {
  const [economyOpen, setEconomyOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const profileTriggerRef = useRef<HTMLButtonElement>(null)
  const { session } = useAuthSession()
  const serverRuntime = useServerRuntime()
  const createRoom = onCreateRoom ?? (() => {
    const returnUrl = '/games/together'
    window.location.assign(canUseFriendsRoom(session)
      ? returnUrl
      : friendsRoomRegistrationHref(returnUrl))
  })
  const wallet = SERVER_RUNTIME ? toLegacyWallet(serverRuntime.dashboard) : loadWallet()
  const attendance = SERVER_RUNTIME ? toLegacyAttendance(serverRuntime.dashboard?.attendance) : loadAttendanceStats()
  const profileLabel = session && !session.isAnonymous
    ? session.name || session.email?.split('@')[0] || 'Профиль'
    : 'Гость'
  const signedIn = Boolean(session && !session.isAnonymous)
  const hasClub = Boolean(serverRuntime.dashboard?.membership.active)
  const hashRoute = typeof window === 'undefined' ? null : window.location.hash.match(/^#(\/[^?]*)/)
  const currentPath = hashRoute?.[1] ?? (typeof window === 'undefined' ? '/' : window.location.pathname)
  const mobileSection = currentPath === '/archive'
    ? 'archive'
    : currentPath === '/club'
      ? 'club'
      : currentPath === '/games/together'
        ? 'room'
        : profileActive || currentPath === '/profile'
          ? 'profile'
          : 'games'
  const openProfile = (tab: ProfileMenuTab = 'overview') => {
    trackMetrikaGoal('open_profile')
    setProfileMenuOpen(false)
    window.dispatchEvent(new CustomEvent(PROFILE_OPEN_EVENT, { detail: { tab } }))
  }

  useEffect(() => {
    if (!profileMenuOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && setProfileMenuOpen(false)
    window.addEventListener('pointerdown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [profileMenuOpen])

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await api.signOut()
      notifyAuthSessionChanged()
      window.location.assign('/')
    } finally {
      setSigningOut(false)
      setProfileMenuOpen(false)
    }
  }

  return <>
    <header className="app-header">
      <div className="app-header__inner">
        <button className="brand" aria-label="На главный экран" onClick={() => { trackMetrikaGoal('header_home_click'); onHome() }}><BrandLogo /></button>
        <button
          className="header-economy"
          type="button"
          aria-label={`Билеты: ${wallet.tickets}. Стрик: ${attendance.currentDailyStreak} дней`}
          onClick={() => { trackMetrikaGoal('open_economy_modal'); setEconomyOpen(true) }}
        >
          <span><Ticket /> <strong>{wallet.tickets}</strong></span>
          <span><Trophy /> <strong>{attendance.currentDailyStreak}</strong><i>дн.</i></span>
        </button>
        <nav aria-label="Навигация">
          <a
            className={`header-club ${hasClub ? 'is-active' : ''}`}
            href="/club"
            aria-label={hasClub ? 'Клубный билет активен' : 'Клуб'}
            title={hasClub ? 'Клубный билет активен' : 'Клуб «Сходится!»'}
            onClick={() => trackMetrikaGoal('open_club', { placement: 'header' })}
          >
            <Crown /><span>Клуб</span>
          </a>
          <button className="header-create-room" type="button" onClick={createRoom}><Plus /><span>Создать комнату</span></button>
          <div className="header-profile-menu" ref={profileMenuRef}>
            <button ref={profileTriggerRef} onClick={() => setProfileMenuOpen((value) => !value)} className={`header-profile ${signedIn ? 'is-signed-in' : 'is-guest'} ${profileActive ? 'is-active' : ''}`} aria-label="Открыть меню" title="Меню" aria-haspopup="menu" aria-expanded={profileMenuOpen}>
              <span className="header-profile__avatar"><UserRound /></span><strong>{profileLabel}</strong><ChevronDown className="header-profile__chevron" />
            </button>
            {profileMenuOpen && <div className="header-profile-dropdown" role="menu">
              <div className="header-profile-dropdown__identity"><span className="header-profile__avatar"><UserRound /></span><div><strong>{signedIn ? session?.name || 'Игрок' : 'Гость кинозала'}</strong><small>{signedIn ? session?.email : 'Прогресс хранится в этом браузере'}</small></div></div>
              <button className="header-profile-dropdown__economy" type="button" role="menuitem" aria-label={`Билеты: ${wallet.tickets}. Серия: ${attendance.currentDailyStreak} дней`} onClick={() => { trackMetrikaGoal('open_economy_modal'); profileTriggerRef.current?.focus(); setProfileMenuOpen(false); setEconomyOpen(true) }}>
                <Ticket /><span>Билеты</span><strong>{wallet.tickets}</strong>
                <Trophy /><span>Серия</span><strong>{attendance.currentDailyStreak} дн.</strong>
              </button>
              <button type="button" role="menuitem" onClick={() => openProfile('overview')}><LayoutDashboard /><span>{signedIn ? 'Обзор профиля' : 'Гостевой кабинет'}</span></button>
              <button type="button" role="menuitem" onClick={() => { trackMetrikaGoal('open_archive'); setProfileMenuOpen(false); onArchive() }}><Archive /><span>Архив</span></button>
              <button className="header-profile-dropdown__club" type="button" role="menuitem" onClick={() => { trackMetrikaGoal('open_club', { placement: 'profile_menu' }); window.location.assign('/club') }}><Crown /><span>{hasClub ? 'Клубный билет' : 'Вступить в клуб'}</span></button>
              <button type="button" role="menuitem" onClick={() => { trackMetrikaGoal('open_stats'); setProfileMenuOpen(false); onStats() }}><BarChart3 /><span>Статистика</span></button>
              <button type="button" role="menuitem" onClick={() => openProfile('achievements')}><Trophy /><span>Достижения</span></button>
              {signedIn
                ? <>
                  <button type="button" role="menuitem" onClick={() => openProfile('settings')}><Settings /><span>Настройки</span></button>
                  {SERVER_RUNTIME && serverRuntime.me?.user.role === 'admin' && <button type="button" role="menuitem" onClick={() => window.location.assign('/admin')}><ShieldCheck /><span>Админ-панель</span></button>}
                  <button className="header-profile-dropdown__signout" type="button" role="menuitem" disabled={signingOut} onClick={() => void signOut()}><LogOut /><span>{signingOut ? 'Выходим…' : 'Выйти'}</span></button>
                </>
                : <>
                  <button className="header-profile-dropdown__account" type="button" role="menuitem" onClick={() => window.location.assign('/register')}><UserPlus /><span>Сохранить прогресс</span></button>
                  <button type="button" role="menuitem" onClick={() => window.location.assign('/login')}><LogIn /><span>Войти</span></button>
                </>}
            </div>}
          </div>
        </nav>
      </div>
    </header>
    <nav className="mobile-app-nav" aria-label="Основная навигация">
      <button
        className={`mobile-app-nav__item ${mobileSection === 'games' ? 'is-active' : ''}`}
        type="button"
        aria-current={mobileSection === 'games' ? 'page' : undefined}
        onClick={() => { trackMetrikaGoal('header_home_click', { placement: 'mobile_nav' }); onHome() }}
      >
        <Gamepad2 /><span>Игры</span>
      </button>
      <button
        className={`mobile-app-nav__item ${mobileSection === 'archive' ? 'is-active' : ''}`}
        type="button"
        aria-current={mobileSection === 'archive' ? 'page' : undefined}
        onClick={() => { trackMetrikaGoal('open_archive', { placement: 'mobile_nav' }); onArchive() }}
      >
        <Archive /><span>Архив</span>
      </button>
      <button
        className={`mobile-app-nav__item mobile-app-nav__create ${mobileSection === 'room' ? 'is-active' : ''}`}
        type="button"
        aria-current={mobileSection === 'room' ? 'page' : undefined}
        onClick={() => { trackMetrikaGoal('friends_room_opened', { placement: 'mobile_nav' }); createRoom() }}
      >
        <i aria-hidden="true"><Plus /></i><span>Комната</span>
      </button>
      <a
        className={`mobile-app-nav__item mobile-app-nav__club ${mobileSection === 'club' ? 'is-active' : ''}`}
        href="/club"
        aria-current={mobileSection === 'club' ? 'page' : undefined}
        onClick={() => trackMetrikaGoal('open_club', { placement: 'mobile_nav' })}
      >
        <Crown /><span>Клуб</span>
      </a>
      <button
        className={`mobile-app-nav__item ${mobileSection === 'profile' ? 'is-active' : ''}`}
        type="button"
        aria-current={mobileSection === 'profile' ? 'page' : undefined}
        onClick={() => openProfile('overview')}
      >
        <UserRound /><span>Профиль</span>
      </button>
    </nav>
    {economyOpen && <Modal title="Билеты" onClose={() => setEconomyOpen(false)}><EconomyView /></Modal>}
  </>
}

export function AppFooter({ onHome, onArchive, onRules, onProfile }: { onHome: () => void; onArchive: () => void; onRules: () => void; onProfile: () => void }) {
  return <footer className="app-footer">
    <div className="app-footer__inner">
      <div className="app-footer__brand">
        <button className="app-footer__home" onClick={onHome} aria-label="На главный экран"><BrandLogo /></button>
        <p>Неспешная игра на каждый день</p>
      </div>
      <nav className="app-footer__nav" aria-label="Навигация в подвале">
        <button className="app-footer__link" onClick={onHome}>Игры</button>
        <button className="app-footer__link" onClick={onArchive}>Архив</button>
        <a className="app-footer__link" href="/specials">Спецпоказы</a>
        <a className="app-footer__link app-footer__link--club" href="/club"><Crown />Клуб</a>
        <button className="app-footer__link" onClick={onProfile}>Профиль</button>
        <a className="app-footer__link" href="/partners">Для компаний</a>
        <button className="app-footer__link" onClick={onRules}>Правила</button>
      </nav>
      <small className="app-footer__copy">© {new Date().getFullYear()} Сходится! · ИП Бренейзе А. В. · ИНН 540552157271</small>
      <nav className="app-footer__legal" aria-label="Юридическая информация">
        <a href="/legal/terms">Соглашение и оферта</a>
        <a href="/legal/tariffs">Тарифы</a>
        <a href="/legal/privacy">Конфиденциальность</a>
        <a href="/legal/refunds">Оплата и возвраты</a>
        <a href="/legal/contacts">Контакты и реквизиты</a>
        <button type="button" onClick={() => window.dispatchEvent(new Event('shoditsa:cookie-settings'))}>Настройки cookie</button>
      </nav>
    </div>
  </footer>
}

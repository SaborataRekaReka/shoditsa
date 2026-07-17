import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Archive, BarChart3, ChevronDown, CircleHelp, LayoutDashboard, LogOut, Settings, ShieldCheck, Ticket, Trophy, UserRound, X } from 'lucide-react'
import { trackMetrikaGoal } from '../../app/metrics'
import { api } from '../../api/client'
import { EconomyView } from '../../features/economy/EconomyView'
import { notifyAuthSessionChanged, useAuthSession } from '../../features/auth/use-auth-session'
import { toLegacyAttendance, toLegacyWallet } from '../../features/server-runtime/adapters'
import { SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'
import { loadAttendanceStats, loadWallet } from '../../storage'

export const PROFILE_OPEN_EVENT = 'seans:open-profile'
export type ProfileMenuTab = 'overview' | 'stats' | 'achievements' | 'settings'

export function BrandLogo({ className = '' }: { className?: string }) {
  return <picture className={className}>
    <source media="(max-width: 719px)" srcSet="./images/symbol.svg" />
    <img src="./images/logo.svg" alt="Сходится!" />
  </picture>
}

export function ActionButton({ variant = 'primary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'hint'
}) {
  return <button className={`ui-button ui-button--${variant} ${className}`.trim()} {...props}>{children}</button>
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
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
  profileActive?: boolean
}

export function AppHeader({ onHome, onArchive, onStats, onRules, onReview, profileActive = false }: AppHeaderProps) {
  const [economyOpen, setEconomyOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const { session } = useAuthSession()
  const serverRuntime = useServerRuntime()
  const wallet = SERVER_RUNTIME ? toLegacyWallet(serverRuntime.dashboard) : loadWallet()
  const attendance = SERVER_RUNTIME ? toLegacyAttendance(serverRuntime.dashboard?.attendance) : loadAttendanceStats()
  const profileLabel = session && !session.isAnonymous
    ? session.name || session.email?.split('@')[0] || 'Профиль'
    : 'Войти'
  const signedIn = Boolean(session && !session.isAnonymous)
  const openProfile = (tab: ProfileMenuTab = 'overview') => {
    trackMetrikaGoal('open_profile')
    if (SERVER_RUNTIME && !signedIn) {
      const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
      window.location.assign(returnUrl === '/' ? '/login' : `/login?returnUrl=${encodeURIComponent(returnUrl)}`)
      return
    }
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
        <button className="header-economy" aria-label="Билеты и абонемент" onClick={() => { trackMetrikaGoal('open_economy_modal'); setEconomyOpen(true) }}>
          <span><Ticket /> <strong>{wallet.tickets}</strong></span>
          <span><Trophy /> <strong>{attendance.currentDailyStreak}</strong><i>дн.</i></span>
        </button>
        <nav aria-label="Навигация">
          <button onClick={() => { trackMetrikaGoal('open_rules'); onRules() }} aria-label="Как играть"><CircleHelp /></button>
          <button onClick={() => { trackMetrikaGoal('open_archive'); onArchive() }} aria-label="Архив"><Archive /></button>
          <button onClick={() => { trackMetrikaGoal('open_stats'); onStats() }} aria-label="Статистика"><BarChart3 /></button>
          {SERVER_RUNTIME && serverRuntime.me?.user.role === 'admin' && <button onClick={() => { trackMetrikaGoal('open_admin'); window.location.assign('/admin') }} aria-label="Административная панель" title="Административная панель"><ShieldCheck /></button>}
          <div className="header-profile-menu" ref={profileMenuRef}>
            <button onClick={() => signedIn ? setProfileMenuOpen((value) => !value) : openProfile()} className={`header-profile ${signedIn ? 'is-signed-in' : ''} ${profileActive ? 'is-active' : ''}`} aria-label={signedIn ? 'Открыть меню профиля' : 'Войти'} title={signedIn ? 'Меню профиля' : 'Войти'} aria-haspopup={signedIn ? 'menu' : undefined} aria-expanded={signedIn ? profileMenuOpen : undefined}>
              <span className="header-profile__avatar"><UserRound /></span><strong>{profileLabel}</strong>{signedIn && <ChevronDown className="header-profile__chevron" />}
            </button>
            {signedIn && profileMenuOpen && <div className="header-profile-dropdown" role="menu">
              <div className="header-profile-dropdown__identity"><span className="header-profile__avatar"><UserRound /></span><div><strong>{session?.name || 'Игрок'}</strong><small>{session?.email}</small></div></div>
              <button type="button" role="menuitem" onClick={() => openProfile('overview')}><LayoutDashboard /><span>Обзор профиля</span></button>
              <button type="button" role="menuitem" onClick={() => openProfile('stats')}><BarChart3 /><span>Статистика</span></button>
              <button type="button" role="menuitem" onClick={() => openProfile('achievements')}><Trophy /><span>Достижения</span></button>
              <button type="button" role="menuitem" onClick={() => openProfile('settings')}><Settings /><span>Настройки</span></button>
              {SERVER_RUNTIME && serverRuntime.me?.user.role === 'admin' && <button type="button" role="menuitem" onClick={() => window.location.assign('/admin')}><ShieldCheck /><span>Админ-панель</span></button>}
              <button className="header-profile-dropdown__signout" type="button" role="menuitem" disabled={signingOut} onClick={() => void signOut()}><LogOut /><span>{signingOut ? 'Выходим…' : 'Выйти'}</span></button>
            </div>}
          </div>
        </nav>
      </div>
    </header>
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
      <nav className="app-footer__nav" aria-label="Навигация в подвале"><button onClick={onHome}>Игры</button><button onClick={onArchive}>Архив</button><button onClick={onProfile}>Профиль</button><button onClick={onRules}>Правила</button></nav>
      <small className="app-footer__copy">© {new Date().getFullYear()} Сходится!</small>
    </div>
  </footer>
}

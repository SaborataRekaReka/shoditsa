import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, BarChart3, ChevronDown, ChevronLeft, Crown, DoorOpen, Gamepad2, LayoutDashboard, LogIn, LogOut, Plus, Settings, ShieldCheck, Ticket, Trophy, UserPlus, UserRound, X } from 'lucide-react'
import { trackMetrikaGoal } from '../../app/metrics'
import { publicAssetUrl } from '../../app/public-asset'
import { api, queryKeys } from '../../api/client'
import { notifyAuthSessionChanged, useAuthSession } from '../../features/auth/use-auth-session'
import { canCreateFriendsRoom, canUseFriendsRoom, friendsRoomRegistrationHref } from '../../features/friends-room/friends-room-access'
import { toLegacyAttendance, toLegacyWallet } from '../../features/server-runtime/adapters'
import { SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'
import { loadAttendanceStats, loadWallet } from '../../storage'
import { formatDays } from '../../game'
import { headerRuntimeState } from './header-runtime-state'
import { DialogSurface } from '../ui/DialogSurface'
import { ActionButton } from '../ui/UiControls'
import { HeaderRoomMenu } from './HeaderRoomMenu'
import './AppShell.css'

const EconomyView = lazy(() => import('../../features/economy/EconomyView').then((module) => ({ default: module.EconomyView })))

export { useDialogFocusTrap } from '../ui/DialogSurface'
export { ActionButton } from '../ui/UiControls'

export const PROFILE_OPEN_EVENT = 'seans:open-profile'
export type ProfileMenuTab = 'overview' | 'stats' | 'achievements' | 'settings'

const brandSymbolUrl = publicAssetUrl('images/symbol.svg')
const brandLogoUrl = publicAssetUrl('images/logo.svg')
let lastKnownHeaderWallet: ReturnType<typeof loadWallet> | null = null
let lastKnownHeaderAttendance: ReturnType<typeof loadAttendanceStats> | null = null

export function BrandLogo({ className = '' }: { className?: string }) {
  return <picture className={className}>
    <source media="(max-width: 719px)" srcSet={brandSymbolUrl} />
    <img src={brandLogoUrl} alt="Сходится!" />
  </picture>
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

export function Modal({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  return <DialogSurface backdropClassName="modal-backdrop" className={`modal ${className}`.trim()} ariaLabel={title} onClose={onClose}>
      <div className="modal-head"><h2>{title}</h2><button onClick={onClose} aria-label="Закрыть"><X /></button></div>
      {children}
  </DialogSurface>
}

export type AppHeaderProps = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onCreateRoom?: () => void
  profileActive?: boolean
  minimal?: boolean
  hideMobileNav?: boolean
}

export function AppHeader({ onHome, onArchive, onStats, onCreateRoom, profileActive = false, minimal = false, hideMobileNav = false }: AppHeaderProps) {
  const [economyOpen, setEconomyOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const profileTriggerRef = useRef<HTMLButtonElement>(null)
  const { session, loading: authLoading } = useAuthSession()
  const serverRuntime = useServerRuntime()
  const openRooms = useQuery({
    queryKey: queryKeys.friendsRooms,
    queryFn: api.friendsRoomList,
    enabled: !minimal && !authLoading && canUseFriendsRoom(session),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  const runtimeState = headerRuntimeState({
    serverRuntime: SERVER_RUNTIME,
    authLoading,
    runtimeLoading: serverRuntime.loading,
    hasDashboard: Boolean(serverRuntime.dashboard),
  })
  const runtimeReady = runtimeState === 'ready'
  const readyWallet = runtimeReady ? (SERVER_RUNTIME ? toLegacyWallet(serverRuntime.dashboard) : loadWallet()) : null
  const readyAttendance = runtimeReady ? (SERVER_RUNTIME ? toLegacyAttendance(serverRuntime.dashboard?.attendance) : loadAttendanceStats()) : null
  if (readyWallet) lastKnownHeaderWallet = readyWallet
  if (readyAttendance) lastKnownHeaderAttendance = readyAttendance
  const wallet = readyWallet ?? lastKnownHeaderWallet
  const attendance = readyAttendance ?? lastKnownHeaderAttendance
  const profileLabel = !runtimeReady
    ? runtimeState === 'loading' ? 'Загрузка…' : 'Недоступно'
    : session && !session.isAnonymous
      ? session.name || session.email?.split('@')[0] || 'Профиль'
      : 'Гость'
  const signedIn = runtimeReady && Boolean(session && !session.isAnonymous)
  const hasClub = runtimeReady && Boolean(serverRuntime.dashboard?.membership.active)
  const hasOpenRoom = Boolean(openRooms.data?.rooms.length)
  const showRoomEntry = hasClub || hasOpenRoom
  const createRoom = onCreateRoom ?? (() => {
    if (!hasClub) {
      window.location.assign('/club')
      return
    }
    const returnUrl = '/games/together?new=1'
    window.location.assign(canCreateFriendsRoom(session)
      ? returnUrl
      : friendsRoomRegistrationHref(returnUrl))
  })
  const openRoomHub = () => {
    if (!hasClub && !hasOpenRoom) {
      window.location.assign('/club')
      return
    }
    const returnUrl = '/games/together'
    window.location.assign(canUseFriendsRoom(session)
      ? returnUrl
      : friendsRoomRegistrationHref(returnUrl))
  }
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
    <header className={`app-header${minimal ? ' app-header--minimal' : ''}`}>
      <div className="app-header__inner">
        <button className="brand" aria-label="На главный экран" onClick={() => { trackMetrikaGoal('header_home_click'); onHome() }}><BrandLogo /></button>
        {!minimal && <button
          className="header-economy"
          type="button"
          aria-busy={runtimeState === 'loading'}
          aria-label={runtimeReady && wallet && attendance
            ? `Билеты: ${wallet.tickets}. Серия: ${formatDays(attendance.currentDailyStreak)}`
            : runtimeState === 'loading' ? 'Загружаем билеты и серию' : 'Билеты и серия временно недоступны'}
          disabled={!runtimeReady}
          onClick={() => { trackMetrikaGoal('open_economy_modal'); setEconomyOpen(true) }}
        >
          <span><Ticket /> <strong>{wallet?.tickets ?? '—'}</strong></span>
          <span><Trophy /> <strong>{attendance?.currentDailyStreak ?? '—'}</strong>{attendance && <i>дн.</i>}</span>
        </button>}
        <nav aria-label="Навигация">
          {!minimal && <a
            className={`header-club ${hasClub ? 'is-active' : ''}`}
            href="/club"
            aria-label={hasClub ? 'Клубный билет активен' : 'Клуб'}
            title={hasClub ? 'Клубный билет активен' : 'Клуб «Сходится!»'}
            onClick={() => trackMetrikaGoal('open_club', { placement: 'header' })}
          >
            <Crown /><span>Клуб</span>
          </a>}
          {!minimal && showRoomEntry && <HeaderRoomMenu onCreateRoom={createRoom} rooms={openRooms.data?.rooms ?? []} />}
          <div className="header-profile-menu" ref={profileMenuRef}>
            <button ref={profileTriggerRef} disabled={!runtimeReady} onClick={() => setProfileMenuOpen((value) => !value)} className={`header-profile ${signedIn ? 'is-signed-in' : 'is-guest'} ${profileActive ? 'is-active' : ''}`} aria-label={runtimeReady ? 'Открыть меню' : profileLabel} title={runtimeReady ? 'Меню' : profileLabel} aria-busy={runtimeState === 'loading'} aria-haspopup="menu" aria-expanded={profileMenuOpen}>
              <span className="header-profile__avatar"><UserRound /></span><strong>{profileLabel}</strong><ChevronDown className="header-profile__chevron" />
            </button>
            {profileMenuOpen && <div className="header-profile-dropdown" role="menu">
              <div className="header-profile-dropdown__identity"><span className="header-profile__avatar"><UserRound /></span><div><strong>{signedIn ? session?.name || 'Игрок' : 'Гость кинозала'}</strong><small>{signedIn ? session?.email : 'Прогресс хранится в этом браузере'}</small></div></div>
              <button className="header-profile-dropdown__economy" type="button" role="menuitem" aria-label={`Билеты: ${wallet?.tickets ?? 0}. Серия: ${formatDays(attendance?.currentDailyStreak ?? 0)}`} onClick={() => { trackMetrikaGoal('open_economy_modal'); profileTriggerRef.current?.focus(); setProfileMenuOpen(false); setEconomyOpen(true) }}>
                <Ticket /><span>Билеты</span><strong>{wallet?.tickets}</strong>
                <Trophy /><span>Серия</span><strong>{attendance ? formatDays(attendance.currentDailyStreak) : ''}</strong>
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
    {!hideMobileNav && <nav className={`mobile-app-nav${showRoomEntry ? '' : ' mobile-app-nav--without-room'}`} aria-label="Основная навигация">
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
      {showRoomEntry && <button
        className={`mobile-app-nav__item mobile-app-nav__create ${mobileSection === 'room' ? 'is-active' : ''}`}
        type="button"
        aria-current={mobileSection === 'room' ? 'page' : undefined}
        onClick={() => { trackMetrikaGoal('friends_room_opened', { placement: 'mobile_nav' }); openRoomHub() }}
      >
        <i aria-hidden="true">{hasOpenRoom ? <DoorOpen /> : <Plus />}</i><span>Комната</span>
      </button>}
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
    </nav>}
    {economyOpen && runtimeReady && <Modal title="Билеты" onClose={() => setEconomyOpen(false)}><Suspense fallback={<div className="loading" role="status">Загружаем кассу…</div>}><EconomyView /></Suspense></Modal>}
  </>
}

export function AppFooter({ onHome, onArchive, onRules, onProfile }: { onHome: () => void; onArchive: () => void; onRules: () => void; onProfile: () => void }) {
  return <footer className="app-footer">
    <div className="app-footer__inner">
      <div className="app-footer__head">
        <div className="app-footer__brand">
          <button className="app-footer__home" onClick={onHome} aria-label="На главный экран">
            <img src={brandSymbolUrl} alt="" />
          </button>
          <p><strong>Неспешная игра на каждый день</strong><span>Новая загадка после полуночи по Москве</span></p>
        </div>
        <nav className="app-footer__primary" aria-label="Основные разделы">
          <button className="app-footer__link" onClick={onHome}>Сегодня</button>
          <button className="app-footer__link" onClick={onArchive}>Архив</button>
          <a className="app-footer__link" href="/specials">Спецпоказы</a>
          <a className="app-footer__link app-footer__link--club" href="/club"><Crown />Клуб</a>
        </nav>
      </div>
      <nav className="app-footer__games" aria-label="Все игры">
        <span>Все игры</span>
        <div>
          <a href="/games/movie">Кино</a>
          <a href="/games/series">Сериалы</a>
          <a href="/games/anime">Угадай аниме</a>
          <a href="/games/game">Угадай видеоигру</a>
          <a href="/games/city">Города</a>
          <a href="/games/music">Угадай исполнителя</a>
          <a href="/games/diagnosis">Угадай диагноз</a>
          <a href="/games/animal">Угадай животное</a>
          <a href="/games/book">Угадай книгу</a>
          <a href="/games/danetki">Данетки</a>
          <a href="/games/connections">Связи</a>
        </div>
      </nav>
      <div className="app-footer__bottom">
        <div className="app-footer__secondary">
          <nav className="app-footer__utility" aria-label="Сервис">
            <button onClick={onProfile}>Профиль</button>
            <button onClick={onRules}>Как играть</button>
            <a href="/partners">Для компаний</a>
          </nav>
          <nav className="app-footer__legal" aria-label="Юридическая информация">
            <a href="/legal/terms">Оферта</a>
            <a href="/legal/tariffs">Тарифы</a>
            <a href="/legal/privacy">Конфиденциальность</a>
            <a href="/legal/refunds">Возвраты</a>
            <a href="/legal/contacts">Реквизиты</a>
            <button type="button" onClick={() => window.dispatchEvent(new Event('shoditsa:cookie-settings'))}>Cookie</button>
          </nav>
        </div>
        <small className="app-footer__copy">© {new Date().getFullYear()} Сходится! · ИП Бренейзе А. В.<br />ИНН 540552157271 · ОГРНИП 318547600133003</small>
      </div>
    </div>
  </footer>
}

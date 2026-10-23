import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Menu, Ticket, X } from 'lucide-react'
import { ReferenceIcon } from '../ui/ReferenceIcon'
import { ControlButton } from '../ui/UiControls'
import { localPresentationLink } from '../../app/local-presentation'
import { BrandWordmark } from './BrandWordmark'
import './ReferenceGameChrome.css'

type ReferenceGameHeaderProps = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onEconomy: () => void
  tickets: number | null
  streak: number | null
  runtimeReady: boolean
  loading: boolean
  minimal?: boolean
  hideMobileNav?: boolean
  profileControl?: ReactNode
  roomControl?: ReactNode
  showCommerce?: boolean
}

export function ReferenceGameHeader({ onHome, onArchive, onStats, onRules, onEconomy, tickets, streak, runtimeReady, loading, minimal = false, hideMobileNav = false, profileControl, roomControl, showCommerce = false }: ReferenceGameHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen(false)
      menuTrigger.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape, true)
    return () => document.removeEventListener('keydown', closeOnEscape, true)
  }, [menuOpen])
  const navigate = (action: () => void) => {
    setMenuOpen(false)
    action()
  }

  return <header className={`reference-game-header${hideMobileNav ? ' reference-game-header--hide-mobile-nav' : ''}`}>
    <div className="reference-game-header__inner">
      <ControlButton className="reference-game-header__logo" aria-label="Сходится! — на главную" onClick={() => navigate(onHome)}>
        <BrandWordmark />
      </ControlButton>
      {!minimal && <nav className={`reference-game-header__nav${menuOpen ? ' is-open' : ''}`} id="reference-game-navigation" aria-label="Главная навигация">
        <ControlButton onClick={() => navigate(onHome)}>Игры</ControlButton>
        <ControlButton onClick={() => navigate(onArchive)}>Архив</ControlButton>
        <ControlButton onClick={() => navigate(onStats)}>Статистика</ControlButton>
        <ControlButton onClick={() => navigate(onRules)}>Как играть</ControlButton>
        {showCommerce && <a href={localPresentationLink('/club')}>Клуб</a>}
        {showCommerce && <a href={localPresentationLink('/specials')}>Спецпоказы</a>}
        {roomControl && <div className="reference-game-header__mobile-room">{roomControl}</div>}
      </nav>}
      {!minimal && <div className="reference-game-header__actions">
        <ControlButton
          className="reference-game-header__progress"
          disabled={!runtimeReady}
          aria-busy={loading}
          aria-label={runtimeReady ? `Билеты: ${tickets ?? '—'}. Дней подряд: ${streak ?? '—'}. Открыть билеты` : loading ? 'Загружаем билеты и серию' : 'Билеты и серия временно недоступны'}
          onClick={onEconomy}
        >
          <span><Ticket aria-hidden="true" /><strong>{tickets ?? '—'}</strong><span className="reference-game-header__ticket-label">билетов</span></span>
          <span className="reference-game-header__streak"><ReferenceIcon name="flame" /><strong>{streak ?? '—'}</strong></span>
        </ControlButton>
        {roomControl && <div className="reference-game-header__room">{roomControl}</div>}
        {profileControl}
        {!hideMobileNav && <ControlButton ref={menuTrigger} className="reference-game-header__menu" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menuOpen} aria-controls="reference-game-navigation" onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <X /> : <Menu />}
        </ControlButton>}
      </div>}
    </div>
  </header>
}

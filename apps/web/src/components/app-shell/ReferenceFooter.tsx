import { ArrowUpRight } from 'lucide-react'
import { LOCAL_PRESENTATION, localPresentationLink } from '../../app/local-presentation'
import { PUBLIC_GAME_LINKS } from '../../app/public-game-links'
import { GAME_SEO } from '../../app/seo-content'
import { DANETKI_DISCOVERY_LINKS } from '../../app/danetki-discovery-links'
import { ControlButton } from '../ui/UiControls'
import { BrandWordmark } from './BrandWordmark'
import './ReferenceFooter.css'

type ReferenceFooterProps = {
  onHome: () => void
  onArchive: () => void
  onRules: () => void
  onProfile: () => void
}

/** A quiet navigation layout; routes and actions stay with the shared app shell. */
export function ReferenceFooter({ onHome, onArchive, onRules, onProfile }: ReferenceFooterProps) {
  const games = PUBLIC_GAME_LINKS.filter((game) => !LOCAL_PRESENTATION || !['danetki', 'connections'].includes(game.mode))
  return <footer className="reference-footer">
    <div className="reference-footer__inner">
      <div className="reference-footer__main">
        <div className="reference-footer__intro">
          <ControlButton className="reference-footer__brand" onClick={onHome} aria-label="Сходится! — на главный экран"><BrandWordmark variant="footer" /></ControlButton>
          <p>Немного любопытства, одна хорошая догадка — и маленькое открытие каждый день.</p>
          <span className="reference-footer__note">До новой загадки!</span>
        </div>
        <nav className="reference-footer__games" aria-label="Все игры">
          <h2>Во что сыграем?</h2>
          <div>{games.map((game) => <a key={game.mode} href={localPresentationLink(game.href)}>{GAME_SEO[game.mode].shortName}</a>)}</div>
        </nav>
        <nav className="reference-footer__navigation" aria-label="Разделы сайта">
          <h2>Рядом с игрой</h2>
          <ControlButton onClick={onHome}>Сегодня</ControlButton>
          <ControlButton onClick={onArchive}>Архив</ControlButton>
          <ControlButton onClick={onProfile}>Мой профиль</ControlButton>
          <ControlButton onClick={onRules}>Как играть</ControlButton>
          <a href={localPresentationLink('/support')}>Поддержка</a>
          <a href={localPresentationLink('/blog')}>Блог</a>
          {!LOCAL_PRESENTATION && <><a href={localPresentationLink('/club')}>Клуб</a><a href={localPresentationLink('/specials')}>Спецпоказы</a><a href={localPresentationLink('/partners')}>Для компаний<ArrowUpRight size={14} aria-hidden="true" /></a></>}
        </nav>
        {!LOCAL_PRESENTATION && <nav className="reference-footer__stories" aria-label="Подборки и истории данеток">
          <h2>Любителям историй</h2>
          {DANETKI_DISCOVERY_LINKS.map((link) => <a key={link.href} href={localPresentationLink(link.href)}>{link.label}</a>)}
        </nav>}
      </div>
      <div className="reference-footer__bottom">
        <nav className="reference-footer__legal" aria-label="Юридическая информация">
          <a href={localPresentationLink('/legal/terms')}>Оферта</a>
          <a href={localPresentationLink('/legal/tariffs')}>Тарифы</a>
          <a href={localPresentationLink('/legal/privacy')}>Конфиденциальность</a>
          <a href={localPresentationLink('/legal/refunds')}>Возвраты</a>
          <a href={localPresentationLink('/legal/contacts')}>Реквизиты</a>
          <ControlButton onClick={() => window.dispatchEvent(new Event('shoditsa:cookie-settings'))}>Настройки cookie</ControlButton>
        </nav>
        <div className="reference-footer__credits"><span>© {new Date().getFullYear()} Сходится!</span><small>ИП Бренейзе А. В., ИНН 540552157271<br />ОГРНИП 318547600133003</small></div>
      </div>
    </div>
  </footer>
}

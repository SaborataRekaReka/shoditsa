import { GameArtwork } from '../../components/ui/GameArtwork'
import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { useState } from 'react'
import { ArrowDown, ArrowRight, ChevronDown } from 'lucide-react'
import { CATALOG_GUESS_MODE_IDS } from '@shoditsa/contracts'
import type { MetaResponse } from '@shoditsa/contracts'
import { useStudyAccountCache } from '../quest-game/study-account-cache'
import { useDailyReset } from '../../hooks/use-daily-reset'
import { HOME_HERO_COPY } from '../../app/home-copy'
import { HOME_SEO, INDEXABLE_GAME_SEO, type GameSeoContent, type SeoGameMode } from '../../app/seo-content'
import { PUBLIC_GAME_LINKS } from '../../app/public-game-links'
import { publicAssetUrl } from '../../app/public-asset'
import { REFERENCE_HOME_CARD_COPY } from '../../features/home/reference-home-copy'
import { GeneratedShoditsaGlyph as Glyph } from '../quest-game/GeneratedShoditsaArt'
import { StudySidebar } from '../quest-game/StudySidebar'
import { StudyHeader } from '../quest-game/StudyHeader'
import { StudyRightSidebar } from '../quest-game/StudyRightSidebar'
import { StudyFooter } from '../quest-game/StudyTheme'
import { StudyGameDirectory } from '../quest-game/StudyGameDirectory'
import type { StudyView } from '../quest-game/navigation'
import { StudyGuestPlayWidget } from '../quest-game/StudySidebarWidgets'
import { STUDY_CLUB_HREF } from '../quest-game/account-routing'
import { useGameAvailability, type GameAvailability } from './game-availability'
import { studyHomeHref } from '../quest-game/home-route'
import { AVAILABILITY_PRESENTATION, GameAvailabilityBadge } from './GameAvailabilityBadge'
import { HomePromoHero } from './HomePromoHero'
import { HomeSpecials } from './HomeSpecials'
import { SvoyakHomeCard, SVOYAK_ENABLED } from '../../features/svoyak/SvoyakHomeCard'
import { LOBBY_HREF } from '../../features/rooms/room-navigation'

export type HomeVariant = 'a' | 'b' | 'c'
const games: readonly GameSeoContent[] = INDEXABLE_GAME_SEO
const quizGames = games.filter(game => CATALOG_GUESS_MODE_IDS.some(mode => mode === game.mode))
const logicGames = games.filter(game => !CATALOG_GUESS_MODE_IDS.some(mode => mode === game.mode))
const catalogueGroups = [
  { id: 'quiz', title: 'Викторины', description: 'Угадывай по подсказкам и сравнивай признаки. В каждой игре — новая загадка дня.', games: quizGames },
  { id: 'logic', title: 'Логика и загадки', description: 'Находи связи между словами и распутывай необычные истории.', games: logicGames },
]
const worlds: { id: string; title: string; subtitle: string; modes: SeoGameMode[]; art: string }[] = [
  { id: 'culture', title: 'В мире историй', subtitle: 'Знакомые сюжеты. Неожиданные детали.', modes: ['movie', 'series', 'anime', 'game', 'music', 'character'], art: 'movie' },
  { id: 'discover', title: 'Вокруг нас', subtitle: 'Наблюдай, вспоминай, находи.', modes: ['city', 'animal', 'book', 'diagnosis'], art: 'city' },
  { id: 'logic', title: 'Дело в логике', subtitle: 'Одна хорошая догадка меняет всё.', modes: ['connections', 'danetki'], art: 'associations' },
]
const asset = (path: string) => publicAssetUrl(`images/${path}`)

function Hero({ variant, onAbout }: { variant: HomeVariant; onAbout: () => void }) {
  if (variant === 'a') return <HomePromoHero />
  return <header className="hs-hero">
    <div className="hs-hero-copy">
      <div className="hs-eyebrow"><Glyph name="flame" size={25} /><span>Новые загадки каждый день</span></div>
      <h1>{HOME_HERO_COPY.heading}</h1>
      <p>{HOME_HERO_COPY.lead}</p>
      <div className="hs-hero-actions"><a className="quest-button quest-button--outline hs-primary" href="#home-games">{HOME_HERO_COPY.playLabel}</a><a className="hs-text-action" href="#home-guide" onClick={onAbout}>{HOME_HERO_COPY.rulesLabel}<ArrowRight size={17} /></a></div>
    </div>
    <figure className="hs-hero-scene" aria-hidden="true"><span className="hs-scene-shape" /><img className="hs-mascot" src={asset(`mascot/${variant === 'c' ? 'hero-scene-v1' : 'welcome-v1'}.webp`)} alt="" width="300" height="300" fetchPriority="high" />{variant === 'b' && <><img className="hs-floating hs-floating--one" src={asset('home-doodle/movie.webp')} alt="" width="80" height="80" /><img className="hs-floating hs-floating--two" src={asset('home-doodle/music.webp')} alt="" width="80" height="80" /><span className="hs-scene-note">Есть догадка?</span></>}</figure>
  </header>
}

function GameCard({ game, variant, availability }: { game: GameSeoContent; variant: HomeVariant; availability: GameAvailability }) {
  const showAvailability = variant === 'a' && availability !== 'online'
  const Heading = variant === 'c' ? 'h3' : 'h4'
  return <a className={`hs-game hs-game--${game.mode}`} data-game={game.mode} href={game.canonicalPath} aria-label={`Играть: ${game.shortName}${showAvailability ? `. ${AVAILABILITY_PRESENTATION[availability].detail}` : ''}`}>
    <span className="hs-game-art"><GameArtwork mode={game.mode} alt="" width="88" height="88" loading="lazy" /></span>
    <div className="hs-game-copy"><Heading>{game.shortName}</Heading><p>{REFERENCE_HOME_CARD_COPY[game.mode]}</p></div>{showAvailability ? <GameAvailabilityBadge state={availability} /> : variant !== 'a' && <ArrowRight className="hs-game-arrow" size={20} aria-hidden="true" />}
  </a>
}

function CompanyGames({ territoryEnabled }: { territoryEnabled: boolean }) {
  return <section className="hs-company-games hs-game-group" id="home-company" aria-labelledby="home-company-heading">
    <header className="hs-game-group-heading"><div><h2 id="home-company-heading">С компанией</h2><p>Клуб нужен создателю комнаты. Друзья входят по приглашению бесплатно.</p></div></header>
    <div className="hs-company-grid">
      <a className="hs-game hs-game--company" href={LOBBY_HREF}>
        <span className="hs-game-art"><ThemedArtwork src={asset('home-doodle/together.svg')} alt="" width="88" height="88" loading="lazy" /></span>
        <div className="hs-game-copy"><h3>Играть с друзьями</h3><p>Выбери режим, настрой правила и пригласи свою компанию.</p></div>
        <span className="hs-game-access"><Glyph name="medal" size={20} />Только членам клуба</span>
        <span className="hs-game-link">В лобби<ArrowRight size={17} aria-hidden="true" /></span>
      </a>
      {territoryEnabled && <a className="hs-game hs-game--territory" data-game="territory" href={`${LOBBY_HREF}?mode=territory`}>
        <span className="hs-game-art"><GameArtwork mode="territory" alt="" width="88" height="88" loading="lazy" /></span>
        <div className="hs-game-copy"><h3>Захват территорий</h3><p>Отвечай на вопросы, захватывай земли и защищай свою столицу. Дуэль на двоих.</p></div>
        <span className="hs-game-access"><Glyph name="medal" size={20} />Только членам клуба</span>
        <span className="hs-game-link">Настроить дуэль<ArrowRight size={17} aria-hidden="true" /></span>
      </a>}
      <SvoyakHomeCard />
    </div>
  </section>
}

export function HomeSourceContent({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  return <details className="hs-guide" id="home-guide" open={open} onToggle={event => onToggle(event.currentTarget.open)}>
    <summary><Glyph name="hint" size={42} /><span><strong>Как устроены ежедневные игры</strong><small>Формат, подсказки и все режимы</small></span><ChevronDown size={21} /></summary>
    <div className="hs-guide-content"><span className="hs-eyebrow">Путеводитель без спойлеров</span><h2 id="home-about-title">{HOME_SEO.heading}</h2><p>{HOME_SEO.lead}</p>{HOME_SEO.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      <StudyGameDirectory games={PUBLIC_GAME_LINKS} />
    </div>
  </details>
}

function HomeFooter() {
  return <footer className="hs-footer" aria-label="Информация о сайте"><nav aria-label="Разделы сайта"><a href="/games/together">Игра с друзьями</a><a href="/specials">Спецпоказы</a><a href={STUDY_CLUB_HREF}>Клуб</a><a href="/partners">Для компаний</a><a href="/danetki">Данетки с ответами</a></nav><nav aria-label="Юридическая информация"><a href="/legal/terms">Оферта</a><a href="/legal/tariffs">Тарифы</a><a href="/legal/privacy">Конфиденциальность</a><a href="/legal/refunds">Возвраты</a><a href="/legal/contacts">Реквизиты</a></nav></footer>
}

export function HomeVariants({ variant, onNavigate, onSettings }: { variant: HomeVariant; clubPreview?: boolean; onNavigate?: (view: StudyView) => void; onSettings?: () => void }) {
  const [guideOpen, setGuideOpen] = useState(false)
  const { date, label: resetLabel, minutes: resetMinutes, remainingFraction } = useDailyReset()
  const availability = useGameAvailability(date)
  const meta = useStudyAccountCache<MetaResponse>(['meta'])
  const territoryEnabled = meta?.features.territoryEnabled === true
  const gameCount = games.length + Number(SVOYAK_ENABLED) + Number(territoryEnabled)
  return <>
    <div className={`qg-app hs-app hs-app--${variant}`}>
      <a className="hs-skip" href="#home-main">Перейти к играм</a>
      <StudySidebar view="games" shoditsa homeHref={studyHomeHref(variant)!} Glyph={Glyph} onNavigate={onNavigate} />
      <main className="qg-layout study-layout" id="home-main" tabIndex={-1}><StudyHeader Glyph={Glyph} onHome={onNavigate ? () => onNavigate('games') : undefined} onProfile={onNavigate ? () => onNavigate('profile') : undefined} onSettings={onSettings} /><div className="qg-main hs-main-column">
          <Hero variant={variant} onAbout={() => setGuideOpen(true)} />
          {variant === 'c' ? <div className="hs-worlds" id="home-games"><nav className="hs-world-jumps" aria-label="Игры по интересам">{worlds.map(world => <a href={`#world-${world.id}`} key={world.id}>{world.title}<ArrowDown size={14} /></a>)}</nav>{worlds.map(world => <section className={`hs-world hs-world--${world.id}`} id={`world-${world.id}`} key={world.id} aria-labelledby={`world-heading-${world.id}`}><header><span>{String(worlds.indexOf(world) + 1).padStart(2, '0')}</span><h2 id={`world-heading-${world.id}`}>{world.title}</h2><p>{world.subtitle}</p><img src={asset(`home-doodle/${world.art}.webp`)} alt="" width="120" height="120" loading="lazy" /></header><div>{world.modes.map(mode => <GameCard key={mode} game={games.find(game => game.mode === mode)!} variant={variant} availability={availability[mode]} />)}</div></section>)}</div> : <section className="hs-catalogue" id="home-games" aria-labelledby="home-games-heading">
            <div className="hs-section-heading">
              <div className="hs-catalogue-title"><h2 id="home-games-heading">Выбери свою игру</h2><sup className="hs-game-count" aria-label={`${gameCount} игр`}>{gameCount}</sup></div>
              <span className="hs-catalogue-reset" role="timer" aria-live="off" aria-label={`До новых загадок ${resetLabel}`} title={`Новые загадки через ${resetLabel}. Обновление в 00:00 МСК`}>
                <svg viewBox="0 0 48 48" aria-hidden="true"><circle className="hs-reset-track" cx="24" cy="24" r="21" /><circle className="hs-reset-progress" cx="24" cy="24" r="21" pathLength="100" strokeDasharray={`${remainingFraction * 100} 100`} /></svg>
                <span aria-hidden="true"><strong>{resetMinutes >= 60 ? Math.ceil(resetMinutes / 60) : resetMinutes}</strong><small>{resetMinutes >= 60 ? 'ч' : 'мин'}</small></span>
              </span>
            </div>
            <nav className="hs-catalogue-jumps" aria-label="Категории игр">
              {catalogueGroups.map(group => <a key={group.id} href={`#home-${group.id}`}>{group.title}<span>{group.games.length}</span></a>)}
              <a href="#home-company">С компанией</a>
              <a href="#home-specials">Спецпоказы<Glyph name="medal" size={18} /></a>
            </nav>
            {catalogueGroups.map(group => <section className="hs-game-group" id={`home-${group.id}`} key={group.id} aria-labelledby={`home-${group.id}-heading`}>
              <header className="hs-game-group-heading"><div><h3 id={`home-${group.id}-heading`}>{group.title}</h3><p>{group.description}</p></div><span className="hs-free-label">Загадка дня бесплатно</span></header>
              <div className={`hs-game-grid${group.id === 'logic' ? ' hs-game-grid--logic' : ''}`}>{group.games.map(game => <GameCard game={game} key={game.mode} variant={variant} availability={availability[game.mode]} />)}</div>
            </section>)}
          </section>}
          <CompanyGames territoryEnabled={territoryEnabled} />
          <HomeSpecials />
        </div><StudyRightSidebar className="hs-day-aside" label="Твои игры" showToday={false} gamesFirst><StudyGuestPlayWidget /><StudyFooter><a href={STUDY_CLUB_HREF}>Клуб</a><a href="#home-guide">Как играть</a></StudyFooter></StudyRightSidebar>
        <div className="hs-reference-column"><HomeSourceContent open={guideOpen} onToggle={setGuideOpen} /><HomeFooter /></div>
      </main>
    </div>
  </>
}

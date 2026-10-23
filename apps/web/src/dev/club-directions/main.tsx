import { publicAssetUrl } from '../../app/public-asset'
/** Isolated design study. This entry is not imported by the application or its production build. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDown, ArrowRight, ChevronLeft, Menu, Ticket } from 'lucide-react'
import { ActionButton, ActionLink } from '../../components/ui/UiControls'
import { ReferenceIcon } from '../../components/ui/ReferenceIcon'
import { BrandWordmark } from '../../components/app-shell/BrandWordmark'
import { mascotAsset } from '../../components/mascot/Mascot'
import { buildClubPageViewModel } from '../../features/commerce/club-page-model'
import '../../styles/reference-tokens.css'
import './study.css'

const view = buildClubPageViewModel({ authenticated: false })
const home = '/?preview=reference#/?preview=reference'
const money = (minor: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(minor / 100)
const monthly = view.pricing.monthly
const annual = view.pricing.annual
const directions = [
  { id: 'a', name: 'Рядом с главной', short: 'Три части в первом экране · цветная полка возможностей', description: 'Текст, крупный персонаж и билет рядом. Затем — цельные пастельные карточки, как в каталоге игр на главной.' },
  { id: 'b', name: 'Крупнее и свободнее', short: 'Свободный первый экран · большие иллюстрированные секции', description: 'Больше воздуха и крупнее рисунки. Возможности раскрываются парами, а билет становится спокойным завершением страницы.' },
  { id: 'c', name: 'Билет в центре', short: 'Билет и персонаж в первом экране · затем возможности', description: 'Сначала — выбор срока в общей сцене с персонажем. Затем — крупные игровые плитки и спецпоказ. Самая короткая дорога к сравнению билетов.' },
] as const
type Direction = typeof directions[number]['id']
const isDirection = (value: string): value is Direction => directions.some(direction => direction.id === value)
const params = new URLSearchParams(window.location.search)
const page = params.get('view') ?? 'compare'
const embedded = params.has('embed')
const referenceOne = new URL('../../../../../qa/club-directions-2026-10-16/home-screen-1.png', import.meta.url).href
const referenceTwo = new URL('../../../../../qa/club-directions-2026-10-16/home-screen-2.png', import.meta.url).href

const benefits = [
  { title: 'Весь архив', description: `${view.stats.freeArchiveDays} дней доступны бесплатно · весь архив — в клубе`, image: 'movie', tone: 'lilac', label: 'Посмотреть архив' },
  { title: 'Свободная игра', description: `${view.stats.freePlayModes} режимов · без списания билетиков с Клубом`, image: 'game', tone: 'mint', label: 'Выбрать игру' },
  { title: 'Данетки', description: `${view.stats.danetkiPerDay} истории в сутки с клубным билетом`, image: 'yes-no', tone: 'yellow', label: 'Раскрыть историю' },
  { title: 'Комната друзей', description: `До ${view.stats.friendRoomRoundLimit} раундов. Друзья присоединяются по приглашению бесплатно.`, image: 'associations', tone: 'blue', label: 'Открыть с Клубом' },
] as const
const comparisons = [
  ['Архив', `${view.stats.freeArchiveDays} дней`, 'Весь'],
  ['Свободная игра', `${view.stats.guestFreePlayCost} билетиков`, '∞'],
  ['Клубные спецпоказы', 'Закрыты', 'Все'],
  ['Данетки', `${view.stats.guestDanetkiPerDay} в сутки`, `${view.stats.danetkiPerDay} в сутки`],
  ['Комната друзей', 'По приглашению', `${view.stats.friendRoomRoundLimit} раундов`],
  ['Билетики', 'Сохраняются', 'Сохраняются'],
]

function StudyNav() {
  return <nav className="study-nav" aria-label="Варианты дизайна">
    <a className="study-nav__title" href="/club-directions.html">Клуб / три направления</a>
    <div>{[['compare', 'Сравнить'], ['a', 'A'], ['b', 'B'], ['c', 'C'], ['reference', 'Эталон']].map(([id, label]) => <a key={id} href={`?view=${id}`} aria-current={page === id ? 'page' : undefined}>{label}</a>)}</div>
    <span>Макеты · выбор направления</span>
  </nav>
}

function SiteHeader() {
  return <header className="club-study-header"><div className="study-container">
    <a href={home} aria-label="Сходится! — на главную"><BrandWordmark /></a>
    <div className="club-study-header__actions">
      <span className="club-study-wallet"><Ticket size={17} /> <b>15</b> <span>билетов</span><i /><ReferenceIcon name="flame" size={17} /> 1</span>
      <span className="club-study-guest"><ReferenceIcon name="user" size={20} /> Гость</span>
      <details className="club-study-menu"><summary aria-label="Открыть меню"><Menu size={23} /></summary><div><a href={home}>Все игры</a><a href="#club-content">Что входит в Клуб</a><a href="#club-offers">Клубный билет</a></div></details>
    </div>
  </div></header>
}

function Primary({ children = 'Выбрать клубный билет' }: { children?: ReactNode }) {
  return <ActionLink href="#club-offers">{children}<ArrowRight size={18} /></ActionLink>
}
function HeroCopy({ actions = true }: { actions?: boolean }) {
  return <div className="club-study-copy">
    <p className="club-study-meta">Клуб «Сходится!» <span>Гостевой режим</span></p>
    <h1>Здесь игра продолжается</h1>
    <p className="club-study-lead">Полный архив, свободные партии, все спецпоказы и {view.stats.danetkiPerDay} Данетки в сутки.</p>
    {actions && <><div className="club-study-hero-actions"><Primary /><a className="club-study-quiet" href="#club-content">Что входит в Клуб <ArrowDown size={17} /></a></div>
    <p className="club-study-terms">От {money(monthly.priceMinor)} за {monthly.durationDays} дней · автопродление по выбору</p></>}
  </div>
}
function Character() {
  return <figure className="club-study-character"><img src={mascotAsset('club')} alt="Зелёный пушистый персонаж с клубным билетом" width="1254" height="1254" /></figure>
}
function TicketPreview() {
  return <aside className="club-study-ticket" aria-label="Клубный билет на 30 дней">
    <div className="club-study-ticket__heading"><h2>Клубный билет</h2><Ticket size={24} /></div>
    <div className="club-study-ticket__body"><span>{monthly.durationDays} дней в Клубе</span><strong>{money(monthly.priceMinor)}</strong><p>Все возможности Клуба.<br />Разница только в сроке.</p></div>
    <Primary>Выбрать свой билет</Primary>
    <small>Автопродление — по вашему выбору</small>
  </aside>
}
function Hero({ direction, onSelect }: { direction: Direction; onSelect: (title: string) => void }) {
  if (direction === 'c') return <section className="club-study-hero study-container" aria-label="Клуб «Сходится!»">
    <HeroCopy actions={false} /><div className="club-study-price-stage"><Character /><Plans onSelect={onSelect} /></div>
  </section>
  return <section className="club-study-hero study-container" aria-label="Клуб «Сходится!»">
    <HeroCopy /><Character />{direction === 'a' && <TicketPreview />}
  </section>
}
function Benefits() {
  return <section className="club-study-benefits study-container" id="club-content" aria-labelledby="club-study-benefits-heading">
    <div className="club-study-section-head"><h2 id="club-study-benefits-heading">Играть в своём ритме</h2><p>Больше возможностей с одним клубным билетом.</p></div>
    <div className="club-study-benefit-grid">{benefits.map((benefit, index) => <article className="club-study-benefit" data-tone={benefit.tone} key={benefit.title}>
      <div className="club-study-benefit__copy"><span className="club-study-index">0{index + 1}</span><h3>{benefit.title}</h3><p>{benefit.description}</p><a href="#club-offers" className="club-study-benefit__link">{benefit.label}<ArrowRight size={19} /></a></div>
      <img src={`/images/home-doodle/${benefit.image}.webp`} width="400" height="400" alt="" />
    </article>)}</div>
  </section>
}
function Special() {
  return <section className="club-study-special study-container" aria-labelledby="club-study-special-heading">
    <figure><img src={publicAssetUrl('images/title-posters/movie-ticket-poster.webp')} width="800" height="800" alt="" /></figure>
    <div><p className="club-study-label"><ReferenceIcon name="movie" size={22} /> Клубный спецпоказ</p><h2 id="club-study-special-heading">Кино нулевых</h2><p>Фильмы, которые смотрели все</p><ActionLink variant="secondary" href="#club-offers">Открыть с клубным билетом<ArrowRight size={18} /></ActionLink></div>
  </section>
}
function Plans({ onSelect }: { onSelect: (title: string) => void }) {
  return <section className="club-study-pricing study-container" id="club-offers" aria-labelledby="club-study-pricing-heading">
    <div className="club-study-section-head"><h2 id="club-study-pricing-heading">Выберите свой билет</h2><p>Все возможности Клуба. Разница только в сроке.</p></div>
    <div className="club-study-plans">{[monthly, annual].map((product, index) => <article key={product.id} className="club-study-plan" data-tone={index ? 'lilac' : 'yellow'}>
      <div className="club-study-plan__heading"><h3>{product.durationDays} дней в Клубе</h3><Ticket size={26} /></div>
      <strong className="club-study-price">{money(product.priceMinor)}</strong>
      <p className="club-study-daily">{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(product.priceMinor / 100 / product.durationDays!)} ₽ в день{index === 1 && <span>Выгоднее на {view.pricing.annualDiscountPercent}%</span>}</p>
      <p className="club-study-plan__detail">{index ? `Экономия ${money(view.pricing.annualSavingsMinor)} по сравнению с 12 билетами на 30 дней.` : 'Чтобы познакомиться со всеми возможностями и найти свой ритм.'}</p>
      <ActionButton variant={index ? 'secondary' : 'primary'} onClick={() => onSelect(product.title)}>Выбрать билет<ArrowRight size={18} /></ActionButton>
      <small>Сначала вход или регистрация. Оплата — только после вашего подтверждения.</small>
    </article>)}</div>
    <p className="club-study-renewal">Автопродление — только по вашему выбору. Управление билетом — в профиле.</p>
  </section>
}
function Comparison() {
  return <section className="club-study-comparison study-container" aria-labelledby="club-study-comparison-heading">
    <div className="club-study-section-head"><h2 id="club-study-comparison-heading">Можно играть и бесплатно</h2><p>Ежедневные загадки доступны всем. Клуб открывает больше.</p></div>
    <div className="club-study-comparison__rows"><div className="club-study-comparison__labels"><span>Возможности</span><span>Без билета</span><strong>С Клубом</strong></div>{comparisons.map(([label, guest, club]) => <div className="club-study-comparison__row" key={label}><h3>{label}</h3><span><small>Без билета</small>{guest}</span><strong><small>С Клубом</small>{club}</strong></div>)}</div>
    <a href={home} className="club-study-quiet">Продолжить бесплатно<ArrowRight size={18} /></a><p className="club-study-terms">Ваши билетики сохраняются в любом режиме.</p>
  </section>
}
function Footer() {
  return <footer className="club-study-footer"><div className="study-container"><div><BrandWordmark variant="footer" /><p>Немного любопытства, одна хорошая догадка —<br />и маленькое открытие каждый день.</p></div><a href={home}>Во что сыграем? <ArrowRight size={20} /></a><span className="club-study-footer__note">До новой загадки!</span></div></footer>
}
function ClubPage({ direction }: { direction: Direction }) {
  const [selected, setSelected] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const originRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!selected) return
    originRef.current = document.activeElement as HTMLElement
    closeRef.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected('')
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus() }
    }
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('keydown', escape); originRef.current?.focus({ preventScroll: true }) }
  }, [selected])
  useEffect(() => {
    if (!embedded) return
    const observer = new ResizeObserver(() => window.parent.postMessage({ type: 'club-study-height', direction, height: Math.ceil(document.body.getBoundingClientRect().height) }, window.location.origin))
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [direction])
  return <div className={`club-study club-study--${direction}`}>
    <SiteHeader />
    <main>
      <div className="club-study-back study-container"><a href={home}><ChevronLeft size={16} /> Все игры</a></div>
      <Hero direction={direction} onSelect={setSelected} /><Benefits /><Special />{direction !== 'c' && <Plans onSelect={setSelected} />}<Comparison />
    </main>
    <Footer />
    {selected && <div className="study-dialog-backdrop" onClick={() => setSelected('')}><section role="dialog" aria-modal="true" aria-labelledby="study-dialog-title" className="study-dialog" onClick={event => event.stopPropagation()}><h2 id="study-dialog-title">{selected}</h2><p>Это макет для выбора дизайна. Здесь нет входа, заказа и оплаты.</p><ActionButton ref={closeRef} onClick={() => setSelected('')}>Вернуться к макету</ActionButton></section></div>}
  </div>
}
function Preview({ direction }: { direction: typeof directions[number] }) {
  const [height, setHeight] = useState(3000)
  const [width, setWidth] = useState(360)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    if (ref.current) observer.observe(ref.current)
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === 'club-study-height' && event.data.direction === direction.id) setHeight(event.data.height)
    }
    window.addEventListener('message', receive)
    return () => { observer.disconnect(); window.removeEventListener('message', receive) }
  }, [direction.id])
  const scale = width / 1413
  return <article className="study-preview"><header><span>{direction.id.toUpperCase()}</span><h2>{direction.name}</h2><p>{direction.short}</p><ActionLink variant="secondary" href={`?view=${direction.id}`}>Открыть целиком<ArrowRight size={18} /></ActionLink></header><a className="study-preview__page" href={`?view=${direction.id}`} aria-label={`Открыть вариант ${direction.id.toUpperCase()} — ${direction.name}`}><div ref={ref} style={{ height: height * scale }}><iframe title={`Обзор варианта ${direction.id.toUpperCase()}`} tabIndex={-1} aria-hidden="true" src={`?view=${direction.id}&embed=1`} style={{ width: 1413, height, transform: `scale(${scale})` }} /></div></a></article>
}
function Reference() {
  return <main className="study-reference study-container"><h1>Главная — наш визуальный эталон</h1><p>Моё прочтение, которое проверяем на трёх вариантах клуба.</p><ol><li><strong>Открытое пространство.</strong> Текст и большой рисунок составляют одну сцену.</li><li><strong>Цвет целыми плоскостями.</strong> Пастель заполняет игровые карточки.</li><li><strong>Живые рисунки.</strong> Тематические иллюстрации крупные и видны целиком.</li><li><strong>Разный масштаб секций.</strong> Герой → полка игр → небольшие заметки → широкая полоса.</li><li><strong>Спокойная типографика с характером.</strong> Плотные чёрные заголовки, простой текст, редкий рукописный акцент.</li></ol><img src={referenceOne} alt="Первый экран эталонной главной" /><img src={referenceTwo} alt="Второй экран эталонной главной" /><ActionLink href="?view=compare">Сравнить направления<ArrowRight size={18} /></ActionLink></main>
}
function App() {
  return <>{!embedded && <StudyNav />}{isDirection(page) ? <><div className="study-direction-note" hidden={embedded}><strong>{page.toUpperCase()} / {directions.find(direction => direction.id === page)?.name}</strong><span>{directions.find(direction => direction.id === page)?.description}</span></div><ClubPage direction={page} /></> : page === 'reference' ? <Reference /> : <main className="study-comparison"><div className="study-intro"><p>Сходится! / страница клуба</p><h1>Три способа продолжить стиль главной</h1><p>Сравни целую страницу: композицию, рисунки, ритм и настроение. Во всех вариантах одни условия и содержательные тексты.</p><a href="?view=reference">Посмотреть эталон и моё прочтение <ArrowRight size={18} /></a><small>Изолированные макеты на демонстрационных данных. Основной сайт не изменён.</small></div><div className="study-preview-grid">{directions.map(direction => <Preview key={direction.id} direction={direction} />)}</div><div className="study-choice"><h2>Что ближе по ощущению?</h2><p>Можно выбрать целый вариант или сказать: «первый экран из B, продолжение из A». Если все три мимо, это тоже полезный ответ.</p></div></main>}</>
}

createRoot(document.getElementById('root')!).render(<App />)

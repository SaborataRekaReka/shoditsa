/** Isolated interactive art-direction studies. No checkout or production entry imports. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { publicAssetUrl } from '../../app/public-asset'
import { ArrowLeft, ArrowRight, Check, Pause, Play, Sun, Moon } from 'lucide-react'
import { ActionButton, ControlButton } from '../../components/ui/UiControls'
import { BrandWordmark } from '../../components/app-shell/BrandWordmark'
import { GeneratedShoditsaGlyph as Glyph } from '../quest-game/GeneratedShoditsaArt'
import { StudyLobbyIcon } from '../quest-game/StudyLobbyIcon'
import { StudyProfileIcon } from '../quest-game/StudyProfileArt'
import { StudyClubOffer } from '../quest-game/StudyClubOffer'
import { buildClubPageViewModel, dailyPriceMinor } from '../../features/commerce/club-page-model'
import '../../styles/reference-tokens.css'
import '../../styles/quest-study-tokens.css'
import '../../styles/shoditsa-study-tokens.css'
import './study.css'

const pricing = buildClubPageViewModel({ authenticated: true }).pricing
const products = [pricing.monthly, pricing.annual]
const money = (minor: number, digits = 0) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: digits }).format(minor / 100)
const directions = [
  { id: 'a', name: 'Билет как предмет', detail: 'Один большой переливающийся билет. Срок и цена меняются прямо на нём.', reference: 'Super Duolingo', href: 'https://blog.duolingo.com/super-duolingo-launch/', principle: 'Цвет и движение сосредоточены в одном главном объекте.' },
  { id: 'b', name: 'Приглашение в Клуб', detail: 'Маскот, короткий выбор срока и привычная кнопка. Самый игровой вариант.', reference: 'Headspace', href: 'https://www.headspace.com/subscriptions', principle: 'Дружелюбная иллюстрация и компактная группа выбора.' },
  { id: 'c', name: 'Всё в одном', detail: 'Возможности Клуба на первом плане. Больше воздуха и спокойнее покупка.', reference: 'Apple One', href: 'https://www.apple.com/apple-one/', principle: 'Ценность набора показана через его содержимое на белом поле.' },
] as const
type Direction = typeof directions[number]['id']
const variantHref = (direction?: Direction, dark = false) => {
  const params = new URLSearchParams()
  if (direction) params.set('view', direction)
  if (dark) params.set('tone', 'dark')
  return `/club-paywall-directions.html${params.size ? `?${params}` : ''}`
}
const query = new URLSearchParams(location.search)
const current = directions.find(item => item.id === query.get('view'))
const embedded = query.has('embed')
const benefits = ['Весь архив', 'Свободная игра', 'Все спецпоказы']

function Duration({ selected, onChange, rows = false }: { selected: number; onChange: (value: number) => void; rows?: boolean }) {
  const name = useId()
  return <fieldset className={`pwd-duration${rows ? ' pwd-duration--rows' : ''}`}><legend className="pwd-sr">Срок клубного билета</legend>
    {products.map((product, index) => <label className="pwd-period" data-selected={selected === index} key={product.id}>
      <input type="radio" name={name} value={product.id} checked={selected === index} onChange={() => onChange(index)} />
      {rows && <span className="pwd-radio" aria-hidden="true">{selected === index && <Check size={14} strokeWidth={3} />}</span>}
      <span className="pwd-period__name"><strong>{product.durationDays} дней</strong>{rows && <small>{index ? `Экономия ${money(pricing.annualSavingsMinor)}` : 'Все возможности Клуба'}</small>}</span>
      {rows ? <span className="pwd-period__price"><strong>{money(product.priceMinor)}</strong><small>{money(dailyPriceMinor(product), 2)} в день</small></span> : index === 1 && <span className="pwd-saving">−{pricing.annualDiscountPercent}%</span>}
    </label>)}
  </fieldset>
}

function CheckoutPreview({ selected }: { selected: number }) {
  const [accepted, setAccepted] = useState(false)
  const [renew, setRenew] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const product = products[selected]
  return <div className="pwd-checkout">
    <label className="pwd-consent"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>Принимаю <a href="/legal/terms" target="_blank" rel="noreferrer">оферту</a>, <a href="/legal/tariffs" target="_blank" rel="noreferrer">тариф</a> и <a href="/legal/refunds" target="_blank" rel="noreferrer">условия возврата</a></span></label>
    <label className="pwd-consent"><input type="checkbox" checked={renew} onChange={event => setRenew(event.target.checked)} /><span>Продлевать каждые {product.durationDays} дней за {money(product.priceMinor)}<small>Можно отключить в профиле до следующего списания</small></span></label>
    <ActionButton className="pwd-cta" disabled={!accepted} onClick={() => setSubmitted(true)}>Вступить в Клуб за {money(product.priceMinor)}<ArrowRight size={18} aria-hidden="true" /></ActionButton>
    {submitted && <p className="pwd-demo-message" role="status">Это макет билета на {product.durationDays} дней. Оплата не выполняется.</p>}
  </div>
}

function Ticket({ selected }: { selected: number }) {
  const product = products[selected]
  return <div className="pwd-ticket" aria-label={`Клубный билет на ${product.durationDays} дней за ${money(product.priceMinor)}`}>
    <div className="pwd-ticket__foil" aria-hidden="true" />
    <div className="pwd-ticket__main"><span className="pwd-ticket__label">Клубный билет</span><BrandWordmark variant="compact" /><p>Больше игры.<br />Больше открытий.</p><span className="pwd-ticket__seal"><Check size={13} /> Все возможности Клуба</span></div>
    <div className="pwd-ticket__stub"><strong className="pwd-ticket__days">{product.durationDays}</strong><span>дней в Клубе</span><i aria-hidden="true" /><strong className="pwd-ticket__price">{money(product.priceMinor)}</strong><small>{money(dailyPriceMinor(product), 2)} в день</small></div>
  </div>
}

function Offer({ direction }: { direction: Direction }) {
  const [selected, setSelected] = useState(0)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(!document.hidden)
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    if (root.current) observer.observe(root.current)
    const visibility = () => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  if (direction === 'b') return <section ref={root} className="pwd-offer pwd-live-offer"><StudyClubOffer pricing={pricing} selectedPlan={products[selected].id} onSelect={id => setSelected(id === pricing.annual.id ? 1 : 0)}><CheckoutPreview key={selected} selected={selected} /></StudyClubOffer></section>
  const product = products[selected]
  return <section ref={root} className={`pwd-offer pwd-offer--${direction}`} data-paused={paused || !visible || !documentVisible} aria-label="Выбор клубного билета">
    {direction === 'a' && <>
      <header className="pwd-heading"><span className="pwd-eyebrow">Клуб «Сходится!»</span><h1>Твой клубный<br />билет.</h1></header>
      <Ticket selected={selected} />
      <ul className="pwd-benefits">{benefits.map(label => <li key={label}><Check size={15} />{label}</li>)}</ul>
      <Duration selected={selected} onChange={setSelected} />
    </>}
    {direction === 'c' && <>
      <header className="pwd-heading"><span className="pwd-eyebrow">Один билет — больше возможностей</span><h1>Весь Клуб.<br /><em>В твоих руках.</em></h1></header>
      <div className="pwd-perks"><div><span><Glyph name="archive" size={64} /></span><strong>Весь архив</strong><small>Вернись к любой загадке</small></div><div><span><Glyph name="play" size={64} /></span><strong>Свободная игра</strong><small>Продолжай в своём ритме</small></div><div><span><img src={publicAssetUrl('images/home-doodle/movie.webp')} alt="" /></span><strong>Спецпоказы</strong><small>Открывай новые темы</small></div></div>
      <div className="pwd-purchase"><div className="pwd-purchase__top"><div className="pwd-purchase__price"><strong>{money(product.priceMinor)}</strong><span>за {product.durationDays} дней</span></div><Duration selected={selected} onChange={setSelected} /></div><p className="pwd-price-note">{money(dailyPriceMinor(product), 2)} в день{selected === 1 && <span>Экономия {money(pricing.annualSavingsMinor)}</span>}</p></div>
    </>}
    <CheckoutPreview key={selected} selected={selected} />
    <ControlButton className="pwd-motion" aria-label={paused ? 'Включить анимацию' : 'Остановить анимацию'} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? <Play size={13} /> : <Pause size={13} />}</ControlButton>
  </section>
}

function Context({ children }: { children: ReactNode }) {
  return <div className="pwd-site"><aside className="pwd-rail"><a href="/"><BrandWordmark /></a><nav aria-label="Навигация сайта">{([['play', 'Игры', '/'], ['lobby', 'Лобби', '/lobby'], ['league', 'Рейтинг', '/leaderboard'], ['quests', 'Задания', '/quests'], ['medal', 'Клуб', '/club'], ['profile', 'Профиль', '/profile'], ['archive', 'Архив', '/archive']] as const).map(([icon, label, href]) => <a key={label} href={href} aria-current={label === 'Клуб' ? 'page' : undefined}>{icon === 'lobby' ? <StudyLobbyIcon size={35} /> : icon === 'profile' ? <StudyProfileIcon size={35} /> : <Glyph name={icon} size={35} />}<span>{label}</span></a>)}</nav></aside><main className="pwd-center"><div className="pwd-context-label"><span>Клуб «Сходится!»</span><a href="/club/membership#club-offers">Текущий вариант <ArrowRight size={14} /></a></div>{children}<section className="pwd-after"><h2>Клубные спецпоказы</h2><p>Знакомые игры с особым настроением.</p><div><span><img src={publicAssetUrl('images/home-doodle/movie.webp')} alt="" /> Кино</span><span><img src={publicAssetUrl('images/home-doodle/game.webp')} alt="" /> Игры</span></div></section></main><aside className="pwd-aside"><div className="pwd-account"><Glyph name="flame" size={26} /><strong>5</strong><Glyph name="ticket" size={28} /><strong>248</strong><span>ПС</span></div><section><div className="pwd-aside-heading"><h2>Твоя серия</h2><Glyph name="flame" size={40} /></div><p className="pwd-streak"><strong>5</strong> дней подряд</p><p>Ещё одна разгадка поможет продолжить серию.</p><a href="/">Выбрать игру</a></section><section><div className="pwd-aside-heading"><h2>Собери компанию</h2><StudyLobbyIcon size={42} /></div><p>Пригласи друзей и сыграйте вместе.</p><a href="/lobby">В лобби</a></section><footer>Игры　Клуб　Блог　Помощь</footer></aside></div>
}

function Preview({ direction, dark }: { direction: typeof directions[number]; dark: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(400)
  const [height, setHeight] = useState(760)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    if (container.current) observer.observe(container.current)
    const message = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === container.current?.querySelector('iframe')?.contentWindow && event.data?.type === 'paywall-height') setHeight(event.data.height)
    }
    window.addEventListener('message', message)
    return () => { observer.disconnect(); window.removeEventListener('message', message) }
  }, [])
  return <article className="pwd-preview"><header><a href={variantHref(direction.id, dark)}><span>{direction.id.toUpperCase()}</span><h2>{direction.name}</h2><ArrowRight size={19} /></a><p>{direction.detail}</p></header><div className="pwd-preview__frame" ref={container} style={{ height: height * width / 640 }}><iframe title={`Вариант ${direction.id.toUpperCase()}: ${direction.name}`} src={`?view=${direction.id}&embed=1&tone=${dark ? 'dark' : 'light'}`} style={{ width: 640, height, transform: `scale(${width / 640})` }} /></div><footer><a href={variantHref(direction.id, dark)}>Посмотреть в интерфейсе <ArrowRight size={16} /></a><p><a href={direction.href} target="_blank" rel="noreferrer">{direction.reference}</a><span>{direction.principle}</span></p></footer></article>
}

function App() {
  const [dark, setDark] = useState(query.get('tone') === 'dark')
  useEffect(() => { document.documentElement.dataset.questTone = dark ? 'dark' : 'light' }, [dark])
  useEffect(() => {
    if (!embedded) return
    const observer = new ResizeObserver(() => parent.postMessage({ type: 'paywall-height', height: Math.ceil(document.body.getBoundingClientRect().height) }, location.origin))
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [])
  if (embedded && current) return <div className="pwd-embed"><Offer direction={current.id} /></div>
  return <div className="pwd-root"><div className="pwd-toolbar"><a href={variantHref(undefined, dark)}><ArrowLeft size={16} /> Все варианты</a><nav aria-label="Варианты пэйвола">{directions.map(item => <a href={variantHref(item.id, dark)} key={item.id} aria-current={item.id === current?.id ? 'page' : undefined}>{item.id.toUpperCase()}<span> {item.name}</span></a>)}</nav><ControlButton aria-label={dark ? 'Светлая тема макета' : 'Тёмная тема макета'} onClick={() => setDark(value => !value)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</ControlButton></div>{current ? <><div className="pwd-direction-caption"><strong>{current.id.toUpperCase()} / {current.name}</strong><span>Интерактивный макет, без оплаты</span></div><Context><Offer direction={current.id} /></Context></> : <main className="pwd-gallery"><header><span className="pwd-eyebrow">Сходится! / клубный билет</span><h1>Три разных характера.<br /><span>Один и тот же Клуб.</span></h1><p>Сравни композиции. Внутри работают выбор срока и анимации.<br />Каждый вариант можно открыть в интерфейсе сайта.</p></header><div className="pwd-preview-grid">{directions.map(direction => <Preview key={direction.id} direction={direction} dark={dark} />)}</div><p className="pwd-gallery-note">Макеты для выбора направления. Цены из модели Клуба, оплата не подключена.</p></main>}</div>
}

const root: Root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!)
if (import.meta.hot) import.meta.hot.data.root = root
root.render(<App />)

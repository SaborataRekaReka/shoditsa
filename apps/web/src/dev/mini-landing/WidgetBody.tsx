import { publicAssetUrl } from '../../app/public-asset'
import { useState } from 'react'
import { ArrowUp, ArrowUpDown, BookOpenText, CalendarDays, Check, Clapperboard, Cloud, Gauge, Laptop, Search, Smartphone, Tags, UserRound, UsersRound, X } from 'lucide-react'
import { GAME_RULES, GAME_SEO } from '../../app/seo-content'
import './widget-body.css'

const content = GAME_SEO.movie
const rules = GAME_RULES.movie
const comparisonIcons = [UsersRound, Tags, CalendarDays, Gauge] as const
const outcomes = [
  { title: 'Точно', field: 'Жанр', note: 'Значение совпало.', tone: 'exact', icon: Check },
  { title: 'Рядом', field: 'Год', note: 'Число близко или есть частичное совпадение.', tone: 'partial', icon: ArrowUp },
  { title: 'Мимо', field: 'Страна', note: 'Значение не совпало.', tone: 'miss', icon: X },
] as const

function SearchScene() {
  return <div className="sw-scene sw-search-scene" role="img" aria-label="Поле поиска и карточка выбранного фильма">
    <div className="sw-search-back"><Clapperboard size={15} strokeWidth={1.5} /><span>Кино</span><span className="sw-window-dots">…</span></div>
    <div className="sw-search-field"><Search size={16} strokeWidth={1.6} /><span>Название фильма</span><span className="sw-search-caret" /></div>
    <div className="sw-search-result"><span className="sw-film-square"><Clapperboard size={19} strokeWidth={1.5} /></span><div>Твоя версия<small>Фильм из каталога</small></div><span className="sw-check-circle"><Check size={13} strokeWidth={2} /></span></div>
  </div>
}

function ComparisonScene() {
  const [active, setActive] = useState(0)
  const selected = outcomes[active]
  return <div className="sw-scene sw-comparison-scene">
    <div className="sw-comparison-window">
      <div className="sw-comparison-topline"><span className="sw-mini-brand"><Clapperboard size={13} strokeWidth={1.5} />Твоя версия</span><span>Совпадения</span></div>
      <div className="sw-comparison-row" role="group" aria-label="Пример сравнительных подсказок">{outcomes.map((outcome, index) => <button type="button" key={outcome.tone} aria-pressed={active === index} className={`sw-outcome sw-outcome--${outcome.tone}`} onClick={() => setActive(index)}><span className="sw-outcome__field">{outcome.field}</span><span className="sw-outcome__icon"><outcome.icon size={20} strokeWidth={1.7} /></span><span>{outcome.title}</span></button>)}</div>
      <p className="sw-outcome-note" aria-live="polite"><span className={`sw-outcome-dot sw-outcome-dot--${selected.tone}`} />{selected.note}</p>
    </div>
  </div>
}

function AttemptsScene() {
  return <div className="sw-scene sw-attempts-scene" role="img" aria-label="Десять попыток и новая загадка каждый день">
    <div className="sw-attempt-meter"><div className="sw-meter-label"><span>Найти фильм</span><span><CalendarDays size={12} strokeWidth={1.6} />Каждый день</span></div><div className="sw-meter-number">10<span>попыток</span><span className="sw-meter-mark"><Clapperboard size={21} strokeWidth={1.4} /></span></div><div className="sw-meter-ticks">{Array.from({ length: 10 }, (_, index) => <i key={index} />)}</div></div>
  </div>
}

function HintScene() {
  return <div className="sw-scene sw-hint-scene"><span className="sw-hint-orbit" aria-hidden="true" /><img src={publicAssetUrl('images/mascot/scenes/clue-detective-v1.webp')} width="1254" height="1254" alt="Персонаж с лупой помогает разобраться в совпадениях" /></div>
}

function GuestScene() {
  return <div className="sw-scene sw-guest-scene" role="img" aria-label="Можно начать гостем; аккаунт помогает синхронизировать прогресс на разных устройствах">
    <div className="sw-guest-card"><span className="sw-guest-avatar"><UserRound size={20} strokeWidth={1.4} /></span><div>Гость</div></div>
    <div className="sw-sync-line"><span className="sw-device"><Laptop size={20} strokeWidth={1.5} aria-hidden="true" /></span><span className="sw-sync-dashes" /><span className="sw-cloud"><Cloud size={20} strokeWidth={1.5} aria-hidden="true" /></span><span className="sw-sync-dashes" /><span className="sw-device"><Smartphone size={20} strokeWidth={1.5} aria-hidden="true" /></span></div>
  </div>
}

export function WidgetBody() {
  return <><section className="stripe-widgets" id="mini-guide" aria-labelledby="mini-guide-title">
    <div className="mini-section-head"><h2 id="mini-guide-title">От первой версии до «сходится!»</h2></div>
    <div className="sw-grid">
      <article className="sw-card sw-card--search"><SearchScene /><div className="sw-card-copy"><h3>Начни с любого фильма</h3><p>{rules.searchInstruction}</p><p className="sw-small-note">{rules.modeNote}</p></div></article>
      <article className="sw-card sw-card--compare"><ComparisonScene /><div className="sw-card-copy sw-comparison-copy"><h3>Каждая версия открывает детали</h3><ul className="sw-features" aria-label="Что сравниваем">{content.features.map((feature, index) => {
        const Icon = comparisonIcons[index]
        return <li key={feature}><Icon size={16} strokeWidth={1.6} aria-hidden="true" /><span>{feature}</span></li>
      })}</ul><p className="sw-comparison-direction"><ArrowUpDown size={18} strokeWidth={1.7} aria-hidden="true" /><span>{rules.directionInstruction}</span></p></div></article>
      <article className="sw-card sw-card--attempts"><AttemptsScene /><div className="sw-card-copy"><h3>{content.faq[0].question}</h3><p>{content.faq[0].answer}</p><p className="sw-daily-copy">{content.paragraphs[1]}</p></div></article>
      <article className="sw-card sw-card--hints"><HintScene /><div className="sw-card-copy"><h3>Когда нужна свежая идея</h3><p>Перед пятой и восьмой попытками можно открыть по одной из трёх дополнительных подсказок.</p></div></article>
      <article className="sw-card sw-card--guest"><GuestScene /><div className="sw-card-copy"><h3>{content.faq[1].question}</h3><p>{content.faq[1].answer}</p></div></article>
    </div>
  </section>
  <aside id="mini-about" className="mini-reference" aria-labelledby="mini-reference-title">
    <div className="mini-reference__copy"><div className="mini-reference__label"><BookOpenText size={16} strokeWidth={1.6} aria-hidden="true" />Справка</div><h2 id="mini-reference-title">{content.heading}</h2><p>{content.paragraphs[0]}</p><p>{content.collectionMethod.text}</p></div>
    <img className="mini-reference__art" src={publicAssetUrl('images/mascot/scenes/cinema-projection-v1.webp')} width="1254" height="1254" alt="Персонаж с проектором готовится к киносеансу" />
  </aside></>
}

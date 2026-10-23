import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, ArrowUpRight, Check, Layers, Search } from 'lucide-react'
import { BrandWordmark } from '../../components/app-shell/BrandWordmark'
import { ActionLink } from '../../components/ui/UiControls'
import { Tabs } from '../../components/ui/Tabs'
import { MobileGame } from './MobileGame'
import '../../styles/reference-tokens.css'
import './research.css'

const sources = {
  duo: 'https://blog.duolingo.com/core-tabs-redesign/',
  nyt: 'https://apps.apple.com/us/app/nyt-games-wordle-crossword/id307569751',
  search: 'https://developer.apple.com/design/human-interface-guidelines/search-fields',
  sheets: 'https://developer.apple.com/design/human-interface-guidelines/sheets',
}
const images = {
  duo: 'https://storage.ghost.io/c/7a/33/7a33d0f4-927d-4fe8-a6bf-96131b5e76d4/content/images/2026/01/11.-Caption.-Cleaned-up-visual-spacing-1.png',
  nyt: 'https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/ad/0f/e3/ad0fe3bc-d248-3dad-2315-eda6c0a1875f/TheNewYorkTimes_NYTGames_US_iOS_6.9_ScreenshotMockups_250703_V2_02.png/600x1300bb.webp',
}

function Research() {
  const [view, setView] = useState<'game' | 'search' | 'matches'>('game')
  const previewWidth = new URLSearchParams(location.search).get('width') === '319' ? 319 : 390
  return <div className="mobile-research">
    <header className="mobile-research__bar"><BrandWordmark /><span>Исследование интерфейса · 19.10.2026</span></header>
    <main>
      <section className="mobile-research__direction">
        <div className="mobile-research__proposal">
          <span className="mobile-research__eyebrow">Новое направление</span>
          <h1>Игра, которая<br />живёт в телефоне.</h1>
          <p className="mobile-research__lead">Последний ответ — в центре. Следующая версия — под большим пальцем. Всё, что узнал, остаётся рядом.</p>
          <div className="mobile-research__principles">
            <div><span><Check size={19} /></span><div><h2>Один ответ за раз</h2><p>Постер, название и пять главных признаков. Остальные сравнения раскрываются по нажатию.</p></div></div>
            <div><span><Search size={19} /></span><div><h2>Ввод открывается снизу</h2><p>Поиск, выбор и проверка — в отдельном слое. После ответа возвращаемся прямо в игру.</p></div></div>
            <div><span><Layers size={19} /></span><div><h2>История не теряется</h2><p>Можно вернуться к любой версии или посмотреть все найденные совпадения.</p></div></div>
          </div>
          <div className="mobile-research__links"><ActionLink href="mobile-game-direction.html?app=1">Открыть прототип<ArrowUpRight size={18} /></ActionLink><ActionLink variant="ghost" href="mobile-game-direction.html?app=1&empty=1">Начать с первого экрана<ArrowRight size={17} /></ActionLink></div>
          <p className="mobile-research__note">Интерактивный макет на примере аниме. Поиск работает на восьми демонстрационных тайтлах; ежедневная игра и её прогресс не затрагиваются.</p>
        </div>
        <div className="mobile-research__preview" style={{ width: previewWidth }}>
          <Tabs label="Состояние прототипа" surface="paper" value={view} onChange={setView} items={[{ id: 'game', label: 'Игра' }, { id: 'search', label: 'Поиск' }, { id: 'matches', label: 'Совпадения' }]} />
          <iframe key={view} title="Интерактивный мобильный прототип" src={`mobile-game-direction.html?app=1${view === 'game' ? '' : `&panel=${view}`}`} />
          <small>{previewWidth} px · можно нажимать и проверять версии</small>
        </div>
      </section>
      <section className="mobile-research__references">
        <div className="mobile-research__section-head"><span className="mobile-research__eyebrow">На что опираемся</span><h2>Три референса. Три конкретные задачи.</h2><p>Это разбор приёмов для «Сходится!». Иллюстрации ниже принадлежат авторам приложений.</p></div>
        <div className="mobile-research__reference-grid">
          <article className="mobile-research__reference mobile-research__reference--nyt"><div className="mobile-research__image"><img src={images.nyt} loading="lazy" alt="Официальный скриншот NYT Games: Wordle, игровое поле и клавиатура" /></div><div><span>01 · Фокус на игре</span><h3>NYT Games</h3><p>На скриншоте Wordle основное место занимает поле, а действия находятся снизу. Переносим этот принцип на текущую попытку и ввод ответа.</p><a href={sources.nyt} target="_blank" rel="noreferrer">Официальные экраны в App Store<ArrowUpRight size={15} /></a></div></article>
          <article className="mobile-research__reference mobile-research__reference--duo"><div className="mobile-research__image"><img src={images.duo} loading="lazy" alt="Официальное сравнение экрана Duolingo до и после упрощения визуальной иерархии" /></div><div><span>02 · Ясная иерархия</span><h3>Duolingo</h3><p>В разборе редизайна команда показывает, как упрощала шапки, отступы и рамки. Для нас это компактная навигация, ясный текст и персонаж с конкретной ролью.</p><a href={sources.duo} target="_blank" rel="noreferrer">Разбор команды Duolingo<ArrowUpRight size={15} /></a></div></article>
          <article className="mobile-research__reference mobile-research__reference--apple"><div className="mobile-research__sheet-diagram" aria-hidden="true"><span>Игра</span><div><i /><Search size={22} /><strong>Следующая версия</strong><span>Выбрать → проверить → вернуться</span></div></div><div><span>03 · Действие в контексте</span><h3>Apple HIG</h3><p>Рекомендации по поиску и нижним панелям помогают вынести короткую задачу в отдельный слой. В прототипе так открываются ввод, история и совпадения.</p><a href={sources.search} target="_blank" rel="noreferrer">Search fields<ArrowUpRight size={15} /></a><a href={sources.sheets} target="_blank" rel="noreferrer">Sheets<ArrowUpRight size={15} /></a></div></article>
        </div>
      </section>
    </main>
  </div>
}

const appOnly = new URLSearchParams(location.search).has('app')
document.body.classList.toggle('mobile-app-page', appOnly)
const root = createRoot(document.getElementById('root')!)
root.render(appOnly ? <MobileGame /> : <Research />)
import.meta.hot?.dispose(() => root.unmount())

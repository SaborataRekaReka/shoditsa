import { useLayoutEffect, type ReactNode } from 'react'
import { BookOpen } from 'lucide-react'
import type { GameControllerSnapshot, GamePageNavigation } from '../../components/game-shell/GamePageFrame'
import { ReferenceMatchSymbol } from '../../features/game/ReferenceMatchSymbol'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { GeneratedShoditsaGlyph as Glyph } from './GeneratedShoditsaArt'
import { StudySidebar } from './StudySidebar'
import { StudyHeader } from './StudyHeader'
import { StudyRightSidebar } from './StudyRightSidebar'
import { StudyFooter } from './StudyTheme'
import { STUDY_HOME_VARIANT_KEY, studyHomeHref } from './home-route'
import '../../styles/quest-study-tokens.css'
import '../../styles/shoditsa-study-tokens.css'
import './quest-game.css'
import './shoditsa-game.css'
import './study-session.css'
import '../../features/game-session/AttemptCards.application.css'

export default function StudySessionFrame({ controller, navigation, children }: { controller: GameControllerSnapshot; navigation: GamePageNavigation; children: ReactNode }) {
  const home = (() => { try { return studyHomeHref(sessionStorage.getItem(STUDY_HOME_VARIANT_KEY), true) ?? '/' } catch { return '/' } })()
  useLayoutEffect(() => {
    const root = document.documentElement
    const previous = { localStudy: root.dataset.localStudy, questSkin: root.dataset.questSkin }
    root.dataset.localStudy = 'session'
    root.dataset.questSkin = 'shoditsa'
    return () => {
      if (previous.localStudy) root.dataset.localStudy = previous.localStudy; else delete root.dataset.localStudy
      if (previous.questSkin) root.dataset.questSkin = previous.questSkin; else delete root.dataset.questSkin
    }
  }, [])
  return <div className="qg-app study-session" data-public-theme="quest-study" data-quest-skin="shoditsa">
    <a className="study-session-skip" href="#study-session-main">Перейти к игре</a>
    <StudySidebar view="play" shoditsa refreshKey={`${controller.mode}:${controller.status}:${controller.attemptsCount}`} homeHref={home} Glyph={Glyph} />
    <div className="qg-layout study-layout">
      <StudyHeader Glyph={Glyph} refreshKey={`${controller.mode}:${controller.status}:${controller.attemptsCount}`} />
      <main id="study-session-main" className="qg-main reference-play-main study-session-main" data-controller={controller.source} data-game-mode={controller.mode} data-game-status={controller.status} data-attempts={controller.attemptsCount} tabIndex={-1}>
        {children}
      </main>
      <StudyRightSidebar className="study-session-aside" label="Прогресс и помощь" gamesFirst refreshKey={`${controller.mode}:${controller.status}:${controller.attemptsCount}`}>
        <section className="qg-card study-session-help"><div className="qg-side-head"><h2>Читай подсказки</h2></div>
          <ul>
            <li><span className="study-match study-match--exact"><ReferenceMatchSymbol kind="match" /></span><span><strong>Совпало</strong><small>Признак подходит ответу</small></span></li>
            <li><span className="study-match study-match--partial"><ReferenceMatchSymbol kind="partial" /></span><span><strong>Есть общее</strong><small>Часть совпала или число близко</small></span></li>
            <li><span className="study-match study-match--miss"><ReferenceMatchSymbol kind="miss" /></span><span><strong>Не совпало</strong><small>Ищем дальше</small></span></li>
            <li><span className="study-match-directions"><span className="study-match study-match--direction"><ReferenceMatchSymbol kind="up" /></span><span className="study-match study-match--direction"><ReferenceMatchSymbol kind="down" /></span></span><span><strong>Больше или меньше</strong><small>Стрелка ведёт к верному значению</small></span></li>
          </ul>
          <QuestButton kind="outline" onClick={navigation.onRules}><BookOpen size={18} />Правила игры</QuestButton>
        </section>
        <StudyFooter><a href={home}>Игры</a><a href={`/games/${controller.mode}`}>Об игре</a><span>Локальный просмотр</span></StudyFooter>
      </StudyRightSidebar>
    </div>
  </div>
}

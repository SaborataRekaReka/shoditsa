import type { StudyView } from './navigation'
import { StudyAccountWidget, StudyStreakWidget, StudyTasksWidget } from './StudySidebarWidgets'

type Props = {
  view: StudyView
  homeHref: string
  goalsDone: number
  factsFound: number
  onContinue: () => void
}

const sectionLabels: Partial<Record<StudyView, string>> = {
  archive: 'Продолжение игр и сохранение истории',
  league: 'Серия дней и аккаунт игрока',
  quests: 'Прогресс заданий и аккаунт',
  profile: 'Аккаунт и сегодняшние игры',
}
export const studyAsideLabel = (view: StudyView) => sectionLabels[view] ?? 'Прогресс и помощь'

/** Each application section has its own widgets; game hints stay on the game. */
export function StudySectionAside({ view, homeHref, goalsDone }: Props) {
  return <>
    {view === 'archive' ? <>
      <StudyAccountWidget />
    </> : view === 'league' ? <><StudyStreakWidget homeHref={homeHref} /><StudyAccountWidget /></> : view === 'quests' ? <>
      <StudyTasksWidget goalsDone={goalsDone} />
      <StudyAccountWidget />
    </> : <>
      <StudyAccountWidget />
    </>}
  </>
}

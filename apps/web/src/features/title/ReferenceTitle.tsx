import type { ReactNode } from 'react'
import type { TitleMode } from '../../types'
import { QuestTitleLayout } from '../../dev/quest-game/QuestTitleLayout'

/** Production uses the current application title, with real server launch controls. */
export function ReferenceTitle({ mode, date, launchControls, extra }: {
  mode: TitleMode
  date: string
  dayNumber: number
  launchControls: ReactNode
  details: ReactNode
  extra?: ReactNode
  onRules: () => void
}) {
  return <QuestTitleLayout mode={mode} date={date} showBackline={false} extra={extra}><div className="qt-connected-launch">{launchControls}</div></QuestTitleLayout>
}

export function ReferencePuzzleTitle({ mode, date, launchControls, extra }: {
  mode: 'danetki' | 'connections'
  date: string
  launchControls: ReactNode
  details: ReactNode
  extra?: ReactNode
  onRules: () => void
}) {
  return <QuestTitleLayout mode={mode} date={date} showBackline={false} extra={extra}><div className="qt-connected-launch">{launchControls}</div></QuestTitleLayout>
}

import type { ReactNode } from 'react'
import { BookOpen } from 'lucide-react'
import { APPLICATION_DESIGN } from '../../app/application-design'
import { ApplicationFrame } from '../application/ApplicationFrame'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import './EngineSessionFrame.css'

/** Non-catalog engines keep their controllers inside the same product chrome. */
export function EngineSessionFrame({ mode, onRules, children }: { mode?: 'connections' | 'danetki'; onRules: () => void; children: ReactNode }) {
  if (!APPLICATION_DESIGN) return children
  const connections = mode === 'connections'
  const guide = mode && <section className="qg-card engine-session-guide">
    <div className="qg-side-head"><h2>{connections ? 'Найди общее' : 'Раскрой историю'}</h2><BookOpen size={25} aria-hidden="true" /></div>
    <ol>{(connections ? [
      'Выбери четыре слова с одной общей связью.',
      'Проверь группу. Верная четвёрка останется на поле.',
      'Собери четыре группы. Четвёртая ошибка завершит раунд.',
    ] : [
      'Прочитай ситуацию и задай вопрос ведущему.',
      'Спроси так, чтобы ответом было «да» или «нет».',
      'Когда всё сойдётся, предложи разгадку.',
    ]).map(step => <li key={step}>{step}</li>)}</ol>
    <QuestButton kind="outline" onClick={onRules}>Правила игры</QuestButton>
  </section>
  return <ApplicationFrame pathname={typeof window === 'undefined' ? '/sessions' : window.location.pathname} aside={guide || undefined}>{children}</ApplicationFrame>
}

import type { ReactNode } from 'react'
import { BookOpen } from 'lucide-react'
import { APPLICATION_DESIGN } from '../../app/application-design'
import { ApplicationFrame } from '../application/ApplicationFrame'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import './EngineSessionFrame.css'

/** Non-catalog engines keep their controllers inside the same product chrome. */
export function EngineSessionFrame({ mode, onRules, children }: { mode?: 'connections' | 'danetki' | 'word'; onRules: () => void; children: ReactNode }) {
  if (!APPLICATION_DESIGN) return children
  const connections = mode === 'connections'
  const guide = mode && <section className="qg-card engine-session-guide">
    <div className="qg-side-head"><h2>{mode === 'word' ? 'Найди слово по смыслу' : connections ? 'Найди общее' : 'Раскрой историю'}</h2><BookOpen size={25} aria-hidden="true" /></div>
    <ol>{(mode === 'word' ? ['Введи русское слово и узнай его ранг.', 'Меньше номер — ближе ответ. Твоя цель — № 1.', 'Пробуй ассоциации. Количество попыток не ограничено.'] : connections ? [
      'Выбери четыре слова с одной общей связью.',
      'Проверь группу. Верная четвёрка останется на поле.',
      'Собери четыре группы. Четвёртая ошибка завершит раунд.',
    ] : [
      'Прочитай ситуацию и задай вопрос ведущему.',
      'Спроси так, чтобы ответом было «да» или «нет».',
      'Когда всё сойдётся, предложи разгадку.',
    ]).map(step => <li key={step}>{step}</li>)}</ol>
    <QuestButton kind="outline" onClick={() => {
      if (mode !== 'word') { onRules(); return }
      const rules = document.querySelector<HTMLDetailsElement>('.word-rules')
      if (rules) { rules.open = true; rules.scrollIntoView({ block: 'start' }); rules.querySelector('summary')?.focus() }
    }}>Правила игры</QuestButton>
  </section>
  return <ApplicationFrame pathname={typeof window === 'undefined' ? '/sessions' : window.location.pathname} aside={guide || undefined}>{children}</ApplicationFrame>
}

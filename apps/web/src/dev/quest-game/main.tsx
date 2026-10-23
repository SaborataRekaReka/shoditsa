import { createRoot } from 'react-dom/client'
import { canonicalApplicationHref } from '../../features/application/routes'

if (document.documentElement.dataset.questSkin === 'shoditsa') {
  const canonical = canonicalApplicationHref(window.location)
  if (canonical) history.replaceState(history.state, '', canonical)
  await import('../../main')
} else {
  const { default: StudyApp } = await import('./StudyApp')
  const root = createRoot(document.getElementById('root')!)
  root.render(<StudyApp />)
  import.meta.hot?.dispose(() => root.unmount())
}

import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SvoyakPage } from '../../features/svoyak/SvoyakPage'
import { AppErrorBoundary } from '../../components/app-shell/AppErrorBoundary'
import '../../styles/quest-study-tokens.css'
import '../../styles/reference-tokens.css'
import '../../styles/shoditsa-study-tokens.css'
import '../quest-game/quest-game.css'
import '../quest-game/shoditsa-game.css'
import '../quest-game/quest-title.css'
import '../quest-home/home-variants.css'
import '../../features/svoyak/svoyak-game.css'

const root = createRoot(document.getElementById('root')!)
const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })
let page = <SvoyakPage />
if (new URLSearchParams(location.search).get('demo') === 'board') {
  const { SvoyakPreview } = await import('./SvoyakPreview')
  page = <SvoyakPreview />
}
root.render(<AppErrorBoundary><QueryClientProvider client={client}>{page}</QueryClientProvider></AppErrorBoundary>)
import.meta.hot?.dispose(() => root.unmount())

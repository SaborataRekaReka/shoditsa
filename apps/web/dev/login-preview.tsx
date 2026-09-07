// Development-only UI fixture. Never calls authentication, sends email, or creates accounts.
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LoginScreen } from '../src/features/auth/LoginScreen'
import '../src/styles.css'

const params = new URLSearchParams(window.location.search)
const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
client.setQueryData(['me'], { user: { id: 'visual-guest', isAnonymous: true, role: 'player' }, auth: { providers: [], hasPassword: false } })
client.setQueryData(['meta'], { auth: { emailPassword: params.get('email') !== 'no', yandex: params.get('yandex') !== 'no', passwordReset: true }, growth: { registration: false } })
client.setQueryData(['dashboard'], {})
let blockedRequests = 0
const fetchAsset = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (url.includes('/api/')) {
    blockedRequests++
    const counter = document.querySelector('[data-preview-requests]')
    if (counter) counter.textContent = `Заблокировано запросов: ${blockedRequests}`
    await new Promise((resolve) => setTimeout(resolve, 600))
    return new Response(JSON.stringify({ error: { code: 'PREVIEW_ONLY', message: 'Проверка интерфейса: запрос не отправлен на сервер.' } }), { status: 503, headers: { 'content-type': 'application/json' } })
  }
  return fetchAsset(input, init)
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}>
  <aside style={{ padding: '10px 18px', background: '#f1ecdf', color: '#171c18', fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
    <span>Только проверка интерфейса</span><span data-preview-requests>Заблокировано запросов: 0</span>
    <a href="./login-preview.html">Вход</a><a href="./login-preview.html?mode=register">Регистрация</a><a href="./login-preview.html?token=visual-preview-only">Новый пароль</a><a href="./login-preview.html?yandex=no">Только почта</a><a href="./login-preview.html?email=no">Только Яндекс</a>
  </aside>
  <LoginScreen mode={params.get('mode') === 'register' ? 'register' : 'login'} />
</QueryClientProvider>)

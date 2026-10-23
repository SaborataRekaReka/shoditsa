import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApplicationAuthPage } from '../../features/auth/ApplicationAuthPage'
import { CookieConsentBanner } from '../../features/legal/CookieConsentBanner'
import '../../styles/quest-study-tokens.css'
import '../../styles/reference-tokens.css'
import '../../styles/shoditsa-study-tokens.css'
import './study-auth.css'

const params = new URLSearchParams(window.location.search)
const admin = window.location.pathname.startsWith('/admin') || params.get('screen') === 'admin'
const mode = window.location.pathname === '/register' || params.get('screen') === 'register' ? 'register' : 'login'
const client = new QueryClient()
document.title = `${admin ? 'Вход в админ-панель' : mode === 'register' ? 'Создать аккаунт' : 'Войти в аккаунт'} — Сходится!`

createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}>
  <ApplicationAuthPage mode={mode} admin={admin} />
  <CookieConsentBanner />
</QueryClientProvider>)

import { useLayoutEffect } from 'react'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { LoginScreen } from './LoginScreen'
import { StudyBrandLogo } from '../../dev/quest-game/StudyBrandLogo'
import { studyAccountHref, studyReturnUrl } from '../../dev/quest-game/account-routing'
import { useStudyTheme } from '../../dev/quest-game/StudyTheme'
import { applyApplicationPresentation } from '../../app/local-presentation'
import '../../styles/quest-study-tokens.css'
import '../../styles/shoditsa-study-tokens.css'
import '../../dev/quest-game/study-auth.css'

/** The same account layout in the local preview and the released application. */
export function ApplicationAuthPage({ mode, admin = false }: { mode: 'login' | 'register'; admin?: boolean }) {
  useStudyTheme()
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
  const returnUrl = studyReturnUrl(params.get(admin ? 'from' : 'returnUrl'), typeof window === 'undefined' ? 'https://shoditsa.ru' : window.location.origin)
  useLayoutEffect(() => {
    document.documentElement.dataset.questSkin = 'shoditsa'
    applyApplicationPresentation()
  }, [])
  return <div className="study-auth-page">
    <header className="study-auth-header" id="study-screen-ready">
      <a className="study-auth-back" href={returnUrl} aria-label="Вернуться к игре"><ArrowLeft size={23} /></a>
      <a className="study-auth-wordmark" href="/" aria-label="Сходится! — на главную"><StudyBrandLogo /></a>
      {admin ? <span className="study-auth-admin"><ShieldCheck size={20} /><span>Админ-панель</span></span> : <a className="study-auth-switch" href={studyAccountHref(mode === 'register' ? 'login' : 'register', returnUrl)}>{mode === 'register' ? 'Войти' : 'Создать аккаунт'}</a>}
    </header>
    <LoginScreen mode={mode} initialForgot={params.get('flow') === 'forgot'} presentation="study" admin={admin} backHref={returnUrl} returnTo={admin ? '/admin' : returnUrl} />
  </div>
}

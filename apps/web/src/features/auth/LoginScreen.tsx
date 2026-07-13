import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Eye, EyeOff, LoaderCircle, Mail, Target, Ticket } from 'lucide-react'
import { trackMetrikaGoal } from '../../app/metrics'
import { ApiClientError, api } from '../../api/client'
import { BrandLogo } from '../../components/app-shell/AppShell'
import { SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'
import { notifyAuthSessionChanged } from './use-auth-session'

type AuthPageMode = 'login' | 'register'

type LoginScreenProps = {
  mode?: AuthPageMode
}

type FieldErrors = {
  name: string
  email: string
  password: string
}

const emptyFieldErrors: FieldErrors = { name: '', email: '', password: '' }
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const authErrorMessage = (error: unknown) => {
  if (error instanceof ApiClientError) {
    if (error.code === 'NETWORK_TIMEOUT') return 'Сервер отвечает слишком долго. Попробуйте еще раз.'
    if (error.code === 'INVALID_EMAIL_OR_PASSWORD') return 'Неверный email или пароль.'
    if (error.code === 'EMAIL_NOT_VERIFIED') return 'Сначала подтвердите email по ссылке из письма.'
    if (error.code === 'USER_ALREADY_EXISTS') return 'Пользователь с таким email уже существует.'
    if (error.code === 'AUTH_EMAIL_DISABLED') return 'Вход по email сейчас временно отключен на этом окружении.'
    if (error.code === 'RESET_PASSWORD_DISABLED' || /reset password isn't enabled/i.test(error.message)) {
      return 'Восстановление пароля пока не настроено на сервере.'
    }
    if (error.code === 'INVALID_TOKEN') return 'Ссылка для сброса устарела или недействительна.'
    if (error.code === 'PASSWORD_TOO_SHORT') return 'Пароль слишком короткий. Минимум 10 символов.'
    if (error.code === 'PASSWORD_TOO_LONG') return 'Пароль слишком длинный.'
    if (error.code === 'PROVIDER_CONFIG_NOT_FOUND' || /provider_config_not_found/i.test(error.message)) {
      return 'Вход через Яндекс пока не настроен на сервере.'
    }
    if (error.message === 'Invalid email or password') return 'Неверный email или пароль.'
    if (error.status >= 500) return 'Сервис авторизации временно недоступен. Попробуйте позже.'
    return error.message || 'Не удалось выполнить запрос.'
  }
  return error instanceof Error ? error.message : 'Не удалось выполнить запрос.'
}

const safeLocalUrl = (value: string | null | undefined) => {
  if (!value || typeof window === 'undefined') return '/'
  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return '/'
    return `${url.pathname}${url.search}${url.hash}` || '/'
  } catch {
    return value.startsWith('/') && !value.startsWith('//') ? value : '/'
  }
}

const currentReturnUrl = () => {
  if (typeof window === 'undefined') return '/'
  const queryValue = new URLSearchParams(window.location.search).get('returnUrl')
  const storedValue = window.sessionStorage.getItem('shoditsa:return-url')
  return safeLocalUrl(queryValue || storedValue)
}

const authHref = (pathname: '/login' | '/register', returnUrl: string) => {
  const query = returnUrl !== '/' ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''
  return `${pathname}${query}`
}

const removeResetTokenFromAddress = () => {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  if (!params.has('token')) return
  params.delete('token')
  const query = params.toString()
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
}

export function LoginScreen({ mode = 'login' }: LoginScreenProps) {
  const serverRuntime = useServerRuntime()
  const [register, setRegister] = useState(mode === 'register')
  const [forgotMode, setForgotMode] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetToken, setResetToken] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('token')?.trim() || '')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(emptyFieldErrors)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)

  const returnUrl = useMemo(() => currentReturnUrl(), [])
  const resetMode = Boolean(resetToken) && !register
  const authCapabilities = serverRuntime.meta?.auth
  const emailAuthEnabled = authCapabilities?.emailPassword ?? SERVER_RUNTIME
  const passwordResetEnabled = authCapabilities?.passwordReset ?? SERVER_RUNTIME
  const yandexAuthEnabled = Boolean(authCapabilities?.yandex)

  useEffect(() => {
    document.body.dataset.authScreen = 'login'
    const queryReturnUrl = new URLSearchParams(window.location.search).get('returnUrl')
    if (queryReturnUrl) window.sessionStorage.setItem('shoditsa:return-url', safeLocalUrl(queryReturnUrl))
    return () => { delete document.body.dataset.authScreen }
  }, [])

  useEffect(() => {
    if (!serverRuntime.me?.user || serverRuntime.me.user.isAnonymous) return
    window.location.replace(currentReturnUrl())
  }, [serverRuntime.me])

  const clearMessages = () => {
    setError('')
    setNotice('')
  }

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((current) => current[field] ? { ...current, [field]: '' } : current)
    setError('')
  }

  const validateEmail = () => {
    if (!email.trim()) return 'Введите email.'
    if (!emailPattern.test(email.trim())) return 'Проверьте формат email.'
    return ''
  }

  const validateForm = () => {
    const nextErrors: FieldErrors = { ...emptyFieldErrors }
    if (register && !name.trim()) nextErrors.name = 'Укажите имя.'
    nextErrors.email = validateEmail()
    if (!password) nextErrors.password = 'Введите пароль.'
    else if (register && password.length < 10) nextErrors.password = 'Минимум 10 символов.'
    setFieldErrors(nextErrors)
    return !Object.values(nextErrors).some(Boolean)
  }

  const redirectAfterAuth = () => {
    setNotice('Вход выполнен. Возвращаемся к игре…')
    window.sessionStorage.removeItem('shoditsa:return-url')
    window.setTimeout(() => window.location.replace(returnUrl), 280)
  }

  const submitResetPassword = async () => {
    if (pending) return
    const nextErrors: FieldErrors = { ...emptyFieldErrors }
    if (!password) nextErrors.password = 'Введите новый пароль.'
    else if (password.length < 10) nextErrors.password = 'Минимум 10 символов.'
    setFieldErrors(nextErrors)
    if (nextErrors.password) return

    clearMessages()
    setPending(true)
    try {
      await api.resetPassword(resetToken, password)
      trackMetrikaGoal('auth_success', { action: 'reset_password' })
      setPassword('')
      setResetToken('')
      removeResetTokenFromAddress()
      setNotice('Пароль обновлен. Теперь войдите с новым паролем.')
    } catch (value) {
      trackMetrikaGoal('auth_error', { action: 'reset_password' })
      setError(authErrorMessage(value))
    } finally {
      setPending(false)
    }
  }

  const requestPasswordReset = async () => {
    if (pending) return
    const emailError = validateEmail()
    setFieldErrors({ ...emptyFieldErrors, email: emailError })
    if (emailError) return

    clearMessages()
    setPending(true)
    try {
      const redirect = new URL('/login', window.location.origin)
      if (returnUrl !== '/') redirect.searchParams.set('returnUrl', returnUrl)
      await api.requestPasswordReset(email.trim(), redirect.toString())
      trackMetrikaGoal('auth_success', { action: 'request_password_reset' })
      setForgotMode(false)
      setNotice('Письмо со ссылкой для восстановления отправлено. Проверьте почту.')
    } catch (value) {
      trackMetrikaGoal('auth_error', { action: 'request_password_reset' })
      setError(authErrorMessage(value))
    } finally {
      setPending(false)
    }
  }

  const submitEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    if (resetMode) {
      await submitResetPassword()
      return
    }
    if (forgotMode) {
      await requestPasswordReset()
      return
    }
    if (!validateForm()) return

    clearMessages()
    setPending(true)
    try {
      const registrationCallback = new URL(window.location.pathname, window.location.origin)
      if (returnUrl !== '/') registrationCallback.searchParams.set('returnUrl', returnUrl)
      const authResult = register
        ? await api.signUp(name.trim(), email.trim(), password, registrationCallback.toString())
        : await api.signIn(email.trim(), password)

      if (register && !authResult.token) {
        trackMetrikaGoal('auth_success', { action: 'sign_up_pending_verification' })
        setPassword('')
        setRegister(false)
        setNotice(`Аккаунт создан. Подтвердите ${email.trim()} по ссылке из письма.`)
        return
      }
      if (!authResult.token) throw new Error('Сервер не создал пользовательскую сессию. Попробуйте войти еще раз.')
      trackMetrikaGoal('auth_success', { action: register ? 'sign_up' : 'sign_in' })
      notifyAuthSessionChanged()
      redirectAfterAuth()
    } catch (value) {
      trackMetrikaGoal('auth_error', { action: register ? 'sign_up' : 'sign_in' })
      setError(authErrorMessage(value))
    } finally {
      setPending(false)
    }
  }

  const signInWithYandex = async () => {
    if (pending) return
    clearMessages()
    setPending(true)
    let redirected = false
    try {
      const payload = await api.signInYandex(window.location.href)
      const oauthUrl = typeof payload?.url === 'string' ? payload.url : ''
      if (!oauthUrl) throw new Error('Сервис Яндекс не вернул ссылку для входа.')
      trackMetrikaGoal('auth_oauth_start', { provider: 'yandex' })
      redirected = true
      window.location.assign(oauthUrl)
    } catch (value) {
      trackMetrikaGoal('auth_error', { action: 'oauth_yandex' })
      setError(value instanceof ApiClientError && value.status === 404
        ? 'Вход через Яндекс пока не настроен на сервере.'
        : authErrorMessage(value))
    } finally {
      if (!redirected) setPending(false)
    }
  }

  const switchMode = (nextRegister: boolean) => {
    setRegister(nextRegister)
    setForgotMode(false)
    setResetToken('')
    setFieldErrors(emptyFieldErrors)
    clearMessages()
    removeResetTokenFromAddress()
  }

  const title = resetMode ? 'ВОССТАНОВИТЕ ДОСТУП' : register ? 'СОЗДАЙТЕ АККАУНТ' : 'С ВОЗВРАЩЕНИЕМ!'
  const description = resetMode
    ? 'Задайте новый пароль, чтобы вернуться к своим играм, билетам и статистике.'
    : register
      ? 'Закрепите серию, билеты и статистику за своим аккаунтом.'
      : 'Войдите, чтобы продолжить серию, копить билеты и видеть свою статистику.'
  const submitLabel = resetMode ? 'СОХРАНИТЬ ПАРОЛЬ' : register ? 'СОЗДАТЬ АККАУНТ' : 'ВОЙТИ'
  const statusMessage = notice || error

  return <div className="login-page">
    <header className="login-header">
      <div className="login-header__inner">
        <a className="login-brand" href="/" aria-label="Сходится! — на главную"><BrandLogo /></a>
        <a className="login-back" href="/">
          <ArrowLeft aria-hidden="true" />
          <span>Вернуться к играм</span>
        </a>
      </div>
    </header>

    <main className="login-main">
      <section className="login-hero" aria-labelledby="login-title">
        <div className="login-form-column">
          <div className="login-form-wrap">
            <div className="login-badges" aria-label="Возможности аккаунта">
              <span><Ticket aria-hidden="true" /> 6 ИГР</span>
              <span><Target aria-hidden="true" /> 10 ПОПЫТОК</span>
            </div>

            <h1 id="login-title">{title}</h1>
            <p className="login-description">{description}</p>

            {serverRuntime.loading
              ? <div className="login-session-loading" role="status" aria-live="polite"><LoaderCircle className="login-spinner" /> Проверяем сессию…</div>
              : <form className="login-form" onSubmit={submitEmail} noValidate>
                {register && !resetMode && <div className="login-field">
                  <label htmlFor="login-name">Имя</label>
                  <input id="login-name" value={name} onChange={(event) => { setName(event.target.value); clearFieldError('name') }} autoComplete="name" aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'login-name-error' : undefined} />
                  {fieldErrors.name && <small id="login-name-error" className="login-field-error">{fieldErrors.name}</small>}
                </div>}

                {!resetMode && <div className="login-field">
                  <label htmlFor="login-email">Email</label>
                  <div className="login-input-wrap">
                    <Mail aria-hidden="true" />
                    <input id="login-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); clearFieldError('email') }} autoComplete="email" placeholder="you@example.com" aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'login-email-error' : undefined} />
                  </div>
                  {fieldErrors.email && <small id="login-email-error" className="login-field-error">{fieldErrors.email}</small>}
                </div>}

                {!resetMode && !forgotMode && <div className="login-field">
                  <label htmlFor="login-password">Пароль</label>
                  <div className="login-input-wrap">
                    <input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => { setPassword(event.target.value); clearFieldError('password') }} autoComplete={register ? 'new-password' : 'current-password'} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'login-password-error' : undefined} />
                    <button className="login-password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>
                      {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </button>
                  </div>
                  {fieldErrors.password && <small id="login-password-error" className="login-field-error">{fieldErrors.password}</small>}
                </div>}

                {resetMode && <div className="login-field">
                  <label htmlFor="login-password">Новый пароль</label>
                  <div className="login-input-wrap">
                    <input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => { setPassword(event.target.value); clearFieldError('password') }} autoComplete="new-password" aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'login-password-error' : undefined} />
                    <button className="login-password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>
                      {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </button>
                  </div>
                  {fieldErrors.password && <small id="login-password-error" className="login-field-error">{fieldErrors.password}</small>}
                </div>}

                {!register && !resetMode && !forgotMode && <button className="login-forgot" type="button" onClick={() => { setForgotMode(true); setFieldErrors(emptyFieldErrors); clearMessages() }}>Забыли пароль?</button>}
                {forgotMode && <p className="login-form-hint">Отправим ссылку для восстановления на указанный email.</p>}
                {register && !resetMode && <p className="login-form-hint">После регистрации проверьте почту, если подтверждение email включено на сервере.</p>}

                {error && <div className="login-error" role="alert" aria-live="polite">{error}</div>}

                <button className="login-submit" type="submit" disabled={pending || (!emailAuthEnabled && !resetMode && !forgotMode)}>
                  {pending && <LoaderCircle className="login-spinner" aria-hidden="true" />}
                  <span>{pending ? resetMode ? 'СОХРАНЯЕМ…' : forgotMode ? 'ОТПРАВЛЯЕМ…' : register ? 'СОЗДАЁМ…' : 'ВХОДИМ…' : forgotMode ? 'ОТПРАВИТЬ ССЫЛКУ' : submitLabel}</span>
                </button>

                {notice && <div className="login-notice" role="status" aria-live="polite">{notice}</div>}

                {!resetMode && !forgotMode && !register && <>
                  <div className="login-divider" aria-hidden="true"><span />ИЛИ<span /></div>
                  <button className="login-yandex" type="button" onClick={signInWithYandex} disabled={pending || !yandexAuthEnabled}>
                    <span className="login-yandex-mark" aria-hidden="true">Я</span>
                    <span>{pending ? 'ПЕРЕХОДИМ…' : 'ВОЙТИ ЧЕРЕЗ ЯНДЕКС'}</span>
                  </button>
                </>}

                {(forgotMode || resetMode) && <button className="login-secondary-link" type="button" onClick={() => switchMode(false)}>Вернуться ко входу</button>}
                {register && !resetMode && <p className="login-register-line">Уже есть аккаунт? <button type="button" onClick={() => switchMode(false)}>Войти</button></p>}
                {!register && !resetMode && !forgotMode && <p className="login-register-line">Нет аккаунта? <a href={authHref('/register', returnUrl)}>Зарегистрироваться</a></p>}
              </form>}
            {!serverRuntime.loading && !emailAuthEnabled && !resetMode && !forgotMode && <p className="login-form-hint login-form-hint--warning">Вход по email временно недоступен на этом окружении.</p>}
            {!statusMessage && !serverRuntime.loading && error && <span className="sr-only">Ошибка авторизации</span>}
          </div>
        </div>
        <div className="login-art-column" aria-hidden="true">
          <img className="login-art" src="/images/login_illustration.webp" srcSet="/images/login_illustration.webp 1536w" sizes="(max-width: 767px) 120vw, 860px" alt="" width="1536" height="1024" fetchPriority="high" />
        </div>
      </section>
    </main>
  </div>
}

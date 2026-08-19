import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { api, ApiClientError, queryKeys } from '../../api/client'
import { markAnalyticsOAuthReturnPending, trackMetrikaGoal } from '../../app/metrics'
import { clearQueuedClientEvents } from '../../app/client-events'
import { ActionButton } from '../../components/app-shell/AppShell'
import { ControlButton, InlineAlert, TextInput } from '../../components/ui'
import { authErrorMessage, resetPasswordTokenFromLocation } from '../auth/auth-helpers'
import { buildLegacyImport, legacyImportCompleted, markLegacyImportCompleted } from '../auth/legacy-import'
import { localizeYandexOAuthUrl } from '../auth/yandex-oauth'
import { notifyAuthSessionChanged, type AuthSession } from '../auth/use-auth-session'
import { formatTickets } from '../economy/economy-rules'
import { ensureServerSession, SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'

const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : null

export function AccountAccessPanel({ session, loadingSession, refreshSession }: {
  session: AuthSession | null
  loadingSession: boolean
  refreshSession: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const serverRuntime = useServerRuntime()
  const [register, setRegister] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true)
  const [resetToken, setResetToken] = useState(() => resetPasswordTokenFromLocation())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const [legacyConsent, setLegacyConsent] = useState(false)
  const [legacyPayload, setLegacyPayload] = useState(() => SERVER_RUNTIME ? buildLegacyImport() : null)
  const authCapabilities = serverRuntime.meta?.auth
  const emailAuthEnabled = Boolean(authCapabilities?.emailPassword)
  const passwordResetEnabled = Boolean(authCapabilities?.passwordReset)
  const yandexAuthEnabled = Boolean(authCapabilities?.yandex)

  const clearMessages = () => {
    setError('')
    setNotice('')
  }
  const clearUserScopedQueries = () => {
    for (const queryKey of [['dashboard'], ['ledger'], ['archive'], ['game'], ['search'], ['admin']] as const) {
      queryClient.removeQueries({ queryKey })
    }
  }
  const refreshRuntimeQueries = async () => {
    clearUserScopedQueries()
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      queryClient.invalidateQueries({ queryKey: queryKeys.ledger }),
    ])
  }
  const clearResetTokenFromAddress = () => {
    if (typeof window === 'undefined') {
      setResetToken('')
      return
    }
    const params = new URLSearchParams(window.location.search)
    if (params.has('token')) {
      params.delete('token')
      const query = params.toString()
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
      window.history.replaceState(window.history.state, '', nextUrl)
    }
    setResetToken('')
  }

  useEffect(() => {
    setResetToken(resetPasswordTokenFromLocation())
  }, [])

  const submitEmail = async () => {
    if (pending) return

    const nextName = name.trim()
    const nextEmail = email.trim()
    const nextPassword = password
    if (!nextEmail || !nextPassword) {
      setError('Заполните email и пароль.')
      return
    }
    if (register && !nextName) {
      setError('Укажите имя для регистрации.')
      return
    }

    clearMessages()
    setPending(true)
    try {
      const guestDashboard = SERVER_RUNTIME && session?.isAnonymous
        ? await api.dashboard().catch(() => null)
        : null
      const authResult = register
        ? await api.signUp(nextName, nextEmail, nextPassword, `${window.location.origin}${window.location.pathname}`)
        : await api.signIn(nextEmail, nextPassword)
      if (register) {
        if (!authResult.token) {
          trackMetrikaGoal('auth_success', { action: 'sign_up_pending_verification' })
          setPassword('')
          setRegister(false)
          setNotice(`Аккаунт создан. Подтвердите ${nextEmail} по ссылке из письма. До подтверждения вы продолжаете как гость: ${formatTickets(guestDashboard?.wallet.balance ?? 0)} и все сеансы останутся здесь, а после подтверждения автоматически перейдут в аккаунт.`)
          await refreshSession()
          notifyAuthSessionChanged()
          return
        }
      } else if (!authResult.token) {
        throw new Error('Сервер не создал пользовательскую сессию. Попробуйте войти ещё раз.')
      }
      trackMetrikaGoal('auth_success', { action: register ? 'sign_up' : 'sign_in' })
      setPassword('')
      await refreshSession()
      notifyAuthSessionChanged()
      await refreshRuntimeQueries()
      const mergedDashboard = SERVER_RUNTIME ? await api.dashboard() : null
      setNotice(register
        ? `Аккаунт создан. Гостевой прогресс сохранён: текущий баланс — ${formatTickets(mergedDashboard?.wallet.balance ?? guestDashboard?.wallet.balance ?? 0)}.`
        : `Вход выполнен. Гостевые сеансы, билеты и открытые периоды объединены с аккаунтом. Текущий баланс — ${formatTickets(mergedDashboard?.wallet.balance ?? 0)}.`)
    } catch (value) {
      trackMetrikaGoal('auth_error', { action: register ? 'sign_up' : 'sign_in' })
      setError(authErrorMessage(value))
    } finally {
      setPending(false)
    }
  }

  const requestPasswordReset = async () => {
    if (pending) return
    const nextEmail = email.trim()
    if (!nextEmail) {
      setError('Укажите email для восстановления пароля.')
      return
    }

    clearMessages()
    setPending(true)
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}`
      await api.requestPasswordReset(nextEmail, redirectTo)
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

  const submitResetPassword = async () => {
    if (pending) return
    const token = resetToken.trim()
    const nextPassword = resetPasswordValue
    if (!token) {
      setError('Не найден токен сброса. Запросите новую ссылку.')
      return
    }
    if (!nextPassword) {
      setError('Введите новый пароль.')
      return
    }

    clearMessages()
    setPending(true)
    try {
      await api.resetPassword(token, nextPassword)
      trackMetrikaGoal('auth_success', { action: 'reset_password' })
      setResetPasswordValue('')
      setRegister(false)
      setForgotMode(false)
      clearResetTokenFromAddress()
      setNotice('Пароль обновлен. Теперь войдите с новым паролем.')
    } catch (value) {
      trackMetrikaGoal('auth_error', { action: 'reset_password' })
      setError(authErrorMessage(value))
    } finally {
      setPending(false)
    }
  }

  const submitChangePassword = async () => {
    if (pending) return
    const current = currentPassword
    const next = newPassword
    if (!current || !next) {
      setError('Заполните текущий и новый пароль.')
      return
    }

    clearMessages()
    setPending(true)
    try {
      await api.changePassword(current, next, revokeOtherSessions)
      trackMetrikaGoal('auth_success', { action: 'change_password' })
      setCurrentPassword('')
      setNewPassword('')
      setNotice('Пароль успешно изменен.')
      await refreshSession()
      notifyAuthSessionChanged()
      await refreshRuntimeQueries()
    } catch (value) {
      trackMetrikaGoal('auth_error', { action: 'change_password' })
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
      const response = asRecord(payload)
      const oauthUrl = typeof response?.url === 'string' ? response.url : ''
      if (!oauthUrl) throw new Error('Сервис Яндекс не вернул ссылку для входа.')
      trackMetrikaGoal('auth_oauth_start', { provider: 'yandex' })
      markAnalyticsOAuthReturnPending()
      redirected = true
      window.location.assign(localizeYandexOAuthUrl(oauthUrl))
    } catch (value) {
      trackMetrikaGoal('auth_error', { action: 'oauth_yandex' })
      if (value instanceof ApiClientError && value.status === 404) {
        setError('Вход через Яндекс пока не настроен на сервере.')
      } else {
        setError(authErrorMessage(value))
      }
    } finally {
      if (!redirected) setPending(false)
    }
  }

  const signOut = async () => {
    if (pending) return
    clearMessages()
    setPending(true)
    try {
      const accountEmail = session?.email ?? ''
      await api.signOut()
      clearQueuedClientEvents()
      trackMetrikaGoal('auth_success', { action: 'sign_out' })
      setRegister(false)
      setForgotMode(false)
      setName('')
      setEmail(accountEmail)
      setPassword('')
      setCurrentPassword('')
      setNewPassword('')
      setResetPasswordValue('')
      window.sessionStorage.removeItem('shoditsa:active-server-session')
      clearUserScopedQueries()
      await ensureServerSession()
      await refreshSession()
      notifyAuthSessionChanged()
      await refreshRuntimeQueries()
      setNotice('Вы вышли из аккаунта. Его прогресс и билеты сохранены на сервере. Сейчас создан новый гостевой профиль; войдите снова, чтобы вернуть данные аккаунта.')
    } catch (value) {
      trackMetrikaGoal('auth_error', { action: 'sign_out' })
      setError(authErrorMessage(value))
    } finally {
      setPending(false)
    }
  }

  const importLegacyProgress = async () => {
    if (pending || !session?.id || session.isAnonymous) return
    if (!legacyConsent) {
      setError('Подтвердите перенос локального прогресса.')
      return
    }
    const payload = legacyPayload ?? buildLegacyImport()
    if (!payload) {
      setNotice('В этом браузере нет локального прогресса для переноса.')
      return
    }
    clearMessages()
    setPending(true)
    try {
      const result = await api.legacyImport(payload)
      markLegacyImportCompleted(session.id)
      setLegacyPayload(null)
      setLegacyConsent(false)
      setNotice(result.alreadyImported
        ? 'Локальный прогресс уже был перенесён в этот аккаунт.'
        : `Перенос завершён: игр — ${result.importedGames}, билетов — ${result.importedWallet}.`)
      await refreshRuntimeQueries()
    } catch (value) {
      setError(authErrorMessage(value))
    } finally {
      setPending(false)
    }
  }

  return <div className="account-access">
    {loadingSession
      ? <p className="modal-lead">Проверяем сессию...</p>
      : session && !session.isAnonymous
        ? <>
          <p className="modal-lead">Вы вошли как <strong>{session.name || session.email || 'пользователь'}</strong>.</p>
          <ActionButton variant="secondary" onClick={signOut} disabled={pending}><LogOut /> Выйти</ActionButton>
          {SERVER_RUNTIME && session.id && legacyPayload && !legacyImportCompleted(session.id) && <div className="account-access__form account-access__legacy-import">
            <p className="modal-lead">В этом браузере найден старый локальный прогресс. Его можно один раз добавить в аккаунт; локальная копия останется на месте.</p>
            <label className="account-access__checkbox"><TextInput type="checkbox" checked={legacyConsent} onChange={(event) => setLegacyConsent(event.target.checked)} /><span>Я подтверждаю перенос игр, открытых периодов и билетов в этот аккаунт</span></label>
            <ActionButton variant="secondary" onClick={importLegacyProgress} disabled={pending || !legacyConsent}>Перенести локальный прогресс</ActionButton>
          </div>}
          {session.hasPassword && emailAuthEnabled
            ? <>
              <p className="account-access__separator">Смена пароля</p>
              <div className="account-access__form">
                <label className="account-access__label">Текущий пароль<TextInput surface="dark" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
                <label className="account-access__label">Новый пароль<TextInput surface="dark" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
                <label className="account-access__checkbox"><TextInput type="checkbox" checked={revokeOtherSessions} onChange={(event) => setRevokeOtherSessions(event.target.checked)} /><span>Выйти на других устройствах</span></label>
                <ActionButton onClick={submitChangePassword} disabled={pending}>{pending ? 'Сохраняем...' : 'Сменить пароль'}</ActionButton>
              </div>
            </>
            : <p className="modal-lead">Этот аккаунт использует вход через {session.providers.filter((provider) => provider !== 'credential').join(', ') || 'внешнего провайдера'}. Кнопка смены пароля недоступна, потому что пароль к аккаунту не привязан.</p>}
        </>
        : resetToken
          ? <>
            <p className="modal-lead">Введите новый пароль, чтобы восстановить доступ к аккаунту.</p>
            <div className="account-access__form">
              <label className="account-access__label">Новый пароль<TextInput surface="dark" type="password" value={resetPasswordValue} onChange={(event) => setResetPasswordValue(event.target.value)} autoComplete="new-password" /></label>
              <ActionButton onClick={submitResetPassword} disabled={pending}>{pending ? 'Сохраняем...' : 'Сбросить пароль'}</ActionButton>
              <ControlButton className="account-access__toggle" type="button" onClick={() => {
                clearResetTokenFromAddress()
                setForgotMode(false)
                clearMessages()
              }}>Вернуться ко входу</ControlButton>
            </div>
          </>
          : forgotMode && passwordResetEnabled
            ? <>
              <p className="modal-lead">Отправим на email ссылку для восстановления пароля.</p>
              <div className="account-access__form">
                <label className="account-access__label">Email<TextInput surface="dark" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
                <ActionButton onClick={requestPasswordReset} disabled={pending}>{pending ? 'Отправляем...' : 'Отправить ссылку'}</ActionButton>
                <ControlButton className="account-access__toggle" type="button" onClick={() => {
                  setForgotMode(false)
                  clearMessages()
                }}>Вернуться ко входу</ControlButton>
              </div>
            </>
        : <>
          <p className="modal-lead">Регистрация закрепит текущие гостевые сеансы, билеты и открытые периоды за новым аккаунтом. Вход в существующий аккаунт объединит два серверных профиля — заработанные билеты не пропадут.</p>
          {yandexAuthEnabled && <ActionButton className="account-access__yandex" variant="secondary" onClick={signInWithYandex} disabled={pending}>Войти через Яндекс</ActionButton>}
          {yandexAuthEnabled && emailAuthEnabled && <p className="account-access__separator">или по email</p>}
          {emailAuthEnabled
            ? <div className="account-access__form">
              {register && <label className="account-access__label">Имя<TextInput surface="dark" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}
              <label className="account-access__label">Email<TextInput surface="dark" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
              <label className="account-access__label">Пароль<TextInput surface="dark" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={register ? 'new-password' : 'current-password'} /></label>
              {register && authCapabilities?.emailVerification && <p className="modal-lead">После регистрации нужно открыть письмо на этом устройстве и подтвердить email. До подтверждения вы останетесь гостем, а затем текущие билеты и игры автоматически перейдут в аккаунт.</p>}
              <ActionButton onClick={submitEmail} disabled={pending}>{pending ? 'Отправляем...' : register ? 'Создать аккаунт' : 'Войти'}</ActionButton>
              <ControlButton className="account-access__toggle" type="button" onClick={() => {
                setRegister((current) => !current)
                setForgotMode(false)
                clearMessages()
              }}>{register ? 'У меня уже есть аккаунт' : 'Создать аккаунт'}</ControlButton>
              {!register && passwordResetEnabled && <ControlButton className="account-access__toggle" type="button" onClick={() => {
                setForgotMode(true)
                clearMessages()
              }}>Забыли пароль?</ControlButton>}
            </div>
            : !yandexAuthEnabled && <InlineAlert tone="warning" className="server-error">Способы входа временно не настроены на сервере. Гостевая игра продолжает работать, весь прогресс хранится в текущем серверном гостевом профиле.</InlineAlert>}
        </>}
    {!!notice && <p className="account-access__notice">{notice}</p>}
    {!!error && <InlineAlert tone="danger" className="server-error">{error}</InlineAlert>}
  </div>
}

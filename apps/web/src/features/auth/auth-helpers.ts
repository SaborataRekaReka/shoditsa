import { ApiClientError } from '../../api/client'

export const authErrorMessage = (error: unknown) => {
  if (error instanceof ApiClientError) {
    if (error.code === 'NETWORK_TIMEOUT') return 'Сервер отвечает слишком долго. Попробуйте еще раз.'
    if (error.code === 'INVALID_EMAIL_OR_PASSWORD') return 'Неверный email или пароль.'
    if (error.code === 'EMAIL_NOT_VERIFIED') return 'Сначала подтвердите email по ссылке из письма. Гостевой прогресс пока остаётся в этом браузере.'
    if (error.code === 'USER_ALREADY_EXISTS') return 'Пользователь с таким email уже существует.'
    if (error.code === 'AUTH_EMAIL_DISABLED') return 'Вход по email сейчас временно отключен на этом окружении.'
    if (error.code === 'RESET_PASSWORD_DISABLED' || /reset password isn't enabled/i.test(error.message)) return 'Восстановление пароля пока не настроено на сервере.'
    if (error.code === 'INVALID_TOKEN') return 'Ссылка для сброса устарела или недействительна.'
    if (error.code === 'PASSWORD_TOO_SHORT') return 'Пароль слишком короткий. Минимум 10 символов.'
    if (error.code === 'PASSWORD_TOO_LONG') return 'Пароль слишком длинный.'
    if (error.code === 'INVALID_PASSWORD') return 'Текущий пароль указан неверно.'
    if (error.code === 'CREDENTIAL_ACCOUNT_NOT_FOUND') return 'Для этого аккаунта пароль не задан. Используйте вход через провайдера или подключите email-вход.'
    if (error.code === 'PROVIDER_CONFIG_NOT_FOUND' || /provider_config_not_found/i.test(error.message)) return 'Вход через Яндекс пока не настроен на сервере.'
    if (error.message === 'Invalid email or password') return 'Неверный email или пароль.'
    if (error.status >= 500) return 'Сервис авторизации временно недоступен. Попробуйте позже.'
    return error.message || 'Не удалось выполнить запрос.'
  }
  return error instanceof Error ? error.message : 'Не удалось выполнить запрос.'
}

export const resetPasswordTokenFromLocation = () => {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('token')?.trim() || ''
}

import { ApiClientError } from './client'

const labels: Record<string, string> = {
  AUTH_REQUIRED: 'Нужно войти в аккаунт.',
  AUTH_EMAIL_DISABLED: 'Вход по email временно отключён.',
  INVALID_EMAIL_OR_PASSWORD: 'Неверный email или пароль.',
  USER_ALREADY_EXISTS: 'Пользователь с таким email уже существует.',
  INSUFFICIENT_TICKETS: 'Недостаточно билетов.',
  PERIOD_LOCKED: 'Сначала разблокируйте этот период.',
  PROMO_NOT_FOUND: 'Промокод не найден.',
  LEGACY_IMPORT_DISABLED: 'Период переноса старого прогресса завершён.',
  LEGACY_DEVICE_ALREADY_IMPORTED: 'Прогресс с этого устройства уже перенесён.',
  NETWORK_TIMEOUT: 'Сервер отвечает слишком долго. Попробуйте ещё раз.',
  NETWORK_UNAVAILABLE: 'Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.',
}

const formatRetryDelay = (retryAfterMs: number) => {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
  if (seconds < 60) return `через ${seconds} сек.`
  const minutes = Math.ceil(seconds / 60)
  return `через ${minutes} мин.`
}

export const apiErrorMessage = (error: unknown) => {
  if (error instanceof ApiClientError) {
    if (error.status === 429) {
      const retryAfterMs = Number(error.details.retryAfterMs)
      const suffix = Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? ` Повторите ${formatRetryDelay(retryAfterMs)}.`
        : ' Повторите чуть позже.'
      const base = `Слишком много запросов.${suffix}`
      return error.requestId ? `${base} · ${error.requestId}` : base
    }
    const base = labels[error.code] ?? error.message
    return error.requestId ? `${base} · ${error.requestId}` : base
  }
  return error instanceof Error ? error.message : 'Не удалось выполнить запрос.'
}

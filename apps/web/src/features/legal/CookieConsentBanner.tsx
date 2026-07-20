import { useEffect, useState } from 'react'
import { setAnalyticsConsent, storedAnalyticsConsent, type AnalyticsConsent } from '../../app/metrics'
import './LegalScreen.css'

const SETTINGS_EVENT = 'shoditsa:cookie-settings'

export function CookieConsentBanner() {
  const [open, setOpen] = useState(() => storedAnalyticsConsent() === null)
  const [current, setCurrent] = useState<AnalyticsConsent | null>(() => storedAnalyticsConsent())

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(SETTINGS_EVENT, show)
    return () => window.removeEventListener(SETTINGS_EVENT, show)
  }, [])

  const choose = (value: AnalyticsConsent) => {
    setAnalyticsConsent(value)
    setCurrent(value)
    setOpen(false)
  }

  if (!open) return null
  return <section className="cookie-consent" role="dialog" aria-modal="false" aria-labelledby="cookie-consent-title">
    <div>
      <strong id="cookie-consent-title">Настройки cookie</strong>
      <p>Необходимые данные сохраняют вход и игровой прогресс. Яндекс Метрика загружается только с вашего согласия; отказ не ограничивает сайт. Подробнее — в <a href="/legal/privacy">Политике конфиденциальности</a>.</p>
      {current && <small>Текущий выбор: {current === 'accepted' ? 'аналитика разрешена' : 'только необходимые'}.</small>}
    </div>
    <div className="cookie-consent__actions">
      <button type="button" className="cookie-consent__secondary" onClick={() => choose('rejected')}>Только необходимые</button>
      <button type="button" className="cookie-consent__primary" onClick={() => choose('accepted')}>Разрешить аналитику</button>
    </div>
  </section>
}


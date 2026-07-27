import type { CloudPaymentsWidgetIntent } from '@shoditsa/contracts'

export type CloudPaymentsWidgetResult = {
  type?: 'cancel' | 'payment' | 'installment' | 'error'
  status?: 'success' | 'fail' | 'appointment' | 'reject' | 'cancel'
  message?: string
}

type CloudPaymentsWidget = {
  start: (intent: Omit<CloudPaymentsWidgetIntent, 'provider' | 'scriptUrl'>) => Promise<CloudPaymentsWidgetResult>
}

declare global {
  interface Window {
    cp?: {
      CloudPayments: new () => CloudPaymentsWidget
    }
  }
}

const TRUSTED_WIDGET_URL = 'https://widget.cloudpayments.ru/bundles/cloudpayments.js'
let loadingScript: Promise<void> | null = null

const loadWidget = (scriptUrl: string) => {
  if (scriptUrl !== TRUSTED_WIDGET_URL) return Promise.reject(new Error('Получен недоверенный адрес платёжного виджета'))
  if (window.cp?.CloudPayments) return Promise.resolve()
  loadingScript ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TRUSTED_WIDGET_URL}"]`)
    const script = existing ?? document.createElement('script')
    const loaded = () => window.cp?.CloudPayments
      ? resolve()
      : reject(new Error('CloudPayments не загрузился'))
    script.addEventListener('load', loaded, { once: true })
    script.addEventListener('error', () => reject(new Error('Не удалось загрузить CloudPayments')), { once: true })
    if (!existing) {
      script.src = TRUSTED_WIDGET_URL
      script.async = true
      document.head.append(script)
    }
  }).catch((error) => {
    loadingScript = null
    throw error
  })
  return loadingScript
}

export const openCloudPaymentsWidget = async (intent: CloudPaymentsWidgetIntent) => {
  await loadWidget(intent.scriptUrl)
  if (!window.cp?.CloudPayments) throw new Error('Платёжный виджет недоступен')
  const { provider: _provider, scriptUrl: _scriptUrl, ...parameters } = intent
  const widget = new window.cp.CloudPayments()
  return widget.start(parameters)
}

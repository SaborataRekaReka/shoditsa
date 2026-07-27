import type { CheckoutResponse } from '@shoditsa/contracts'
import { openCloudPaymentsWidget, type CloudPaymentsWidgetResult } from './cloudpayments-widget'

type OpenWidget = (intent: NonNullable<CheckoutResponse['widget']>) => Promise<CloudPaymentsWidgetResult>

export const checkoutDestination = async (
  response: CheckoutResponse,
  openWidget: OpenWidget = openCloudPaymentsWidget,
) => {
  if (response.widget) {
    const result = await openWidget(response.widget)
    if (result.status === 'success') {
      return `/purchase/return?orderId=${encodeURIComponent(response.order.id)}`
    }
    if (result.type !== 'cancel') {
      throw new Error(result.message || 'CloudPayments не подтвердил оплату')
    }
    return null
  }
  if (response.checkoutUrl) return response.checkoutUrl
  return `/purchase/return?orderId=${encodeURIComponent(response.order.id)}`
}

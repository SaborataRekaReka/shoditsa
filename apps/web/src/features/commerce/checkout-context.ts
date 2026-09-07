const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Only product/opaque intent and an allowlisted mode survive the auth redirect. */
export const checkoutContext = (search: string, productId: string, makeId: () => string) => {
  const params = new URLSearchParams(search)
  const previous = params.get('intent')
  return {
    intentId: params.get('product') === productId && previous && uuid.test(previous) ? previous : makeId(),
    sourceMode: params.get('from') === 'diagnosis' ? 'diagnosis' as const : undefined,
  }
}
export const checkoutRegistrationHref = (returnUrl: string, productId: string, context: ReturnType<typeof checkoutContext>) => {
  const base = new URL('https://shoditsa.ru')
  const url = new URL(returnUrl, base)
  if (url.origin !== base.origin) throw new Error('Возврат возможен только на сайт')
  url.searchParams.set('product', productId)
  url.searchParams.set('intent', context.intentId)
  if (context.sourceMode) url.searchParams.set('from', context.sourceMode)
  return `/register?returnUrl=${encodeURIComponent(`${url.pathname}${url.search}${url.hash}`)}`
}

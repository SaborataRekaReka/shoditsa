import { asc, eq } from 'drizzle-orm'
import { commerceProducts, type Database } from '@shoditsa/database'

export const publicProduct = (product: typeof commerceProducts.$inferSelect) => ({
  id: product.id,
  kind: product.kind as 'club' | 'pack' | 'tip' | 'tickets',
  title: product.title,
  description: product.description,
  priceMinor: product.priceMinor,
  currency: product.currency,
  durationDays: product.durationDays,
  metadata: product.metadata as Record<string, unknown>,
})

export const commerceCatalog = async (db: Database, enabled: boolean, currency: string, ticketBundlesEnabled = false) => ({
  enabled,
  currency,
  products: (await db.select().from(commerceProducts).where(eq(commerceProducts.enabled, true)).orderBy(asc(commerceProducts.sortOrder), asc(commerceProducts.id)))
    .filter((product) => product.kind !== 'pack' && (product.kind !== 'tickets' || ticketBundlesEnabled))
    .map(publicProduct),
})

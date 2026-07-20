import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  commerceProducts, contentItems, contentItemVersions, contentPackEntries, contentPacks,
  contentRevisions, createDatabase,
} from '@shoditsa/database'

type PromoItem = {
  id: string
  order?: number
  fallbackAnswerCard: Record<string, unknown> & { id: string; titleRu: string; titleOriginal?: string; year?: number }
  progressiveHints?: unknown[]
}
type PromoDocument = {
  pack: { id: string; title: string; subtitle?: string; itemCount?: number; recommendedOrder?: string[]; uiCopy?: Record<string, unknown> }
  items: PromoItem[]
}

const source = resolve(process.cwd(), 'data/promo/dtf-games-promo-30.json')
const document = JSON.parse(await readFile(source, 'utf8')) as PromoDocument
const productId = 'pack_dtf_games_30'
const config = loadConfig()
const { db, client } = createDatabase(config)

try {
  const revision = await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!revision[0]) throw new Error('Active content revision is required before importing the promo pack')
  const byId = new Map(document.items.map((item) => [item.id, item]))
  const ordered = (document.pack.recommendedOrder ?? [])
    .map((id) => byId.get(id))
    .filter((item): item is PromoItem => Boolean(item))
  for (const item of document.items) if (!ordered.includes(item)) ordered.push(item)
  if (ordered.length !== document.items.length) throw new Error('Promo pack ordering is incomplete')

  await db.transaction(async (tx) => {
    await tx.insert(commerceProducts).values({
      id: productId,
      kind: 'pack',
      title: '30 игр, которые сходятся',
      description: 'Тематический спецпоказ из 30 игр с отдельным прогрессом.',
      priceMinor: 14_900,
      currency: config.commerce.currency,
      entitlementKey: 'pack',
      scope: document.pack.id,
      sortOrder: 30,
    }).onConflictDoUpdate({ target: commerceProducts.id, set: { entitlementKey: 'pack', scope: document.pack.id, updatedAt: new Date() } })

    await tx.insert(contentPacks).values({
      id: document.pack.id,
      slug: 'dtf-games-promo-30',
      mode: 'game',
      title: document.pack.title,
      subtitle: document.pack.subtitle ?? null,
      description: 'Тридцать игровых споров и вымышленных комментариев. Угадайте игру за десять попыток.',
      status: 'published',
      accessModel: 'purchase',
      productId,
      includedInClub: true,
      previewItems: 2,
      manifestVersion: 1,
      metadata: { source: 'data/promo/dtf-games-promo-30.json', uiCopy: document.pack.uiCopy ?? {} },
    }).onConflictDoUpdate({
      target: contentPacks.id,
      set: { title: document.pack.title, subtitle: document.pack.subtitle ?? null, productId, status: 'published', updatedAt: new Date() },
    })

    await tx.insert(contentItems).values(ordered.map((item) => ({ id: item.fallbackAnswerCard.id, mode: 'game' as const }))).onConflictDoNothing()
    await tx.insert(contentItemVersions).values(ordered.map((item, index) => ({
      itemId: item.fallbackAnswerCard.id,
      revisionId: revision[0].id,
      mode: 'game' as const,
      titleRu: item.fallbackAnswerCard.titleRu,
      titleOriginal: item.fallbackAnswerCard.titleOriginal ?? '',
      normalizedTitle: item.fallbackAnswerCard.titleRu.toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/gi, ' ').trim(),
      year: item.fallbackAnswerCard.year ?? null,
      popularityScore: Number(item.fallbackAnswerCard.popularityScore ?? 0),
      sortOrder: 2_000_000 + index,
      allowedInGame: false,
      contentStatus: 'promo_pack',
      payload: item.fallbackAnswerCard,
    }))).onConflictDoNothing()
    await tx.delete(contentPackEntries).where(eq(contentPackEntries.packId, document.pack.id))
    await tx.insert(contentPackEntries).values(ordered.map((item, index) => ({
      packId: document.pack.id,
      position: index + 1,
      answerItemId: item.fallbackAnswerCard.id,
      promptPayload: { progressiveHints: item.progressiveHints ?? [], promoItemId: item.id },
    })))
  })
  console.log(JSON.stringify({ imported: document.pack.id, entries: ordered.length, revisionId: revision[0].id }))
} finally {
  await client.end()
}

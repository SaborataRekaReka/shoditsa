import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  contentItems,
  contentItemVersions,
  contentPackEntries,
  contentRevisions,
  createDatabase,
} from '@shoditsa/database'
import { ApiError } from '../../apps/api/src/lib/errors.js'
import { getPack } from '../../apps/api/src/modules/packs/service.js'
import { loadPackSessionPrompt } from '../../apps/api/src/modules/packs/prompt-runtime.js'
import { DTF_COMMENTS_PACK_ID } from '../../apps/api/src/modules/packs/policy.js'

const { db, client } = createDatabase(loadConfig())

try {
  const adminPack = await getPack(db, DTF_COMMENTS_PACK_ID, null, 'admin')
  assert.equal(adminPack.totalItems, 25)
  assert.equal(adminPack.entries.length, 25)
  assert.ok(adminPack.entries.every((entry) => entry.accessible))

  await assert.rejects(
    () => getPack(db, DTF_COMMENTS_PACK_ID, null, 'player'),
    (error: unknown) => error instanceof ApiError && error.statusCode === 404,
  )

  const revision = await db.select({ id: contentRevisions.id })
    .from(contentRevisions)
    .where(eq(contentRevisions.status, 'active'))
    .limit(1)
  assert.ok(revision[0]?.id)

  const answers = await db.select({
    itemId: contentItems.id,
    allowedInGame: contentItemVersions.allowedInGame,
  })
    .from(contentPackEntries)
    .innerJoin(contentItems, eq(contentItems.id, contentPackEntries.answerItemId))
    .innerJoin(contentItemVersions, and(
      eq(contentItemVersions.itemId, contentItems.id),
      eq(contentItemVersions.revisionId, revision[0].id),
    ))
    .where(eq(contentPackEntries.packId, DTF_COMMENTS_PACK_ID))
  assert.equal(answers.length, 25)
  assert.ok(answers.every((answer) => answer.allowedInGame))
  assert.ok(answers.every((answer) => !answer.itemId.startsWith('promo:')))

  const initial = await loadPackSessionPrompt(db, {
    packId: DTF_COMMENTS_PACK_ID,
    packPosition: 1,
    attemptsCount: 0,
  })
  const rescue = await loadPackSessionPrompt(db, {
    packId: DTF_COMMENTS_PACK_ID,
    packPosition: 1,
    attemptsCount: 5,
  })
  assert.equal(initial?.maxAttempts, 6)
  assert.equal(initial?.progressiveHints.length, 2)
  assert.equal(rescue?.progressiveHints.length, 6)
  assert.equal(initial?.promoPrompt.packId, DTF_COMMENTS_PACK_ID)

  console.log(JSON.stringify({
    packId: DTF_COMMENTS_PACK_ID,
    entries: adminPack.entries.length,
    canonicalAnswers: answers.length,
    adminAccessible: true,
    playerHidden: true,
    maxAttempts: initial.maxAttempts,
    initialHints: initial.progressiveHints.length,
    rescueHints: rescue.progressiveHints.length,
  }, null, 2))
} finally {
  await client.end()
}

import assert from 'node:assert/strict'
import { and, asc, eq } from 'drizzle-orm'
import type { TitleItem } from '@shoditsa/contracts'
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
  assert.equal(adminPack.totalItems, 20)
  assert.equal(adminPack.entries.length, 20)
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
    itemVersionId: contentItemVersions.id,
    allowedInGame: contentItemVersions.allowedInGame,
    payload: contentItemVersions.payload,
    promptPayload: contentPackEntries.promptPayload,
    position: contentPackEntries.position,
  })
    .from(contentPackEntries)
    .innerJoin(contentItems, eq(contentItems.id, contentPackEntries.answerItemId))
    .innerJoin(contentItemVersions, and(
      eq(contentItemVersions.itemId, contentItems.id),
      eq(contentItemVersions.revisionId, revision[0].id),
    ))
    .where(eq(contentPackEntries.packId, DTF_COMMENTS_PACK_ID))
    .orderBy(asc(contentPackEntries.position))
  assert.equal(answers.length, 20)
  assert.ok(answers.every((answer) => answer.allowedInGame))
  assert.ok(answers.every((answer) => !answer.itemId.startsWith('promo:')))
  assert.ok(answers.every((answer) => {
    const comments = (answer.payload as TitleItem).comments ?? []
    return comments.length === 6
      && comments.every((comment) => (
        comment.sourcePackId === DTF_COMMENTS_PACK_ID
        && Boolean(comment.sourceId && comment.sourceUrl && comment.authorName && comment.authorAvatarUrl)
      ))
  }))
  assert.ok(answers.every((answer) => !('progressiveHints' in (answer.promptPayload as Record<string, unknown>))))

  const initial = await loadPackSessionPrompt(db, {
    packId: DTF_COMMENTS_PACK_ID,
    packPosition: 1,
    answerItemVersionId: answers[0].itemVersionId,
    attemptsCount: 0,
  })
  const rescue = await loadPackSessionPrompt(db, {
    packId: DTF_COMMENTS_PACK_ID,
    packPosition: 1,
    answerItemVersionId: answers[0].itemVersionId,
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
    canonicalComments: answers.reduce((total, answer) => total + ((answer.payload as TitleItem).comments?.length ?? 0), 0),
    adminAccessible: true,
    playerHidden: true,
    maxAttempts: initial.maxAttempts,
    initialHints: initial.progressiveHints.length,
    rescueHints: rescue.progressiveHints.length,
  }, null, 2))
} finally {
  await client.end()
}

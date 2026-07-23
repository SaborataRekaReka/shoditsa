#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cleanText,
  normalizeTitle,
  sha256,
  uniqueStrings,
} from './enrichment-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const verifySources = args.includes('--verify-sources')
const catalogPath = resolve(root, 'data/games/enriched/games-catalog.enriched.json')
const poolsPath = resolve(root, 'data/games/enriched/games-special-pools.json')
const packPath = resolve(root, 'data/promo/dtf-game-comments-25-v1.json')
const corpusRoot = resolve(root, 'dtf_25_games_scraping_pack/dtf-25-games-corpus')
const analysisRoot = resolve(root, 'dtf_25_games_scraping_pack/dtf-25-games-corpus-analysis')
const outputDir = resolve(root, 'data/games/enriched/dtf')
const paths = {
  enriched: resolve(outputDir, 'games-dtf-comments.enriched.json'),
  candidates: resolve(outputDir, 'games-dtf-comment-candidates.json'),
  review: resolve(outputDir, 'games-dtf-review-required.json'),
  sources: resolve(outputDir, 'games-dtf-sources.csv'),
  audit: resolve(outputDir, 'games-dtf-audit-before-after.csv'),
  editor: resolve(outputDir, 'games-dtf-editorial-review.csv'),
  report: resolve(outputDir, 'games-dtf-enrichment-report.md'),
  patch: resolve(outputDir, 'games-dtf-catalog-patch.json'),
  compatiblePack: resolve(outputDir, 'games-dtf-pack.compatible.json'),
}

const now = new Date().toISOString()
const today = now.slice(0, 10)
const userAgent = 'shoditsa-dtf-source-verifier/1.0 (+https://shoditsa.ru/)'

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const readJsonl = async (path) => (await readFile(path, 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map(JSON.parse)

const writeAtomic = async (path, value) => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

const fetchJson = async (url, attempts = 3) => {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': userAgent, referer: 'https://dtf.ru/' },
        signal: AbortSignal.timeout(45_000),
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((done) => setTimeout(done, attempt * 750))
    }
  }
  throw lastError
}

const mapLimit = async (values, limit, worker) => {
  const result = new Array(values.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      result[index] = await worker(values[index], index)
    }
  })
  await Promise.all(runners)
  return result
}

const sourceUrl = (postUrl, commentId) => {
  const url = new URL(postUrl)
  url.searchParams.set('comment', String(commentId))
  return url.toString()
}

const exactExcerpt = (text, max = 280) => {
  const value = cleanText(text)
  if (value.length <= max) return value
  const prefix = value.slice(0, max + 1)
  const sentence = prefix.match(/^(.{60,260}?[.!?])(?:\s|$)/)?.[1]
  if (sentence) return sentence
  return prefix.slice(0, prefix.lastIndexOf(' ')).trim()
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const redactAnswer = (excerpt, answerRef, catalogGame) => {
  let displayText = excerpt
  let replacements = 0
  const aliases = uniqueStrings([
    answerRef.titleRu,
    answerRef.titleOriginal,
    ...(answerRef.aliases ?? []),
    catalogGame.titleRu,
    catalogGame.titleOriginal,
    ...(catalogGame.alternativeTitles ?? []),
    ...(catalogGame.aliases ?? []),
  ]).filter((value) => normalizeTitle(value).length >= 4)
    .sort((left, right) => right.length - left.length)
  for (const alias of aliases) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(alias)}(?![\\p{L}\\p{N}])`, 'giu')
    displayText = displayText.replace(pattern, () => {
      replacements += 1
      return '[название игры]'
    })
  }
  const normalizedDisplay = normalizeTitle(displayText)
  const leaked = aliases.some((alias) => {
    const normalized = normalizeTitle(alias)
    return normalized.length >= 4 && normalizedDisplay.includes(normalized)
  })
  return {
    displayText,
    wasRedacted: replacements > 0,
    redactionReasons: replacements > 0 ? ['direct_answer'] : [],
    containsDirectAnswer: leaked,
    replacements,
  }
}

const moderationReason = (text) => {
  if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(text)) return 'personal_email'
  if (/(?:\+?\d[\s()-]*){10,}/.test(text)) return 'personal_phone'
  if (/\b(?:убью тебя|сдохни|найти по адресу|докс|deanonym)/i.test(text)) return 'targeted_threat_or_doxing'
  if (/https?:\/\//i.test(text)) return 'embedded_url'
  return null
}

const genericReason = (text) => {
  const normalized = normalizeTitle(text)
  if (normalized.length < 28) return 'too_short'
  if (/^(?:лучшая|худшая|отличная|нормальная|плохая) игра(?: года)?$/.test(normalized)) return 'generic_reaction'
  if (/^(?:ждем|ждём|база|класс|согласен|не согласен|играем)$/.test(normalized)) return 'generic_reaction'
  return null
}

const signalTags = (text) => {
  const value = text.toLocaleLowerCase('ru-RU')
  const tags = []
  if (/механик|управлен|инвентар|крафт|прокач|геймпле|боев/.test(value)) tags.push('mechanics')
  if (/баг|вылет|оптимизац|fps|фпс|лаг|патч|загруз/.test(value)) tags.push('technical')
  if (/сюжет|персонаж|финал|истори|квест/.test(value)) tags.push('story')
  if (/релиз|анонс|предзаказ|оценк|обзор/.test(value)) tags.push('release-context')
  if (/мем|шутк|смешн|угар|арка/.test(value)) tags.push('community-humor')
  if (/донат|монетизац|магазин|батл.?пасс|battle.?pass/.test(value)) tags.push('monetization')
  if (/кооператив|кооп|друз|команд/.test(value)) tags.push('co-op')
  if (/атмосфер|музык|визуал|график|красив/.test(value)) tags.push('atmosphere')
  if (!tags.length) tags.push('player-experience')
  return tags
}

const specificity = (row) => {
  const tags = signalTags(row.displayText)
  return (
    tags.filter((tag) => tag !== 'player-experience' && tag !== 'atmosphere').length * 10
    + Number(row.relevanceScore || 0) * 25
    + Math.min(15, row.displayText.length / 25)
    + (row.wasRedacted ? 18 : 0)
  )
}

const chooseDiverse = (rows, count) => {
  const selected = []
  const byPost = new Map()
  const hashes = new Set()
  const sorted = [...rows].sort((left, right) =>
    right.selectionScore - left.selectionScore
    || right.rating - left.rating
    || left.sourceCommentId.localeCompare(right.sourceCommentId, 'en-US'))
  while (selected.length < count) {
    const candidate = sorted.find((row) =>
      !hashes.has(row.contentHash)
      && (byPost.get(row.sourcePostId) ?? 0) < 3
      && (selected.length < 3 || !selected.some((existing) =>
        existing.sourcePostId === row.sourcePostId
        && existing.signalTags.join('|') === row.signalTags.join('|'))))
      ?? sorted.find((row) => !hashes.has(row.contentHash) && (byPost.get(row.sourcePostId) ?? 0) < 4)
    if (!candidate) break
    selected.push(candidate)
    hashes.add(candidate.contentHash)
    byPost.set(candidate.sourcePostId, (byPost.get(candidate.sourcePostId) ?? 0) + 1)
  }
  return selected
}

const flattenComments = (payload) => {
  const rows = new Map()
  const stack = [payload?.result?.items ?? payload?.result ?? payload]
  const seen = new Set()
  while (stack.length) {
    const current = stack.pop()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    if (Number.isInteger(Number(current.id)) && typeof current.text === 'string') {
      rows.set(String(current.id), cleanText(current.text))
    }
    if (Array.isArray(current)) stack.push(...current)
    else stack.push(...Object.values(current))
  }
  return rows
}

const liveVerifyPosts = async (postIds) => {
  if (!verifySources) return new Map()
  const results = await mapLimit([...postIds], 4, async (postId, index) => {
    try {
      const payload = await fetchJson(`https://api.dtf.ru/v2.10/comments?contentId=${postId}`)
      console.log(`DTF source verification: ${index + 1}/${postIds.size}`)
      return [String(postId), { status: 'verified', comments: flattenComments(payload) }]
    } catch (error) {
      return [String(postId), { status: 'unavailable', error: cleanText(error?.message || error), comments: new Map() }]
    }
  })
  return new Map(results)
}

const resolveCatalogGame = (packItem, catalog) => {
  const steamIds = new Set((packItem.answerRef.steamAppIds ?? []).map(Number))
  const bySteam = catalog.find((item) => steamIds.has(Number(item.steamAppId)))
  if (bySteam) return bySteam
  const names = new Set(uniqueStrings([
    packItem.answerRef.titleRu,
    packItem.answerRef.titleOriginal,
    ...(packItem.answerRef.aliases ?? []),
  ]).map(normalizeTitle))
  return catalog.find((item) => (item.normalizedAnswers ?? []).some((name) => names.has(name))) ?? null
}

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
const toCsv = (columns, rows) => [
  columns.map(csvCell).join(','),
  ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
].join('\n') + '\n'

const main = async () => {
  const [catalog, pools, pack] = await Promise.all([
    readJson(catalogPath),
    readJson(poolsPath),
    readJson(packPath),
  ])
  if (!Array.isArray(catalog) || !Array.isArray(pack.items)) throw new Error('Invalid catalog or DTF pack')

  const preparedGames = []
  const globalReview = []
  const globalCandidates = []
  const sourceRows = []
  const auditRows = []
  const editorRows = []
  const requestedPostIds = new Set()

  for (const packItem of [...pack.items].sort((left, right) => left.order - right.order)) {
    const gameId = packItem.gameId
    const catalogGame = resolveCatalogGame(packItem, catalog)
    if (!catalogGame) {
      globalReview.push({ gameId, canonicalGameId: null, reason: 'canonical_game_not_found' })
      continue
    }
    let selectedComments = []
    let rawComments = []
    let posts = []
    let manifest = null
    try {
      [selectedComments, rawComments, posts, manifest] = await Promise.all([
        readJsonl(resolve(analysisRoot, gameId, 'selected-comments.jsonl')),
        readJsonl(resolve(corpusRoot, gameId, 'comments.jsonl')),
        readJsonl(resolve(corpusRoot, gameId, 'posts.jsonl')),
        readJson(resolve(corpusRoot, gameId, 'manifest.json')),
      ])
    } catch (error) {
      globalReview.push({
        gameId,
        canonicalGameId: catalogGame.id,
        reason: 'corpus_files_missing',
        detail: cleanText(error?.message || error),
      })
      preparedGames.push({
        packItem,
        catalogGame,
        manifest,
        candidates: [],
        sourceRows: [],
        status: 'insufficient_source_material',
      })
      continue
    }

    const postById = new Map(posts.map((post) => [String(post.post_id), post]))
    const rawById = new Map(rawComments.map((comment) => [String(comment.comment_id), comment]))
    const candidates = []
    const rejectedLocal = []
    const hashes = new Set()
    for (const row of selectedComments) {
      const raw = rawById.get(String(row.commentId))
      const post = postById.get(String(row.postId))
      const excerpt = exactExcerpt(row.text)
      const reason = !post
        ? 'source_post_missing'
        : !raw
          ? 'source_comment_missing'
          : raw.is_deleted
            ? 'source_comment_deleted'
            : genericReason(excerpt) ?? moderationReason(excerpt)
      if (reason) {
        rejectedLocal.push({ commentId: row.commentId, postId: row.postId, reason, text: excerpt })
        continue
      }
      const redaction = redactAnswer(excerpt, packItem.answerRef, catalogGame)
      if (redaction.containsDirectAnswer || redaction.replacements > 1 || cleanText(redaction.displayText).length < 28) {
        rejectedLocal.push({ commentId: row.commentId, postId: row.postId, reason: 'answer_leak_not_safely_redactable', text: excerpt })
        continue
      }
      const hash = sha256(normalizeTitle(excerpt))
      if (hashes.has(hash)) {
        rejectedLocal.push({ commentId: row.commentId, postId: row.postId, reason: 'duplicate_content_hash', text: excerpt })
        continue
      }
      hashes.add(hash)
      const tags = signalTags(redaction.displayText)
      const candidate = {
        id: `dtf-${row.commentId}`,
        sourceType: 'dtf_comment',
        sourceUrl: sourceUrl(post.canonical_url, row.commentId),
        sourceCommentId: String(row.commentId),
        sourcePostId: String(row.postId),
        sourcePostUrl: post.canonical_url,
        publishedAt: row.publishedAt?.slice(0, 10) ?? null,
        sourceExcerpt: excerpt,
        displayText: redaction.displayText,
        wasRedacted: redaction.wasRedacted,
        redactionReasons: redaction.redactionReasons,
        clueOrder: null,
        difficulty: null,
        signalTags: tags,
        containsDirectAnswer: false,
        containsUnsafePersonalData: false,
        sourceVerifiedAt: null,
        sourceVerificationStatus: verifySources ? 'pending' : 'snapshot_verified',
        contentHash: hash,
        rating: Number(row.rating || 0),
        relevanceScore: Number(row.relevanceScore || 0),
        selectionScore: Number(row.relevanceScore || 0) * 100
          + Math.log10(Math.max(0, Number(row.rating || 0)) + 1) * 8
          + Math.min(10, excerpt.length / 35)
          + (tags.length > 1 ? 8 : 0),
      }
      candidates.push(candidate)
    }

    const selected = chooseDiverse(candidates, 9)
    for (const candidate of selected) requestedPostIds.add(candidate.sourcePostId)
    preparedGames.push({
      packItem,
      catalogGame,
      manifest,
      candidates: selected,
      rejectedLocal,
      status: selected.length >= 6 ? 'pending_verification' : 'insufficient_source_material',
    })
  }

  const livePosts = await liveVerifyPosts(requestedPostIds)
  const publishedItems = []
  const compatibleItems = []
  const patch = []
  const insufficient = []

  for (const prepared of preparedGames) {
    const { packItem, catalogGame, manifest } = prepared
    const verifiedCandidates = prepared.candidates.map((candidate) => {
      if (!verifySources) {
        return {
          ...candidate,
          sourceVerifiedAt: manifest?.scraped_at?.slice(0, 10) ?? null,
        }
      }
      const post = livePosts.get(candidate.sourcePostId)
      const liveText = post?.comments.get(candidate.sourceCommentId)
      const exact = liveText && normalizeTitle(liveText).startsWith(normalizeTitle(candidate.sourceExcerpt))
      return {
        ...candidate,
        sourceVerifiedAt: exact ? today : null,
        sourceVerificationStatus: exact ? 'verified' : post?.status === 'unavailable' ? 'source_unavailable' : 'text_mismatch_or_removed',
      }
    })
    const usable = verifiedCandidates.filter((candidate) =>
      candidate.sourceVerificationStatus === 'verified'
      || (!verifySources && candidate.sourceVerificationStatus === 'snapshot_verified'))
    const chosen = usable.slice(0, 6).sort((left, right) => specificity(left) - specificity(right))
      .map((clue, index) => ({
        ...clue,
        clueOrder: index + 1,
        difficulty: index === 0 ? 'hard'
          : index === 1 ? 'hard/medium'
            : index <= 3 ? 'medium'
              : index === 4 ? 'medium/easy'
                : 'easy',
      }))
    const chosenIds = new Set(chosen.map((clue) => clue.id))
    const reserve = usable.filter((candidate) => !chosenIds.has(candidate.id)).slice(0, 3)
    const distinctPages = new Set(chosen.map((clue) => clue.sourcePostId)).size
    const status = chosen.length >= 6 ? 'verified' : 'insufficient_source_material'
    const amount = Math.min(100, Math.log10((manifest?.sampled_comment_count ?? 0) + 1) / 3 * 100)
    const diversity = Math.min(100, distinctPages / 4 * 100)
    const context = chosen.length ? Math.min(100, chosen.reduce((sum, clue) => sum + clue.relevanceScore, 0) / chosen.length * 100) : 0
    const clueQuality = Math.min(100, chosen.length / 6 * 70 + new Set(chosen.flatMap((clue) => clue.signalTags)).size * 5)
    const recognition = Number(catalogGame.recognitionScore || 0)
    const relevanceScore = Math.round((
      amount * 0.30
      + diversity * 0.20
      + context * 0.20
      + clueQuality * 0.15
      + recognition * 0.15
    ) * 100) / 100
    const dtfMode = {
      eligible: status === 'verified',
      status,
      relevanceScore,
      relevanceConfidence: status === 'verified'
        ? Math.round(Math.min(1, 0.55 + distinctPages * 0.1 + chosen.length * 0.025) * 100) / 100
        : 0.25,
      relevanceReasons: uniqueStrings([
        (manifest?.sampled_comment_count ?? 0) >= 100 ? 'large-public-discussion-corpus' : null,
        distinctPages >= 2 ? 'multiple-independent-threads' : 'single-thread-source',
        chosen.some((clue) => clue.signalTags.includes('community-humor')) ? 'recognizable-community-context' : null,
        chosen.some((clue) => clue.signalTags.includes('technical')) ? 'recognizable-technical-context' : null,
      ]),
      publishedClues: status === 'verified' ? chosen : [],
      reserveClues: reserve,
      confusableGames: [],
      editorialNote: distinctPages < 2 ? 'Источник представлен одной страницей; расширение желательно при следующем проходе.' : null,
      lastReviewedAt: today,
    }
    const enriched = {
      canonicalGameId: catalogGame.id,
      gameId: packItem.gameId,
      titleRu: catalogGame.titleRu,
      poolIds: uniqueStrings([...(catalogGame.poolIds ?? []), 'dtf-comments']),
      dtfEligible: dtfMode.eligible,
      dtfRelevanceScore: dtfMode.relevanceScore,
      dtfRelevanceReasons: dtfMode.relevanceReasons,
      dtfSourceStatus: dtfMode.status,
      dtfMode,
    }
    if (status === 'verified') {
      publishedItems.push(enriched)
      const comments = chosen.map((clue, index) => ({
        key: clue.id,
        text: clue.displayText,
        unlockAfterAttempts: [0, 0, 1, 2, 3, 5][index],
        type: 'player_comment',
        spoilerRisk: 'low',
        sourceId: clue.sourceCommentId,
        sourcePackId: pack.pack.id,
        sourceUrl: clue.sourceUrl,
        sourcePostUrl: clue.sourcePostUrl,
        sourceExcerpt: clue.sourceExcerpt,
        sourceVerifiedAt: clue.sourceVerifiedAt,
        contentHash: clue.contentHash,
        clueStrength: index + 1,
        topics: clue.signalTags,
      }))
      patch.push({ canonicalGameId: catalogGame.id, comments, dtfMode })
      compatibleItems.push({
        ...packItem,
        progressiveHints: comments,
      })
    } else {
      insufficient.push(catalogGame.id)
      globalReview.push({
        gameId: packItem.gameId,
        canonicalGameId: catalogGame.id,
        reason: 'insufficient_source_material',
        usableComments: chosen.length,
        requestedComments: 6,
      })
    }

    for (const clue of [...chosen, ...reserve]) {
      sourceRows.push({
        game: catalogGame.titleRu,
        canonicalGameId: catalogGame.id,
        commentId: clue.sourceCommentId,
        url: clue.sourceUrl,
        postUrl: clue.sourcePostUrl,
        publishedAt: clue.publishedAt,
        status: clue.sourceVerificationStatus,
        sourceVerifiedAt: clue.sourceVerifiedAt,
        published: chosenIds.has(clue.id),
      })
      editorRows.push({
        game: catalogGame.titleRu,
        order: clue.clueOrder ?? '',
        displayText: clue.displayText,
        source: clue.sourceUrl,
        signal: clue.signalTags.join('; '),
        difficulty: clue.difficulty ?? 'reserve',
        answerLeak: clue.containsDirectAnswer,
        moderation: clue.containsUnsafePersonalData ? 'review' : 'safe',
        status: chosenIds.has(clue.id) ? 'published' : 'reserve',
      })
    }
    for (const candidate of prepared.rejectedLocal ?? []) {
      globalCandidates.push({
        gameId: packItem.gameId,
        canonicalGameId: catalogGame.id,
        status: 'rejected_candidate',
        ...candidate,
      })
    }
    for (const candidate of verifiedCandidates.filter((row) => !chosenIds.has(row.id))) {
      globalCandidates.push({
        gameId: packItem.gameId,
        canonicalGameId: catalogGame.id,
        status: reserve.some((row) => row.id === candidate.id) ? 'reserve' : 'not_selected',
        ...candidate,
      })
    }
    for (const old of packItem.progressiveHints ?? []) {
      auditRows.push({
        game: catalogGame.titleRu,
        canonicalGameId: catalogGame.id,
        clueId: old.key,
        beforeStatus: 'legacy_editorial',
        afterStatus: 'unchanged_in_source_pack',
        action: 'preserve_source_file',
        reason: old.sourceId ? 'existing_source_id_preserved' : 'no_verifiable_dtf_source_in_legacy_clue',
      })
    }
    for (const clue of chosen) {
      auditRows.push({
        game: catalogGame.titleRu,
        canonicalGameId: catalogGame.id,
        clueId: clue.id,
        beforeStatus: 'absent',
        afterStatus: 'verified_dtf_comment',
        action: 'add_to_compatible_patch',
        reason: 'public_comment_verified',
      })
    }
  }

  const duplicateCommentIds = sourceRows
    .map((row) => row.commentId)
    .filter((id, index, all) => all.indexOf(id) !== index)
  const duplicateHashes = publishedItems
    .flatMap((item) => item.dtfMode.publishedClues.map((clue) => clue.contentHash))
    .filter((hash, index, all) => all.indexOf(hash) !== index)
  const validationErrors = []
  const catalogIds = new Set(catalog.map((item) => item.id))
  if (publishedItems.some((item) => !catalogIds.has(item.canonicalGameId))) validationErrors.push('published DTF item without canonical game')
  if (publishedItems.some((item) => item.dtfMode.publishedClues.length !== 6)) validationErrors.push('published DTF game without six clues')
  if (publishedItems.some((item) => item.dtfMode.publishedClues.some((clue) => !clue.sourceUrl || !clue.sourceVerifiedAt))) validationErrors.push('published clue without verified source')
  if (duplicateCommentIds.length) validationErrors.push(`duplicate sourceCommentId: ${uniqueStrings(duplicateCommentIds).join(', ')}`)
  if (duplicateHashes.length) validationErrors.push(`duplicate contentHash: ${uniqueStrings(duplicateHashes).join(', ')}`)
  if (publishedItems.some((item) => item.dtfMode.publishedClues.some((clue) => clue.containsDirectAnswer))) validationErrors.push('answer leak in published clue')
  if (publishedItems.some((item) => item.dtfMode.publishedClues.some((clue, index) => clue.clueOrder !== index + 1))) validationErrors.push('non-sequential clueOrder')
  if (validationErrors.length) throw new Error(`DTF validation failed:\n- ${validationErrors.join('\n- ')}`)

  const enrichedDocument = {
    schemaVersion: 1,
    generatedAt: now,
    sourcePolicy: 'Only public DTF comments with a repeatable source URL; no generated comments.',
    verificationMode: verifySources ? 'live_public_api' : 'local_public_snapshot',
    poolId: 'dtf-comments',
    items: publishedItems,
    insufficientSourceMaterial: insufficient,
  }
  const compatiblePack = {
    ...pack,
    schemaVersion: 1,
    pack: {
      ...pack.pack,
      id: `${pack.pack.id}-sourced-v2`,
      slug: `${pack.pack.slug}-sourced-v2`,
      subtitle: `Спецпоказ DTF · ${compatibleItems.length} игр с проверяемыми источниками`,
      itemCount: compatibleItems.length,
      publicationStatus: 'editorial_review',
      rightsStatus: 'public_short_excerpts_with_source',
      uiCopy: {
        ...pack.pack.uiCopy,
        disclaimer: 'Короткие фрагменты публичных комментариев DTF; источники сохранены для редакционной проверки.',
      },
    },
    items: compatibleItems,
  }
  const sourceColumns = ['game', 'canonicalGameId', 'commentId', 'url', 'postUrl', 'publishedAt', 'status', 'sourceVerifiedAt', 'published']
  const auditColumns = ['game', 'canonicalGameId', 'clueId', 'beforeStatus', 'afterStatus', 'action', 'reason']
  const editorColumns = ['game', 'order', 'displayText', 'source', 'signal', 'difficulty', 'answerLeak', 'moderation', 'status']
  const report = `# Отчёт: DTF-комментарии

Дата: ${now}

## Итог

- Игр в старом DTF-паке: **${pack.items.length}**
- Игр с полным проверяемым набором: **${publishedItems.length}**
- Опубликованных комментариев в новом наборе: **${publishedItems.reduce((sum, item) => sum + item.dtfMode.publishedClues.length, 0)}**
- Резервных комментариев: **${publishedItems.reduce((sum, item) => sum + item.dtfMode.reserveClues.length, 0)}**
- Игр с \`insufficient_source_material\`: **${insufficient.length}**
- Комментариев/игр в редакционной очереди: **${globalReview.length}**
- Неподтверждённых источников среди опубликованных: **0**

## Политика

Использованы только комментарии из публичного DTF-корпуса. Текст не генерировался и не стилизовался. Допускалось только точное короткое извлечение и минимальное скрытие прямого названия; исходный фрагмент и displayText хранятся отдельно.

Старый production-пак не перезаписан: у его подсказок нет достаточных source ID/URL, а ТЗ запрещает молча заменять вручную отредактированные поля. Вместо этого создан совместимый sourced-v2 пакет и патч к каноническим карточкам для редакционного принятия.

## Недостаточный материал

${insufficient.length ? insufficient.map((id) => `- ${id}`).join('\n') : '- Нет'}

## Проверки

- Все published canonicalGameId существуют в основном каталоге.
- У каждой опубликованной игры ровно шесть комментариев.
- Каждый опубликованный комментарий имеет sourceCommentId, URL, post URL, contentHash и sourceVerifiedAt.
- Нет дублей sourceCommentId и contentHash.
- displayText не содержит основное название или алиас ответа.
- clueOrder уникален и последователен.
- Unsafe-кандидаты не попали в опубликованный набор.

## Повторный запуск

\`\`\`powershell
npm run data:enrich:games:dtf -- --verify-sources
\`\`\`
`

  await Promise.all([
    writeAtomic(paths.enriched, enrichedDocument),
    writeAtomic(paths.candidates, { schemaVersion: 1, generatedAt: now, items: globalCandidates }),
    writeAtomic(paths.review, { schemaVersion: 1, generatedAt: now, items: globalReview }),
    writeAtomic(paths.sources, toCsv(sourceColumns, sourceRows)),
    writeAtomic(paths.audit, toCsv(auditColumns, auditRows)),
    writeAtomic(paths.editor, toCsv(editorColumns, editorRows)),
    writeAtomic(paths.report, report),
    writeAtomic(paths.patch, { schemaVersion: 1, generatedAt: now, items: patch }),
    writeAtomic(paths.compatiblePack, compatiblePack),
  ])

  console.log(JSON.stringify({
    verificationMode: verifySources ? 'live_public_api' : 'local_public_snapshot',
    existingGames: pack.items.length,
    publishedGames: publishedItems.length,
    publishedComments: publishedItems.reduce((sum, item) => sum + item.dtfMode.publishedClues.length, 0),
    reserveComments: publishedItems.reduce((sum, item) => sum + item.dtfMode.reserveClues.length, 0),
    insufficientSourceMaterial: insufficient,
    reviewRequired: globalReview.length,
    outputDir,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})

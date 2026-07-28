#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cleanText,
  containsObfuscatedNumberedAnswer,
  naturalGameReference,
  normalizeTitle,
  uniqueStrings,
} from './enrichment-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = new Set(process.argv.slice(2))
const writePack = args.has('--write')
const packPath = resolve(root, 'data/promo/dtf-game-comments-25-v1.json')
const selectionPath = resolve(root, 'data/promo/dtf-game-comments-25-v1-selection.json')
const corpusRoot = resolve(root, 'dtf_25_games_scraping_pack/dtf-25-games-corpus')
const reportPath = resolve(root, 'data/games/enriched/dtf/games-dtf-curated-pack-report.md')
const userAgent = 'shoditsa-dtf-curated-pack/1.0 (+https://shoditsa.ru/)'
const today = new Date().toISOString().slice(0, 10)

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const readJsonl = async (path) => (await readFile(path, 'utf8'))
  .split(/\r?\n/u)
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
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': userAgent,
          referer: 'https://dtf.ru/',
        },
        signal: AbortSignal.timeout(45_000),
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((done) => setTimeout(done, attempt * 800))
      }
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

const nullableCount = (value) => {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null
}

const dtfAvatarUrl = (value) => {
  const raw = value && typeof value === 'object'
    ? value.data?.uuid ?? value.uuid ?? value.data?.url ?? value.url
    : value
  const avatar = cleanText(raw)
  if (!avatar) return null
  return /^https?:\/\//iu.test(avatar)
    ? avatar
    : `https://leonardo.osnova.io/${avatar}/-/scale_crop/96x96/`
}

const liveCommentRecord = (comment) => {
  const author = comment?.author && typeof comment.author === 'object' ? comment.author : {}
  const authorId = cleanText(author.id)
  const publishedTimestamp = Number(comment?.date)
  return {
    text: cleanText(comment?.text),
    authorId: authorId || null,
    authorName: cleanText(author.nickname || author.name || author.uri) || null,
    authorAvatarUrl: dtfAvatarUrl(author.avatar),
    authorProfileUrl: authorId ? `https://dtf.ru/id${authorId}` : null,
    authorIsVerified: Boolean(author.isVerified),
    authorIsPlus: Boolean(author.isPlus),
    publishedAt: Number.isFinite(publishedTimestamp) && publishedTimestamp > 0
      ? new Date(publishedTimestamp * 1000).toISOString()
      : null,
    likesCount: nullableCount(comment?.likes?.counterLikes),
    dislikesCount: nullableCount(comment?.likes?.counterDislikes),
    replyCount: nullableCount(comment?.replyCount),
    reactionCounts: Object.fromEntries((comment?.reactions?.counters ?? [])
      .map((reaction) => [cleanText(reaction?.id), nullableCount(reaction?.count)])
      .filter(([id, count]) => id && count != null)),
  }
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
      rows.set(String(current.id), liveCommentRecord(current))
    }
    if (Array.isArray(current)) stack.push(...current)
    else stack.push(...Object.values(current))
  }
  return rows
}

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const sourceUrl = (postUrl, commentId) => {
  const url = new URL(postUrl)
  url.searchParams.set('comment', String(commentId))
  return url.toString()
}

const answerAliases = (answerRef) => uniqueStrings([
  answerRef.titleRu,
  answerRef.titleOriginal,
  ...(answerRef.aliases ?? []),
]).filter((value) => normalizeTitle(value).length >= 4)

const gameReference = (prefix, suffix, sequel = false) => {
  if (sequel) return naturalGameReference(prefix, suffix, true)
  if (/(?:^|[^\p{L}\p{N}])(?:фанат|фанаты|разработчики|разработчиков|создатели|создателей)\s*$/iu.test(prefix)) {
    return 'этой игры'
  }
  if (/(?:^|[^\p{L}\p{N}])(?:в|на)\s*$/iu.test(prefix)) return 'этой игре'
  if (/(?:^|[^\p{L}\p{N}])(?:о|об)\s*$/iu.test(prefix)) return 'этой игре'
  return naturalGameReference(prefix, suffix, false)
}

const applyManualRedactions = (source, redactions, context) => {
  let displayText = source
  let count = 0
  for (const pair of redactions ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error(`${context}: invalid manual redaction`)
    }
    const [from, to] = pair.map(String)
    const occurrences = displayText.split(from).length - 1
    if (occurrences !== 1) {
      throw new Error(`${context}: manual redaction source must occur exactly once: ${JSON.stringify(from)} (found ${occurrences})`)
    }
    displayText = displayText.replace(from, to)
    count += 1
  }
  return { displayText, count }
}

const redactAnswer = (source, answerRef, manualRedactions, context) => {
  const manual = applyManualRedactions(source, manualRedactions, context)
  let displayText = manual.displayText
  let replacements = manual.count
  const aliases = answerAliases(answerRef).sort((left, right) => right.length - left.length)
  for (const alias of aliases) {
    const canHideSequelNumber = !/(?:^|\s)(?:2|ii)$/iu.test(normalizeTitle(alias))
    const sequelSuffix = canHideSequelNumber ? '(\\s+2)?' : '()'
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(alias)}${sequelSuffix}(?![\\p{L}\\p{N}])`, 'giu')
    displayText = displayText.replace(pattern, (match, sequelNumber, offset, fullText) => {
      replacements += 1
      const matchOffset = typeof offset === 'number' ? offset : fullText.indexOf(match)
      return gameReference(
        fullText.slice(0, matchOffset),
        fullText.slice(matchOffset + match.length),
        Boolean(sequelNumber),
      )
    })
  }
  displayText = cleanText(displayText)
    .replace(/эта игра\s+шикарное произведение/giu, 'эта игра — шикарное произведение')
    .replace(/эта игра\s+неиронично крутая игра/giu, 'это неиронично крутая игра')
    .replace(/эта игра\s+самая продаваемая игра/giu, 'это самая продаваемая игра')
    .replace(/эта игра,\s+продавшийся/giu, 'эта игра, продавшаяся')
    .replace(/,\s+имевший/giu, ', имевшая')
    .replace(/\s+его державший/giu, ' её державшая')
    .replace(/эту игру,\s+которого/giu, 'эту игру, которую')
    .replace(/эта игра\s+прекрасен/giu, 'эта игра прекрасна')
    .replace(/продолжение этой игры\s+-\s+/giu, 'продолжение этой игры — ')
    .replace(/(^|[.!?]\s+|>\s*)(эта игра|этой игры|эту игру|этой игре|это неиронично|это самая|продолжение этой игры)/giu, (_match, lead, phrase) => (
      `${lead}${phrase.charAt(0).toLocaleUpperCase('ru-RU')}${phrase.slice(1)}`
    ))

  const leakedAliases = aliases.filter((alias) => {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(alias)}(?![\\p{L}\\p{N}])`, 'iu')
    return pattern.test(displayText)
  })
  return {
    displayText,
    wasRedacted: replacements > 0,
    redactionReasons: replacements > 0 ? ['direct_answer'] : [],
    leakedAliases,
  }
}

const signalTags = (text) => {
  const value = text.toLocaleLowerCase('ru-RU')
  const tags = []
  if (/механик|управлен|инвентар|крафт|прокач|геймпле|боев|парир|уклон/.test(value)) tags.push('mechanics')
  if (/баг|вылет|оптимизац|fps|фпс|лаг|патч|загруз|эмулят/.test(value)) tags.push('technical')
  if (/сюжет|персонаж|финал|истори|квест/.test(value)) tags.push('story')
  if (/релиз|анонс|предзаказ|оценк|обзор|продаж|онлайн/.test(value)) tags.push('release-context')
  if (/мем|шут|смеш|угар|арка|рофл|ирони|ахах|суу+ка|day after/.test(value)) tags.push('community-humor')
  if (/донат|монетизац|магазин|батл.?пасс|battle.?pass/.test(value)) tags.push('monetization')
  if (/кооператив|кооп|друз|команд/.test(value)) tags.push('co-op')
  if (/атмосфер|музык|визуал|график|красив|стилист/.test(value)) tags.push('atmosphere')
  if (!tags.length) tags.push('player-experience')
  return tags
}

const sharpTonePattern = /(?:хуй\w*|хуе\w*|пизд\w*|ебан\w*|ебуч\w*|бля\w*|говн\w*|дерьм\w*|мудак\w*|долбоеб\w*|кринж\w*|сран\w*|нахуй)/iu
const embeddedUrlPattern = /https?:\/\//iu
const personalEmailPattern = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/iu
const personalPhonePattern = /(?:\+?\d[\s()-]*){10,}/u
const productKeyPattern = /\b(?:[A-Z0-9]{5}-){2}[A-Z0-9]{5}\b/u
const danglingEndingPattern = /\b(?:и|или|а|но|что|как|потому что|типа)$/iu

const normalizeSelectionComment = (value) => typeof value === 'string'
  ? { sourceId: value }
  : { ...value, sourceId: String(value.sourceId), postId: value.postId == null ? null : String(value.postId) }

const validateSelection = (pack, selection) => {
  if (selection.packId !== pack.pack.id) {
    throw new Error(`Selection targets ${selection.packId}, pack is ${pack.pack.id}`)
  }
  const commentsPerGame = Number(selection.editorialPolicy?.commentsPerGame)
  const unlocks = selection.editorialPolicy?.unlockAfterAttempts
  if (commentsPerGame !== 6 || JSON.stringify(unlocks) !== JSON.stringify([0, 0, 1, 2, 3, 4])) {
    throw new Error('Editorial policy must define six comments and unlocks [0,0,1,2,3,4]')
  }
  const packIds = pack.items.map((item) => item.gameId)
  const selectionIds = selection.games.map((item) => item.gameId)
  if (new Set(selectionIds).size !== selectionIds.length) throw new Error('Selection contains duplicate game IDs')
  if (packIds.length !== selectionIds.length || packIds.some((id) => !selectionIds.includes(id))) {
    throw new Error('Selection game IDs do not match pack game IDs')
  }
  const sourceIds = []
  for (const game of selection.games) {
    if (!Array.isArray(game.comments) || game.comments.length !== commentsPerGame) {
      throw new Error(`${game.gameId}: expected exactly ${commentsPerGame} comments`)
    }
    for (const value of game.comments) sourceIds.push(normalizeSelectionComment(value).sourceId)
  }
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error('Selection contains duplicate source comment IDs')
}

const main = async () => {
  const [pack, selection] = await Promise.all([readJson(packPath), readJson(selectionPath)])
  validateSelection(pack, selection)
  const selectionByGame = new Map(selection.games.map((game) => [game.gameId, game]))
  const preparedGames = []
  const requestedPostIds = new Set()

  for (const packItem of [...pack.items].sort((left, right) => left.order - right.order)) {
    const gameSelection = selectionByGame.get(packItem.gameId)
    const [comments, posts] = await Promise.all([
      readJsonl(resolve(corpusRoot, packItem.gameId, 'comments.jsonl')),
      readJsonl(resolve(corpusRoot, packItem.gameId, 'posts.jsonl')),
    ])
    const commentById = new Map(comments.map((comment) => [String(comment.comment_id), comment]))
    const postById = new Map(posts.map((post) => [String(post.post_id), post]))
    const preparedComments = gameSelection.comments.map((value) => {
      const editorial = normalizeSelectionComment(value)
      const snapshot = commentById.get(editorial.sourceId) ?? null
      const postId = editorial.postId ?? (snapshot?.post_id == null ? null : String(snapshot.post_id))
      if (!postId) throw new Error(`${packItem.gameId}/${editorial.sourceId}: source post is unknown`)
      const localPostUrl = postById.get(postId)?.canonical_url
      const postUrl = localPostUrl ?? selection.supplementalPosts?.[postId]
      if (!postUrl) throw new Error(`${packItem.gameId}/${editorial.sourceId}: source post URL is unknown`)
      if (snapshot?.is_deleted) throw new Error(`${packItem.gameId}/${editorial.sourceId}: local source is deleted`)
      requestedPostIds.add(postId)
      return {
        ...editorial,
        postId,
        postUrl,
        snapshotText: snapshot ? cleanText(snapshot.text) : null,
      }
    })
    preparedGames.push({ packItem, preparedComments })
  }

  const postIds = [...requestedPostIds]
  let verifiedPostCount = 0
  const liveRows = await mapLimit(postIds, 4, async (postId) => {
    const payload = await fetchJson(`https://api.dtf.ru/v2.10/comments?contentId=${postId}`)
    verifiedPostCount += 1
    process.stdout.write(`\rDTF: проверено обсуждений ${String(verifiedPostCount).padStart(2, ' ')}/${postIds.length}`)
    return [postId, flattenComments(payload)]
  })
  process.stdout.write('\n')
  const liveByPost = new Map(liveRows)
  const maxDisplayLength = Number(selection.editorialPolicy.maxDisplayLength)
  const unlockAfterAttempts = selection.editorialPolicy.unlockAfterAttempts
  const contentHashes = new Set()
  let sharpToneCount = 0
  let redactedCount = 0
  let totalLength = 0
  const reportRows = []
  const rebuiltItems = []

  for (const { packItem, preparedComments } of preparedGames) {
    const rebuiltHints = preparedComments.map((editorial, index) => {
      const context = `${packItem.gameId}/${editorial.sourceId}`
      const live = liveByPost.get(editorial.postId)?.get(editorial.sourceId)
      if (!live) throw new Error(`${context}: live DTF comment is unavailable`)
      if (!live.authorName || !live.authorAvatarUrl) throw new Error(`${context}: author metadata is incomplete`)
      if (/^Комментарий (?:недоступен|удалён)/iu.test(live.text)) throw new Error(`${context}: comment was removed`)
      if (editorial.snapshotText && normalizeTitle(editorial.snapshotText) !== normalizeTitle(live.text)) {
        throw new Error(`${context}: local snapshot does not match live DTF text`)
      }
      const sourceExcerpt = live.text
      const redaction = redactAnswer(
        sourceExcerpt,
        packItem.answerRef,
        editorial.redactions,
        context,
      )
      const displayText = redaction.displayText
      if (redaction.leakedAliases.length) {
        throw new Error(`${context}: direct answer remains: ${redaction.leakedAliases.join(', ')}`)
      }
      if (containsObfuscatedNumberedAnswer(displayText, answerAliases(packItem.answerRef))) {
        throw new Error(`${context}: obfuscated answer remains`)
      }
      if (displayText.length < 35) throw new Error(`${context}: display text is too short (${displayText.length})`)
      if (displayText.length > maxDisplayLength) {
        throw new Error(`${context}: display text is too long (${displayText.length} > ${maxDisplayLength})`)
      }
      if (embeddedUrlPattern.test(sourceExcerpt)) throw new Error(`${context}: embedded URL is not allowed`)
      if (personalEmailPattern.test(sourceExcerpt)) throw new Error(`${context}: personal email is not allowed`)
      if (personalPhonePattern.test(sourceExcerpt)) throw new Error(`${context}: personal phone is not allowed`)
      if (productKeyPattern.test(sourceExcerpt)) throw new Error(`${context}: product key is not allowed`)
      if (danglingEndingPattern.test(displayText)) throw new Error(`${context}: comment appears truncated`)
      const contentHash = `sha256:${sha256(normalizeTitle(sourceExcerpt))}`
      if (contentHashes.has(contentHash)) throw new Error(`${context}: duplicate comment content`)
      contentHashes.add(contentHash)
      if (sharpTonePattern.test(displayText)) sharpToneCount += 1
      if (redaction.wasRedacted) redactedCount += 1
      totalLength += displayText.length
      return {
        key: `dtf-${editorial.sourceId}`,
        text: displayText,
        unlockAfterAttempts: unlockAfterAttempts[index],
        type: 'player_comment',
        spoilerRisk: editorial.spoilerRisk ?? 'low',
        sourceId: editorial.sourceId,
        sourcePackId: pack.pack.id,
        sourceUrl: sourceUrl(editorial.postUrl, editorial.sourceId),
        sourcePostUrl: editorial.postUrl,
        sourceExcerpt,
        sourceVerifiedAt: today,
        contentHash,
        wasRedacted: redaction.wasRedacted,
        redactionReasons: redaction.redactionReasons,
        clueStrength: index + 1,
        topics: signalTags(displayText),
        authorId: live.authorId,
        authorName: live.authorName,
        authorAvatarUrl: live.authorAvatarUrl,
        authorProfileUrl: live.authorProfileUrl,
        authorIsVerified: live.authorIsVerified,
        authorIsPlus: live.authorIsPlus,
        publishedAt: live.publishedAt,
        likesCount: live.likesCount,
        dislikesCount: live.dislikesCount,
        replyCount: live.replyCount,
        reactionCounts: live.reactionCounts,
      }
    })
    reportRows.push({
      gameId: packItem.gameId,
      redacted: rebuiltHints.filter((hint) => hint.wasRedacted).length,
      sharp: rebuiltHints.filter((hint) => sharpTonePattern.test(hint.text)).length,
      maxLength: Math.max(...rebuiltHints.map((hint) => hint.text.length)),
      sources: new Set(rebuiltHints.map((hint) => hint.sourcePostUrl)).size,
    })
    rebuiltItems.push({ ...packItem, progressiveHints: rebuiltHints })
  }

  const rebuiltPack = {
    ...pack,
    pack: {
      ...pack.pack,
      description: 'Специальная подборка для DTF: угадайте игру по настоящим комментариям пользователей.',
      itemCount: rebuiltItems.length,
      recommendedMaxAttempts: 6,
      experience: {
        ...pack.pack.experience,
        commentsPerGame: 6,
      },
    },
    items: rebuiltItems,
  }
  const report = [
    '# DTF comments pack — curated rebuild',
    '',
    `- Проверено: ${today}`,
    `- Игры: ${rebuiltItems.length}`,
    `- Комментарии: ${contentHashes.size}`,
    `- Источники-посты: ${requestedPostIds.size}`,
    `- Редакционные скрытия прямого ответа: ${redactedCount}`,
    `- Едкие/нецензурные комментарии, сохранённые в наборе: ${sharpToneCount}`,
    `- Средняя длина: ${Math.round(totalLength / contentHashes.size)} знаков`,
    `- Расписание открытия: ${unlockAfterAttempts.join(' → ')}`,
    '',
    '| Игра | Постов-источников | Скрыт ответ | Едких | Макс. длина |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...reportRows.map((row) => `| ${row.gameId} | ${row.sources} | ${row.redacted} | ${row.sharp} | ${row.maxLength} |`),
    '',
    'В наборе сознательно сохранены мат, сарказм и токсичная подача DTF. Удаляются только прямой ответ, сюжетные спойлеры, персональные данные, ключи, встроенные ссылки и оборванные цитаты.',
    '',
  ].join('\n')

  const summary = {
    mode: writePack ? 'write' : 'dry-run',
    games: rebuiltItems.length,
    comments: contentHashes.size,
    sourcePosts: requestedPostIds.size,
    redacted: redactedCount,
    sharpToneRetained: sharpToneCount,
    averageLength: Math.round(totalLength / contentHashes.size),
    maxLength: Math.max(...reportRows.map((row) => row.maxLength)),
    unlockAfterAttempts,
  }
  if (writePack) {
    await Promise.all([
      writeAtomic(packPath, rebuiltPack),
      writeAtomic(reportPath, report),
    ])
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})

#!/usr/bin/env tsx

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { TitleItem } from '@shoditsa/contracts'
import {
  mergeDtfComments,
  resolveDtfPack,
  type DtfCatalogGame,
  type DtfPackDocument,
} from '../../apps/api/src/modules/packs/dtf-comment-merge.js'

const args = process.argv.slice(2)
const hasFlag = (name: string) => args.includes(`--${name}`)
const argValue = (name: string, fallback: string) => {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback
}

const sourcePath = resolve(process.cwd(), argValue('source', 'data/promo/dtf-game-comments-25-v1.json'))
const libraryPath = resolve(process.cwd(), argValue('library', 'public/data/libraries/games/items.json'))
const write = hasFlag('write')

const document = JSON.parse(await readFile(sourcePath, 'utf8')) as DtfPackDocument
const library = JSON.parse(await readFile(libraryPath, 'utf8')) as TitleItem[]
const games: DtfCatalogGame[] = library.map((payload) => ({
  itemId: payload.id,
  allowedInGame: payload.allowedInGame !== false,
  contentStatus: payload.contentStatus ?? null,
  popularityScore: Number(payload.popularityScore || 0),
  payload,
}))
const resolutions = resolveDtfPack(document, games)
const unresolved = resolutions.filter((resolution) => !resolution.catalog)
if (unresolved.length) {
  throw new Error(`Unresolved DTF games: ${unresolved.map(({ item }) => item.gameId).join(', ')}`)
}
const resolvedIds = resolutions.map((resolution) => resolution.catalog!.itemId)
const duplicateIds = [...new Set(resolvedIds.filter((id, index) => resolvedIds.indexOf(id) !== index))]
if (duplicateIds.length) throw new Error(`Duplicate canonical bindings: ${duplicateIds.join(', ')}`)

const commentsById = new Map(resolutions.map((resolution) => [
  resolution.catalog!.itemId,
  resolution.item.progressiveHints,
]))
let changed = 0
let comments = 0
const merged = library.map((payload) => {
  const incoming = commentsById.get(payload.id)
  if (!incoming) return payload
  comments += incoming.length
  const next = mergeDtfComments(payload, incoming, document.pack.id)
  if (JSON.stringify(next) !== JSON.stringify(payload)) changed += 1
  return next
})

if (write && changed) {
  await writeFile(libraryPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
}

console.log(JSON.stringify({
  mode: write ? 'write' : 'check',
  packId: document.pack.id,
  libraryPath,
  libraryItems: library.length,
  selectedGames: resolutions.length,
  mergedComments: comments,
  changedGames: changed,
  bindings: resolutions.map((resolution) => ({
    gameId: resolution.item.gameId,
    itemId: resolution.catalog!.itemId,
    method: resolution.method,
    comments: resolution.item.progressiveHints.length,
  })),
}, null, 2))

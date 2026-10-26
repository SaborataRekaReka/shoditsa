import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { normalizeWord } from '@shoditsa/contracts'

type PackManifest = {
  schemaVersion: number; engine: string; model: string; vocabularyCount: number; targetCount: number; targets: string[]
  files: Record<'vocabulary.json' | 'ranks.u16', { bytes: number; sha256: string }>
}
export type WordPack = {
  hash: string; words: string[]; targetKeys: string[]; vocabularySize: number
  resolveWord: (input: string) => { key: string; word: string; index: number } | null
  rank: (target: string, index: number) => number
  wordAtRank: (target: string, rank: number) => string | null
}
const hashBytes = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const cache = new Map<string, Promise<WordPack>>()

export async function readWordPack(hash: string, root = resolve(process.env.SEMANTIC_CONTENT_ROOT ?? 'data/semantic/runtime')): Promise<WordPack> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid semantic content hash')
  const cacheKey = `${root}:${hash}`
  const old = cache.get(cacheKey)
  if (old) return old
  const pending = loadWordPack(hash, root)
  cache.set(cacheKey, pending)
  try { return await pending } catch (error) { cache.delete(cacheKey); throw error }
}

async function loadWordPack(hash: string, root: string): Promise<WordPack> {
  const folder = join(root, hash)
  const raw = await readFile(join(folder, 'manifest.json'))
  if (hashBytes(raw) !== hash) throw new Error('Semantic manifest checksum mismatch')
  const manifest = JSON.parse(raw.toString('utf8')) as PackManifest
  if (manifest.schemaVersion !== 1 || manifest.engine !== 'semantic_word' || !Number.isInteger(manifest.vocabularyCount) || manifest.vocabularyCount < 1000 || manifest.vocabularyCount >= 65535 || manifest.targetCount !== manifest.targets?.length || new Set(manifest.targets).size !== manifest.targetCount) throw new Error('Invalid semantic manifest')
  const assets = await Promise.all((['vocabulary.json', 'ranks.u16'] as const).map(async name => {
    const bytes = await readFile(join(folder, name))
    if (bytes.length !== manifest.files[name]?.bytes || hashBytes(bytes) !== manifest.files[name]?.sha256) throw new Error(`Semantic asset checksum mismatch: ${name}`)
    return bytes
  }))
  const vocabulary = JSON.parse(assets[0].toString('utf8')) as { words: string[]; aliases: Record<string, string> }
  const words = vocabulary.words
  const keys = words.map(normalizeWord)
  if (words.length !== manifest.vocabularyCount || new Set(keys).size !== words.length || words.some(word => !/^[а-яё]{3,24}$/.test(word))) throw new Error('Invalid semantic vocabulary')
  if (assets[1].length !== words.length * manifest.targets.length * 2) throw new Error('Invalid semantic ranks size')
  const byKey = new Map(keys.map((word, index) => [word, index]))
  const targetIndices = new Map(manifest.targets.map((word, index) => [word, index]))
  const rank = (target: string, index: number) => {
    const row = targetIndices.get(target)
    if (row == null || !Number.isInteger(index) || index < 0 || index >= words.length) throw new Error('Unknown semantic rank')
    return assets[1].readUInt16LE((row * words.length + index) * 2)
  }
  for (const target of manifest.targets) {
    const index = byKey.get(target)
    if (index == null || rank(target, index) !== 1) throw new Error('Invalid semantic self rank')
  }
  return {
    hash, words, targetKeys: manifest.targets, vocabularySize: words.length,
    resolveWord(input) {
      const normalized = normalizeWord(input)
      if (!/^[а-я]{3,24}$/.test(normalized)) return null
      const canonical = byKey.has(normalized) ? normalized : vocabulary.aliases[normalized]
      const index = canonical == null ? undefined : byKey.get(canonical)
      return index == null ? null : { key: keys[index], word: words[index], index }
    },
    rank,
    wordAtRank(target, requested) {
      if (!Number.isInteger(requested) || requested < 2 || requested > words.length) return null
      for (let index = 0; index < words.length; index += 1) if (rank(target, index) === requested) return words[index]
      return null
    },
  }
}

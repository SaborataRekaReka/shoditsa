import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const source = process.argv.find(arg => arg.startsWith('--source='))?.slice(9) ?? 'public/data/libraries/words/items.json'
const root = process.argv.find(arg => arg.startsWith('--runtime='))?.slice(10) ?? 'data/semantic/runtime'
const items = JSON.parse(await readFile(resolve(source), 'utf8'))
assert.equal(items.length, 180, 'Release requires 180 admitted answers')
assert.equal(new Set(items.map(item => item.id)).size, items.length)
const groups = Map.groupBy(items, item => item.semanticDatasetHash)
for (const [fingerprint, entries] of groups) {
  assert.match(fingerprint, /^[a-f0-9]{64}$/)
  const folder = join(root, fingerprint)
  const raw = await readFile(join(folder, 'manifest.json'))
  assert.equal(hash(raw), fingerprint, 'Immutable manifest identity')
  const manifest = JSON.parse(raw)
  assert.equal(manifest.engine, 'semantic_word')
  assert.equal(manifest.targetCount, entries.length)
  const assets = {}
  for (const name of ['vocabulary.json', 'ranks.u16']) {
    assets[name] = await readFile(join(folder, name))
    assert.equal(hash(assets[name]), manifest.files[name].sha256, name)
    assert.equal(assets[name].length, manifest.files[name].bytes, name)
  }
  const vocabulary = JSON.parse(assets['vocabulary.json'])
  const normalize = word => word.normalize('NFC').trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е')
  const keys = vocabulary.words.map(normalize)
  assert.equal(keys.length, manifest.vocabularyCount)
  assert.ok(keys.length > 25_000 && keys.length < 65_535)
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(vocabulary.words.every(word => /^[а-яё]{3,24}$/.test(word)))
  const byKey = new Map(keys.map((key, index) => [key, index]))
  for (const [alias, canonical] of Object.entries(vocabulary.aliases)) {
    assert.match(alias, /^[а-я]{3,24}$/)
    assert.ok(byKey.has(canonical), `Unknown alias ${alias}`)
    assert.ok(!byKey.has(alias), `Alias shadows canonical ${alias}`)
  }
  assert.equal(assets['ranks.u16'].length, entries.length * keys.length * 2)
  for (const [row, target] of manifest.targets.entries()) {
    const item = entries.find(item => item.semanticWordKey === target)
    assert.ok(item, `Missing target ${target}`)
    assert.equal(item.id, `word:${target}`)
    assert.equal(item.mode, 'word')
    assert.equal(item.allowedInGame, true)
    assert.equal(item.contentStatus, 'ready')
    assert.equal(normalize(item.titleRu), target)
    const seen = new Uint8Array(keys.length + 1)
    for (let column = 0; column < keys.length; column++) {
      const rank = assets['ranks.u16'].readUInt16LE((row * keys.length + column) * 2)
      assert.ok(rank >= 1 && rank <= keys.length && !seen[rank], `Invalid rank permutation ${target}`)
      seen[rank] = 1
    }
    assert.equal(assets['ranks.u16'].readUInt16LE((row * keys.length + byKey.get(target)) * 2), 1, target)
  }
  console.log(`Semantic pack verified: ${keys.length} words, ${Object.keys(vocabulary.aliases).length} aliases, ${entries.length} answers. SHA256 ${fingerprint}`)
}

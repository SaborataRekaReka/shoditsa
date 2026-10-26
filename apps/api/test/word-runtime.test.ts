import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { normalizeWord } from '@shoditsa/contracts'
import { readWordPack } from '../src/modules/word/runtime.js'

describe('semantic runtime dictionary', () => {
  it('normalizes Russian input, inflections and е/ё with a fixed vocabulary', async () => {
    const audit = JSON.parse(await readFile('data/semantic/generated/pack-audit.json', 'utf8'))
    const pack = await readWordPack(audit.manifestSha256)
    expect(pack.vocabularySize).toBe(29_558)
    expect(pack.resolveWord('  САМОЛЕТ  ')?.key).toBe('самолет')
    expect(pack.resolveWord('самолёт')?.index).toBe(pack.resolveWord('самолет')?.index)
    expect(pack.resolveWord('молока')?.key).toBe('молоко')
    expect(pack.resolveWord('леса')?.key).toBe('лес')
    expect(pack.resolveWord('деревья')?.key).toBe('дерево')
    for (const input of ['', 'два слова', 'word', '<script>', '123', 'ё'.repeat(25)]) expect(pack.resolveWord(input)).toBeNull()
    for (const target of pack.targetKeys) {
      expect(pack.rank(target, pack.resolveWord(target)!.index)).toBe(1)
      expect(pack.wordAtRank(target, 1)).toBeNull()
      expect(pack.wordAtRank(target, 2)).not.toBe(pack.resolveWord(target)!.word)
    }
  })
  it('rejects path traversal and invalid ranks', async () => {
    await expect(readWordPack('../manifest')).rejects.toThrow('Invalid semantic content hash')
    const audit = JSON.parse(await readFile('data/semantic/generated/pack-audit.json', 'utf8'))
    const pack = await readWordPack(audit.manifestSha256)
    expect(() => pack.rank('unknown', 0)).toThrow()
    expect(() => pack.rank(pack.targetKeys[0], -1)).toThrow()
    expect(normalizeWord(' БЕРЁЗА ')).toBe('береза')
  })
})

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import type { TitleItem } from '@shoditsa/contracts'
import { compareTitles } from '@shoditsa/game-core'
import { LIBRARIES } from '../content/lib.js'

const output = resolve('./packages/game-core/test/fixtures/compare-golden.json')
const result: Record<string, unknown> = {}
for (const library of LIBRARIES) {
  const items = JSON.parse(await readFile(resolve(`./public/data/libraries/${library.dir}/items.json`), 'utf8')) as TitleItem[]
  const answer = items[20]
  result[library.mode] = {
    answerId: answer.id,
    cases: items.slice(0, 20).map((guess) => ({
      guessId: guess.id,
      output: compareTitles(guess, answer),
      digest: createHash('sha256').update(JSON.stringify(compareTitles(guess, answer))).digest('hex'),
    })),
  }
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(`Wrote ${output}`)

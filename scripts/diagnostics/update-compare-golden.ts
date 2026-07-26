import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GAME_MODE_MANIFEST,
  PLAYABLE_MODE_IDS,
  type TitleItem,
  type TitleMode,
} from '@shoditsa/contracts'
import { compareTitles } from '../../packages/game-core/src/index.js'

type GoldenCase = {
  guessId: string
  output: ReturnType<typeof compareTitles>
  digest: string
}

type GoldenFixture = Partial<Record<TitleMode, {
  answerId: string
  cases: GoldenCase[]
}>>

const root = process.cwd()
const fixturePath = resolve(root, 'packages/game-core/test/fixtures/compare-golden.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as GoldenFixture
const changed: Array<{ mode: TitleMode; guessId: string; keys: string[] }> = []

for (const mode of PLAYABLE_MODE_IDS) {
  const modeFixture = fixture[mode]
  if (!modeFixture) continue
  const dataDir = GAME_MODE_MANIFEST[mode].dataDir
  const items = JSON.parse(readFileSync(
    resolve(root, `public/data/libraries/${dataDir}/items.json`),
    'utf8',
  )) as TitleItem[]
  const byId = new Map(items.map((item) => [item.id, item]))
  const answer = byId.get(modeFixture.answerId)
  if (!answer) throw new Error(`Missing ${mode} answer ${modeFixture.answerId}`)

  for (const entry of modeFixture.cases) {
    const guess = byId.get(entry.guessId)
    if (!guess) throw new Error(`Missing ${mode} guess ${entry.guessId}`)
    const output = compareTitles(guess, answer)
    const digest = createHash('sha256').update(JSON.stringify(output)).digest('hex')
    if (digest !== entry.digest) {
      changed.push({ mode, guessId: entry.guessId, keys: output.map((hint) => hint.key) })
    }
    entry.output = output
    entry.digest = digest
  }
}

writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ changed: changed.length, cases: changed }, null, 2))

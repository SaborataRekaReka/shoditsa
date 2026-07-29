import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packPath = resolve(process.cwd(), 'data/promo/dtf-game-comments-25-v1.json')
const document = JSON.parse(await readFile(packPath, 'utf8'))

const cleanCommentText = (value) => String(value ?? '')
  .replace(/^\s*>\s*/gmu, '')
  .replace(/А поч нет/giu, 'А почему нет')
  .trim()

for (const item of document.items ?? []) {
  if (!Array.isArray(item.progressiveHints) || item.progressiveHints.length !== 6) {
    throw new Error(`Expected six DTF comments for ${item.gameId ?? item.id}`)
  }

  if (item.gameId === 'cyberpunk-2077') {
    const smutaIndex = item.progressiveHints.findIndex((hint) => /Смута/u.test(hint.text))
    const voiceIndex = item.progressiveHints.findIndex((hint) => /озвучка Ви/iu.test(hint.text))
    if (smutaIndex >= 0 && voiceIndex >= 0 && smutaIndex > voiceIndex) {
      const [smutaHint] = item.progressiveHints.splice(smutaIndex, 1)
      item.progressiveHints.splice(voiceIndex, 0, smutaHint)
    }
  }

  item.progressiveHints = item.progressiveHints.map((hint, index) => ({
    ...hint,
    text: cleanCommentText(hint.text),
    unlockAfterAttempts: index,
    clueStrength: index + 1,
  }))
}

await writeFile(packPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
console.log(`Normalized ${document.items?.length ?? 0} DTF pack entries`)

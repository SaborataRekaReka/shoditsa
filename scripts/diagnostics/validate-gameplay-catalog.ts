import { isAllowedInRegularGame, musicEligibilityIssues } from '@shoditsa/game-core'
import type { TitleItem } from '@shoditsa/contracts'
import { loadLibraries } from '../content/lib.js'

const { libraries } = await loadLibraries()
const errors: string[] = []
const warnings: string[] = []

for (const library of libraries) {
  for (const rawItem of library.items) {
    const item = rawItem as TitleItem

    if (item.mode === 'series') {
      const hasSeasons = Number.isInteger(item.seasonsCount) && Number(item.seasonsCount) > 0
      if (!hasSeasons && isAllowedInRegularGame(item)) {
        errors.push(`${item.id}: series without seasonsCount entered the regular pool`)
      } else if (!hasSeasons) {
        warnings.push(`${item.id}: series is quarantined until seasonsCount is enriched`)
      }
    }

    if (item.mode === 'music') {
      const issues = musicEligibilityIssues(item)
      if (item.allowedInGame === true && issues.length) {
        errors.push(`${item.id}: playable music card is incomplete (${issues.join(', ')})`)
      }
    }

    if (item.mode === 'diagnosis' && !item.safetyDisclaimer?.trim()) {
      errors.push(`${item.id}: diagnosis has no safetyDisclaimer`)
    }

    if (item.mode === 'game') {
      if (item.releaseScope === 'release' && !item.releaseLabel?.trim()) {
        errors.push(`${item.id}: release-scoped game has no releaseLabel`)
      }
      if (item.releaseScope === 'title' && !(item.platforms?.length)) {
        errors.push(`${item.id}: title-scoped game has no platforms`)
      }
    }
  }
}

console.log(`Gameplay catalog validation: ${errors.length} errors, ${warnings.length} quarantined/incomplete records`)
if (warnings.length) console.log(warnings.slice(0, 10).map((warning) => `- ${warning}`).join('\n'))
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'))
  process.exitCode = 1
}

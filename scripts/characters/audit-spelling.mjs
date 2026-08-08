import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE = path.join(ROOT, 'data', 'characters', 'seeds', 'characters.expansion330.json')
const REPORT = path.join(ROOT, 'data', 'characters', 'reports', 'spelling.json')
const BATCH_SIZE = 12
const ACCEPTED = new Set([
  'character:apollo:знаменья',
  'character:artemis:обетов',
  'character:eurydice:невеста',
  'character:eurydice:рощи',
  'character:odin:древу',
  'character:heimdall:стерегёт',
  'character:heimdall:страж',
  'character:heimdall:асгарду',
  'character:beanstalk-giant:обладании',
  'character:dmitri-karamazov:приводя',
  'character:rosalind:переодетая',
  'character:rosalind:странница',
  'character:rosalind:лес',
  'character:emma-woodhouse:влиянии',
  'character:gavroche:беспризорник',
  'character:gavroche:мятежник',
  'character:claude-frollo:терзимый',
])

const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
if (!Array.isArray(source?.items) || source.items.length !== 330) throw new Error('Expected the 330-card character expansion')

const issues = []
for (let offset = 0; offset < source.items.length; offset += BATCH_SIZE) {
  const batch = source.items.slice(offset, offset + BATCH_SIZE)
  const texts = batch.map((item) => [
    item.plotHint,
    ...(item.characterRoles ?? []),
    ...(item.characterArchetypes ?? []),
    ...(item.characterAbilities ?? []),
    ...(item.characterSettings ?? []),
  ].join(' · ').replace(/[\r\n]+/g, ' '))
  const body = new URLSearchParams({ text: texts.join('\n'), lang: 'ru,en', options: '518' })
  const response = await fetch('https://speller.yandex.net/services/spellservice.json/checkText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) throw new Error(`Yandex Speller HTTP ${response.status}`)
  const result = await response.json()
  for (const issue of result) {
    const item = batch[issue.row]
    if (!item) continue
    issues.push({
      id: item.id,
      titleRu: item.titleRu,
      word: issue.word,
      suggestions: issue.s ?? [],
      code: issue.code,
      position: issue.pos,
    })
  }
}

const acceptedIssues = issues.filter((issue) => ACCEPTED.has(`${issue.id}:${issue.word.toLocaleLowerCase('ru-RU')}`))
const actionableIssues = issues.filter((issue) => !ACCEPTED.has(`${issue.id}:${issue.word.toLocaleLowerCase('ru-RU')}`))
const report = {
  checkedAt: new Date().toISOString(),
  total: source.items.length,
  issueCount: issues.length,
  actionableCount: actionableIssues.length,
  acceptedFalsePositiveCount: acceptedIssues.length,
  issues: actionableIssues,
  acceptedFalsePositives: acceptedIssues,
}
if (process.argv.includes('--write')) fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`character spelling audit: ${actionableIssues.length} actionable, ${acceptedIssues.length} accepted false positives across ${source.items.length} cards`)
for (const issue of actionableIssues) console.log(`${issue.id}: ${issue.word} -> ${(issue.suggestions ?? []).slice(0, 3).join(', ')}`)
if (process.argv.includes('--strict') && actionableIssues.length) process.exitCode = 1

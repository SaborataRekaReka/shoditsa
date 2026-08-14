import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stable(entry)]))
    : value
const hash = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const same = (left, right) => hash(left) === hash(right)
const fieldHash = (payload, field) => hash(Object.hasOwn(payload, field) ? { present: true, value: payload[field] } : { present: false })
const valueType = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

export const buildContentExchangeDocument = ({ candidates, manifest, snapshot, expected }) => {
  if (manifest?.source?.type !== 'active-revision' || !manifest.source.revision?.id) throw new Error('Manifest must identify an active revision')
  if (!Array.isArray(candidates) || !candidates.length) throw new Error('Review candidates are empty')
  if (expected != null && candidates.length !== expected) throw new Error(`Expected ${expected} candidates, found ${candidates.length}`)
  if (!Array.isArray(snapshot)) throw new Error('Snapshot must be an array')
  const cards = new Map(snapshot.map((card) => [card.id, card]))
  if (cards.size !== snapshot.length) throw new Error('Snapshot contains duplicate card IDs')
  const grouped = new Map()
  const seen = new Set()
  for (const candidate of candidates) {
    const key = `${candidate.cardId}\u0000${candidate.field}`
    if (seen.has(key)) throw new Error(`Duplicate proposal for ${candidate.cardId}.${candidate.field}`)
    seen.add(key)
    if (candidate.disposition !== 'human_review_required') throw new Error(`Candidate was not approved for human review: ${key}`)
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(candidate.field)) throw new Error(`Invalid field name: ${candidate.field}`)
    if (!candidate.sourceUrls?.some((url) => /^https:\/\//i.test(url))) throw new Error(`Missing evidence source: ${key}`)
    const card = cards.get(candidate.cardId)
    if (!card || card.mode !== candidate.mode) throw new Error(`Card is missing from the attested snapshot: ${candidate.cardId}`)
    if (!same(card[candidate.field], candidate.currentValue)) throw new Error(`Current value drifted for ${candidate.cardId}.${candidate.field}`)
    if (valueType(candidate.currentValue) !== valueType(candidate.proposedValue)) throw new Error(`Type mismatch for ${candidate.cardId}.${candidate.field}`)
    if (same(candidate.currentValue, candidate.proposedValue)) throw new Error(`Unchanged proposal for ${candidate.cardId}.${candidate.field}`)
    const entry = grouped.get(candidate.cardId) ?? { id: candidate.cardId, mode: candidate.mode, data: {} }
    entry.data[candidate.field] = candidate.proposedValue
    grouped.set(candidate.cardId, entry)
  }
  const fields = [...new Set(candidates.map((candidate) => candidate.field))].sort()
  const items = [...grouped.values()].sort((left, right) => left.id.localeCompare(right.id)).map((item) => {
    const card = cards.get(item.id)
    return {
      ...item,
      base: {
        revisionId: manifest.source.revision.id,
        itemVersionId: null,
        workspaceChangeVersion: null,
        payloadHash: hash(card),
        fieldHashes: Object.fromEntries(fields.map((field) => [field, fieldHash(card, field)])),
      },
      unsetFields: [],
    }
  })
  return {
    format: 'shoditsa-content-exchange', schemaVersion: 1, exportId: randomUUID(), exportedAt: new Date().toISOString(),
    source: { revisionId: manifest.source.revision.id, revisionVersion: manifest.source.revision.version },
    fields, items,
  }
}

const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const [key, ...rest] = entry.split('='); return [key.replace(/^--/, ''), rest.join('=')]
}))
if (args.candidates) {
  const parseJsonl = (text) => text.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
  const candidatePaths = args.candidates.split(',').map((entry) => path.resolve(entry.trim())).filter(Boolean)
  const [candidateGroups, manifest, snapshot] = await Promise.all([
    Promise.all(candidatePaths.map((candidatePath) => readFile(candidatePath, 'utf8').then(parseJsonl))),
    readFile(path.resolve(args.manifest), 'utf8').then(JSON.parse),
    readFile(path.resolve(args.snapshot), 'utf8').then(JSON.parse),
  ])
  const candidates = candidateGroups.flat()
  const document = buildContentExchangeDocument({ candidates, manifest, snapshot, expected: args.expected ? Number(args.expected) : null })
  const output = path.resolve(args.output ?? './var/factcheck/reviewed-content-exchange.json')
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ output, candidates: candidates.length, cards: document.items.length, fields: document.fields, revisionId: document.source.revisionId }, null, 2))
}

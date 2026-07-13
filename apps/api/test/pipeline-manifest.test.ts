import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPipelineResultManifest } from '../src/modules/admin/pipeline-manifest.js'

const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

const fixture = async (records: unknown[]) => {
  const root = await mkdtemp(join(tmpdir(), 'shoditsa-manifest-')); temporary.push(root)
  await mkdir(join(root, 'music', 'records'), { recursive: true })
  await writeFile(join(root, 'music', 'records', 'artist.json'), '{}')
  const manifest = join(root, 'music', 'manifest.json')
  await writeFile(manifest, JSON.stringify({ schemaVersion: 1, domain: 'music', runId: 'run-1', records }))
  return { root, manifest }
}

describe('pipeline result manifest', () => {
  it('returns exact output files and explicit item failures', async () => {
    const { root, manifest } = await fixture([
      { key: '0001_artist', status: 'review', path: 'music/records/artist.json', error: null },
      { key: '0002_failed', status: 'failed', path: null, error: 'source failed' },
    ])
    const result = await loadPipelineResultManifest(root, manifest, 'music')
    expect(result).toMatchObject([
      { key: '0001_artist', status: 'review', error: null },
      { key: '0002_failed', status: 'failed', file: null, error: 'source failed' },
    ])
    expect(result[0].file).toBe(join(root, 'music', 'records', 'artist.json'))
  })

  it('rejects duplicate keys and paths outside the enrichment root', async () => {
    const duplicate = await fixture([
      { key: 'same', status: 'review', path: 'music/records/artist.json' },
      { key: 'same', status: 'failed', path: null },
    ])
    await expect(loadPipelineResultManifest(duplicate.root, duplicate.manifest, 'music')).rejects.toThrow('Duplicate')
    const traversal = await fixture([{ key: 'escape', status: 'review', path: '../outside.json' }])
    await expect(loadPipelineResultManifest(traversal.root, traversal.manifest, 'music')).rejects.toThrow('escapes')
  })
})

import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const commitSha = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const manifest = {
  commitSha,
  builtAt: new Date().toISOString(),
  shell: { profile: true, footer: true, yandexSdk: false, serverAuthoritative: true, noPublicAnswerData: true },
}

await writeFile(resolve('dist/build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PLAYABLE_MODE_IDS } from '@shoditsa/contracts'

const commitSha = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const manifest = {
  commitSha,
  builtAt: new Date().toISOString(),
  playableModes: PLAYABLE_MODE_IDS,
  shell: {
    profile: true,
    footer: true,
    typedRoutes: true,
    canonicalModeManifest: true,
    yandexSdk: false,
    serverAuthoritative: true,
    noPublicAnswerData: true,
  },
}

const indexHtml = await readFile(resolve('dist/index.html'), 'utf8')
if (!/(?:src|href)="\/assets\//.test(indexHtml) || /(?:src|href)="\.\/assets\//.test(indexHtml)) {
  throw new Error('Production index must use root-relative /assets/ URLs for SPA deep-link refreshes')
}

const buildMeta = `<meta name="shoditsa-build-sha" content="${commitSha}">`
const versionedIndexHtml = indexHtml.replace('</head>', `  ${buildMeta}\n</head>`)
if (versionedIndexHtml === indexHtml) throw new Error('Production index is missing </head> for the build marker')

await writeFile(resolve('dist/index.html'), versionedIndexHtml, 'utf8')
await writeFile(resolve('dist/build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

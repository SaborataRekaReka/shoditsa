import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const repo = resolve(process.argv[2] ?? '')
const out = resolve('.tmp/mailings-release-20261023')
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
const sha = git('rev-parse', 'HEAD'), base = 'e17223ff13db7ce22719030c3aae517066471742'
if (!/^[a-f0-9]{40}$/.test(sha) || sha === base || git('status', '--porcelain', '--untracked-files=no')) throw new Error('Expected a committed, reviewed release')
if (git('diff', '--name-only', base, sha, '--', 'package.json', 'package-lock.json', ':(glob)**/package.json', 'apps/web', 'public')) throw new Error('Unexpected dependency or frontend changes')
mkdirSync(join(out, 'overlay'), { recursive: true })
const overlay = join(out, 'overlay')
cpSync(join(repo, 'apps/api/dist'), join(overlay, 'api-dist'), { recursive: true })
cpSync(join(repo, 'packages/database/migrations'), join(overlay, 'migrations'), { recursive: true })
cpSync(join(repo, 'docs/communications/autumn-2026'), join(overlay, 'mailing-content'), { recursive: true })
writeFileSync(join(overlay, 'Dockerfile'), `FROM shoditsa-api:${base}\nUSER root\nARG GIT_SHA\nENV GIT_SHA=\${GIT_SHA}\nENV MAILING_CONTENT_ROOT=/app/release-mailings/autumn-2026\nCOPY --chown=shoditsa:shoditsa api-dist /app/apps/api/dist\nCOPY --chown=shoditsa:shoditsa migrations /app/packages/database/migrations\nCOPY --chown=shoditsa:shoditsa mailing-content /app/release-mailings/autumn-2026\nUSER shoditsa\n`)
execFileSync('tar', ['-czf', join(out, 'api-overlay.tar.gz'), '-C', overlay, '.'])
const digest = createHash('sha256').update(readFileSync(join(out, 'api-overlay.tar.gz'))).digest('hex')
writeFileSync(join(out, 'artifacts.sha256'), `${digest}  api-overlay.tar.gz\n`)
const manifest = { sha, base, frontendBase: base, releaseType: 'api-worker-admin-html', migration: '0057_mailings', contentImports: false, mailingId: 'autumn-2026-v1', packagedAt: new Date().toISOString() }
writeFileSync(join(out, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ out, ...manifest }))

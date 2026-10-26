import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

// Run in the reviewed clean release worktree after web/API builds and static verification.
const OLD = '245be7c5cfeb61d323e44bef3508d603f6cfef58';
const SHA = process.env.RELEASE_SHA ?? process.argv[2];
if (!/^[a-f0-9]{40}$/.test(SHA ?? '') || SHA === OLD) throw new Error('Pass the new full commit SHA as argv[2] or RELEASE_SHA.');
const repo = resolve(process.env.RELEASE_REPO ?? process.cwd());
const out = resolve(process.env.RELEASE_ARTIFACTS ?? join(repo, '.tmp', `growth-release-${SHA}`));
const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
if (git(['rev-parse', 'HEAD']) !== SHA) throw new Error('Worktree HEAD does not match release SHA.');
if (git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('Refusing packaging with tracked worktree changes.');
const unchanged = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', ':(glob)**/package.json', 'packages/database/migrations'];
if (git(['diff', '--name-only', OLD, SHA, '--', ...unchanged])) throw new Error('Overlay release requires unchanged dependencies and migration tree.');
const migrationTree = git(['rev-parse', `${SHA}:packages/database/migrations`]);
if (migrationTree !== git(['rev-parse', `${OLD}:packages/database/migrations`])) throw new Error('Migration tree changed.');
const webManifest = JSON.parse(await fs.readFile(join(repo, 'dist/build-manifest.json'), 'utf8'));
if (webManifest.commitSha !== SHA) throw new Error('Web build SHA mismatch.');
for (const name of ['server.js', 'worker.js', 'migrate.js']) if (!(await fs.stat(join(repo, 'apps/api/dist', name))).isFile()) throw new Error(`Missing API output ${name}`);
const proof = JSON.parse(await fs.readFile(join(out, 'static-verified.json'), 'utf8'));
if (proof.old !== OLD || proof.sha !== SHA || proof.files !== 1866 || proof.mismatches.length || proof.extra.length || !Array.isArray(proof.entries)) throw new Error('Missing or mismatched static verification proof.');
const entries = [];
async function staticWalk(relative) {
  const path = join(repo, 'dist', relative), s = await fs.lstat(path);
  if (s.isSymbolicLink()) throw new Error('Static symlink is not allowed.');
  if (s.isDirectory()) for (const name of (await fs.readdir(path)).sort()) await staticWalk(`${relative}/${name}`);
  else if (s.isFile()) entries.push([relative, createHash('sha256').update(await fs.readFile(path)).digest('hex')]);
  else throw new Error('Unsupported static entry.');
}
for (const name of ['images', 'audio', 'media', '@symbol.svg']) await staticWalk(name);
entries.sort((a, b) => a[0].localeCompare(b[0]));
if (entries.length !== 1866 || createHash('sha256').update(JSON.stringify(entries)).digest('hex') !== proof.staticDigest) throw new Error('Local static assets changed after verification.');
const overlay = join(out, 'overlay');
await fs.mkdir(overlay); // Deliberately fail on an old partial package; no destructive cleanup.
await fs.cp(join(repo, 'apps/api/dist'), join(overlay, 'api-dist'), { recursive: true, errorOnExist: true });
await fs.writeFile(join(overlay, 'Dockerfile'), `FROM shoditsa-api:${OLD}\nUSER root\nARG GIT_SHA\nENV GIT_SHA=\${GIT_SHA}\nCOPY --chown=shoditsa:shoditsa api-dist /app/apps/api/dist\nUSER shoditsa\n`, { flag: 'wx' });
execFileSync('tar', ['-czf', join(out, 'api-overlay.tar.gz'), '-C', overlay, '.']);
const webFiles = [];
async function webWalk(relative) {
  const path = join(repo, 'dist', relative), s = await fs.lstat(path);
  if (s.isSymbolicLink()) throw new Error(`Web symlink is not allowed: ${relative}`);
  if (s.isDirectory()) for (const name of (await fs.readdir(path)).sort()) await webWalk(`${relative}/${name}`);
  else if (s.isFile()) webFiles.push(relative);
  else throw new Error('Unsupported web entry.');
}
for (const name of ['assets', 'seo', 'index.html', 'build-manifest.json', 'robots.txt', 'sitemap.xml', 'seo-manifest.json']) await webWalk(name);
const inventory = await fs.readdir(join(repo, 'dist'));
const expected = new Set(['images', 'audio', 'media', '@symbol.svg', 'assets', 'seo', 'index.html', 'build-manifest.json', 'robots.txt', 'sitemap.xml', 'seo-manifest.json']);
if (inventory.some(name => !expected.has(name))) throw new Error('Unknown dist entry would be omitted from the release.');
await fs.writeFile(join(out, 'web-files.list'), webFiles.join('\0') + '\0', { flag: 'wx' });
execFileSync('tar', ['-czf', join(out, 'web.tar.gz'), '--no-recursion', '--null', '-C', join(repo, 'dist'), '-T', join(out, 'web-files.list')]);
const manifest = { schemaVersion: 1, sha: SHA, old: OLD, packagedAt: new Date().toISOString(), unchangedDependencies: true, unchangedMigrations: true, migrationTree, staticFiles: 1866, staticDigest: proof.staticDigest, webFiles: webFiles.length, databaseMigrations: false, contentImports: false };
await fs.writeFile(join(out, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
const checksums = [];
for (const name of ['api-overlay.tar.gz', 'web.tar.gz', 'release-manifest.json', 'static-verified.json']) {
  const bytes = await fs.readFile(join(out, name));
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  console.log(`${name}: ${bytes.length} bytes`);
}
await fs.writeFile(join(out, 'artifacts.sha256'), checksums.join('\n') + '\n', { flag: 'wx' });
console.log(JSON.stringify({ out, ...manifest }));

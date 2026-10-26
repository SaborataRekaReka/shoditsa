import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

// Read-only production comparison; never copies or changes production files.
const OLD = '245be7c5cfeb61d323e44bef3508d603f6cfef58';
const SHA = process.env.RELEASE_SHA ?? process.argv[2];
if (!/^[a-f0-9]{40}$/.test(SHA ?? '') || SHA === OLD) throw new Error('Pass the new full commit SHA as argv[2] or RELEASE_SHA.');
const repo = resolve(process.env.RELEASE_REPO ?? process.cwd());
const out = resolve(process.env.RELEASE_ARTIFACTS ?? join(repo, '.tmp', `growth-release-${SHA}`));
const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
if (git(['rev-parse', 'HEAD']) !== SHA) throw new Error('Worktree HEAD does not match release SHA.');
if (git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('Tracked worktree changes must be committed before verification.');
const build = JSON.parse(await fs.readFile(join(repo, 'dist/build-manifest.json'), 'utf8'));
if (build.commitSha !== SHA) throw new Error('Web build was not produced for this SHA.');
const entries = [];
async function walk(relative) {
  const path = join(repo, 'dist', relative), stat = await fs.lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${relative}`);
  if (stat.isDirectory()) for (const name of (await fs.readdir(path)).sort()) await walk(`${relative}/${name}`);
  else if (stat.isFile()) entries.push([relative, createHash('sha256').update(await fs.readFile(path)).digest('hex')]);
  else throw new Error(`Unsupported static entry: ${relative}`);
}
for (const name of ['images', 'audio', 'media', '@symbol.svg']) await walk(name);
entries.sort((a, b) => a[0].localeCompare(b[0]));
if (entries.length !== 1866) throw new Error(`Expected 1866 unchanged static files, got ${entries.length}. Review inventory; do not bypass.`);
const staticDigest = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
const payload = `import fs from 'node:fs'; import {createHash} from 'node:crypto';
const entries=${JSON.stringify(entries)},bad=[];
for(const [p,h] of entries){try{const s=fs.lstatSync('/web/'+p);if(!s.isFile()||s.isSymbolicLink()||createHash('sha256').update(fs.readFileSync('/web/'+p)).digest('hex')!==h)bad.push(p)}catch{bad.push(p)}}
const allowed=new Set(entries.map(e=>e[0])),extra=[];
function walk(p){const s=fs.lstatSync('/web/'+p);if(s.isDirectory()){for(const n of fs.readdirSync('/web/'+p))walk(p+'/'+n)}else if(!allowed.has(p))extra.push(p)}
for(const p of ['images','audio','media','@symbol.svg'])walk(p);
console.log(JSON.stringify({old:'${OLD}',sha:'${SHA}',files:entries.length,staticDigest:'${staticDigest}',mismatches:bad,extra}));if(bad.length||extra.length)process.exitCode=1;`;
const remote = `test "$(readlink -f /opt/shoditsa/current)" = "/opt/shoditsa/releases/${OLD}" && docker run --rm -i --read-only --network none --cap-drop ALL --security-opt no-new-privileges --user 0 --mount type=bind,source=/opt/shoditsa/releases/${OLD}/web,target=/web,readonly shoditsa-api:${OLD} node --input-type=module`;
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'root@72.56.240.222', remote], { input: payload, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
if (result.status !== 0) throw new Error(`Static read-only comparison failed (exit ${result.status}). ${result.stderr.trim()} ${result.stdout.trim()}`);
const proof = JSON.parse(result.stdout.trim());
if (proof.files !== 1866 || proof.mismatches.length || proof.extra.length || proof.staticDigest !== staticDigest) throw new Error('Static proof is incomplete.');
await fs.mkdir(out, { recursive: true });
await fs.writeFile(join(out, 'static-verified.json'), JSON.stringify({ ...proof, verifiedAt: new Date().toISOString(), entries }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ files: proof.files, mismatches: 0, extra: 0, sha: SHA, old: OLD, staticDigest, proof: join(out, 'static-verified.json') }));

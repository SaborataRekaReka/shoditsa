import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const stage=process.argv[2],sha=process.argv[3];
if(!['prepare','build','backup','activate','verify'].includes(stage)||!/^[0-9a-f]{40}$/.test(sha??''))throw Error('Invalid release operation');
const result=spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15','root@72.56.240.222',`bash -s -- ${stage} ${sha}`],{input:readFileSync(new URL('./release.sh',import.meta.url)),timeout:900000,maxBuffer:20*1024*1024});
const out='.tmp/growth-release-20261015';mkdirSync(out,{recursive:true});
writeFileSync(`${out}/${stage}.log`,result.stdout.toString()+result.stderr.toString());
console.log(result.stdout.toString());console.error(result.stderr.toString());
process.exit(result.status??1);

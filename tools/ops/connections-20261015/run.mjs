import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const name=process.argv[2];
if(!['preflight','publish','verify','qa'].includes(name)) throw Error('Unexpected operation');
const source=resolve('tools/ops/connections-20261015',name+'.mjs');
const result=spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15','root@72.56.240.222','docker exec -i -w /app shoditsa-api-shoditsa-api-1 node --input-type=module'],{input:readFileSync(source),timeout:240000,maxBuffer:20*1024*1024});
if(result.status!==0) { console.error(result.stderr.toString().slice(0,4000));process.exit(result.status||1); }
const value=JSON.parse(result.stdout.toString());
mkdirSync('.tmp/growth-release-20261015',{recursive:true});
writeFileSync('.tmp/growth-release-20261015/'+name+'-receipt.json',JSON.stringify(value,null,2));
console.log(JSON.stringify(value));

import {build} from 'esbuild';
import {resolve} from 'node:path';
const alias=Object.fromEntries(['database','contracts','config','game-core','content-domain'].map(name=>['@shoditsa/'+name,resolve('packages',name,'src/index.ts')]));
const name=process.argv[2]??'publish';
if(!['publish','qa'].includes(name))throw Error('Unexpected build target');
await build({entryPoints:[`tools/ops/connections-20261015/${name}.ts`],outfile:`tools/ops/connections-20261015/${name}.mjs`,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',alias});
console.log(`Built isolated operational ${name} bundle; not executed`);

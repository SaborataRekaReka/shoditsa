// A fresh Windows checkout changes some line endings. Reuse only the original
// checkout's line endings after proving semantic bytes are otherwise identical.
// The following production check still requires full byte-for-byte equality.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.cwd(),'dist');
const original=resolve('C:/projects/dev/seans_starter_pack/public');
const changed=[];
async function walk(relative){
  for(const entry of await readdir(join(root,relative),{withFileTypes:true})){
    const path=join(relative,entry.name);
    if(entry.isDirectory())await walk(path);
    else if(entry.isFile()&&/\.(svg|json)$/.test(entry.name)){
      const before=await readFile(join(root,path),'utf8');
      const after=await readFile(join(original,path),'utf8');
      if(before.replaceAll('\r\n','\n')!==after.replaceAll('\r\n','\n'))throw Error(`Semantic asset difference: ${path}`);
      if(before!==after){await writeFile(join(root,path),after);changed.push(path);}
    }
  }
}
await walk('images');await walk('media');
console.log(JSON.stringify({generatedAssetsNormalized:changed.length,paths:changed}));

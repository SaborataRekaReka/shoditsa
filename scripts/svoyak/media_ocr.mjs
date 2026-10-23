// Local OCR only; the text is a fallible diagnostic, never semantic approval.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const modules=process.argv[2];
const {createWorker}=require(modules?path.join(modules,'tesseract.js'): 'tesseract.js');
const root=path.resolve('archive/local/svoyak-library/media');
const input=JSON.parse(await fs.readFile(path.join(root,'ocr-input.json'),'utf8'));
const todo=[];for(const item of input){try{await fs.access(item.output);}catch{todo.push(item);}}
let next=0,done=0;
await Promise.all(Array.from({length:3},async()=>{
 const worker=await createWorker(['eng','rus'],1,{langPath:path.join(root,'ocr-models'),gzip:false,cachePath:path.join(root,'ocr-models')});
 try{await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
  while(next<todo.length){const item=todo[next++];let result;
   try{const {data}=await worker.recognize(item.path);result={status:'machine_ocr',text:data.text,confidence:data.confidence,time:item.time,model:'tesseract.js eng+rus tessdata_fast',checked_at:new Date().toISOString(),note:'OCR can miss text, invent letters and misread stylized fonts.'};}
   catch(e){result={status:'error',error:String(e),text:'',time:item.time};}
   await fs.writeFile(item.output,JSON.stringify(result));done++;if(done%50===0||done===todo.length)console.log(`OCR: ${done}/${todo.length}`);
  }
 }finally{await worker.terminate();}
}));

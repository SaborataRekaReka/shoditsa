"""Local multilingual embeddings. Model weights are downloaded once; question text stays local."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import threading
import urllib.request

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / 'archive/local/svoyak-library'
MODEL_ID = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
REVISION = 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42'
MODEL = DATA / 'models' / 'multilingual-minilm'
FILES = ['tokenizer.json', 'onnx/model_quint8_avx2.onnx', 'config.json', '1_Pooling/config.json']


def download_model():
    manifest = {'id':MODEL_ID,'revision':REVISION,'license':'Apache-2.0',
                'source_url':'https://huggingface.co/'+MODEL_ID,'files':[],
                'downloaded_at':datetime.now(timezone.utc).isoformat()}
    for name in FILES:
        path = MODEL / name
        path.parent.mkdir(parents=True,exist_ok=True)
        if not path.exists():
            request = urllib.request.Request(f'https://huggingface.co/{MODEL_ID}/resolve/{REVISION}/{name}?download=true',headers={'User-Agent':'local-svoyak-library'})
            part = path.with_suffix(path.suffix+'.part')
            with urllib.request.urlopen(request,timeout=45) as response, part.open('wb') as out:
                size=0
                while chunk:=response.read(1024*1024):
                    size+=len(chunk)
                    if size>200*1024*1024:raise ValueError('Model file exceeds 200 MiB')
                    out.write(chunk)
            part.replace(path)
        with path.open('rb') as source:
            manifest['files'].append({'name':name,'bytes':path.stat().st_size,'sha256':hashlib.file_digest(source,'sha256').hexdigest()})
        print(f'Model asset ready: {name} ({path.stat().st_size} bytes)',flush=True)
    (MODEL/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


class Encoder:
    def __init__(self):
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.np=np
        self.lock=threading.RLock()
        self.tokenizer=Tokenizer.from_file(str(MODEL/'tokenizer.json'))
        self.tokenizer.enable_truncation(max_length=128)
        self.tokenizer.enable_padding(pad_id=0,pad_token='[PAD]')
        options=ort.SessionOptions()
        options.intra_op_num_threads=4
        options.inter_op_num_threads=1
        self.session=ort.InferenceSession(str(MODEL/'onnx/model_quint8_avx2.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
        self.inputs={n.name for n in self.session.get_inputs()}

    def encode(self,texts,batch_size=24,progress=False):
        np=self.np
        result=[]
        with self.lock:
            for start in range(0,len(texts),batch_size):
                encoded=self.tokenizer.encode_batch(texts[start:start+batch_size])
                inputs={'input_ids':np.array([e.ids for e in encoded],dtype=np.int64),
                        'attention_mask':np.array([e.attention_mask for e in encoded],dtype=np.int64),
                        'token_type_ids':np.array([e.type_ids for e in encoded],dtype=np.int64)}
                output=self.session.run(None,{k:v for k,v in inputs.items() if k in self.inputs})[0]
                if output.ndim==3:
                    mask=inputs['attention_mask'][:,:,None].astype(np.float32)
                    output=(output*mask).sum(axis=1)/np.maximum(mask.sum(axis=1),1e-9)
                output=output.astype(np.float32)
                output/=np.maximum(np.linalg.norm(output,axis=1,keepdims=True),1e-9)
                result.append(output)
                if progress and (start%(batch_size*6)==0 or start+batch_size>=len(texts)):
                    print(f'Embeddings: {min(start+batch_size,len(texts))}/{len(texts)}',flush=True)
        return np.concatenate(result) if result else np.empty((0,384),dtype=np.float32)


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    download_model()

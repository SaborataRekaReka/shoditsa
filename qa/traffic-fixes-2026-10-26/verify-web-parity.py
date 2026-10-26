import hashlib, json, os, pathlib, sys, xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import urlsplit

def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as handle:
  for chunk in iter(lambda:handle.read(1024*1024),b''): h.update(chunk)
 return h.hexdigest()

def snapshot(root):
 files={}
 for top,dirs,names in os.walk(root,followlinks=False):
  for name in names+[n for n in dirs if (pathlib.Path(top)/n).is_symlink()]:
   path=pathlib.Path(top)/name
   files[str(path.relative_to(root))]='symlink:'+os.readlink(path) if path.is_symlink() else digest(path)
 return files

class Seo(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True)
  self.title=[]; self.headings=[]; self.heading=None; self.in_title=False
  self.canonical=[]; self.meta=[]; self.build=None; self.json_ld=[]; self.script=None
  self.style=False; self.text=[]; self.assets=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='title': self.in_title=True
  if tag=='h1': self.heading=[]
  if tag=='style': self.style=True
  if tag=='script': self.script={'ld':a.get('type')=='application/ld+json','text':[]}
  if tag=='link' and a.get('rel')=='canonical': self.canonical.append(a.get('href'))
  if tag=='meta':
   key=a.get('name') or a.get('property')
   if key=='shoditsa-build-sha': self.build=a.get('content')
   elif key in ('description','robots','googlebot','yandex') or (key and key.startswith(('og:','twitter:'))): self.meta.append((key,a.get('content')))
  value=a.get('src') if tag=='script' else a.get('href') if tag=='link' else None
  if value and value.startswith('/assets/'): self.assets.append(urlsplit(value).path.lstrip('/'))
 def handle_endtag(self,tag):
  if tag=='title': self.in_title=False
  if tag=='h1' and self.heading is not None: self.headings.append(' '.join(''.join(self.heading).split())); self.heading=None
  if tag=='script' and self.script is not None:
   if self.script['ld']: self.json_ld.append(json.loads(''.join(self.script['text'])))
   self.script=None
  if tag=='style': self.style=False
 def handle_data(self,data):
  if self.script is not None: self.script['text'].append(data); return
  if self.style: return
  if self.in_title: self.title.append(data)
  if self.heading is not None: self.heading.append(data)
  self.text.append(data)
 def fingerprint(self):
  return {'title':' '.join(''.join(self.title).split()),'h1':self.headings,'canonical':self.canonical,'meta':sorted(self.meta),'jsonLd':self.json_ld,'visibleText':' '.join(' '.join(self.text).split())}

def read_seo(path):
 result=Seo(); result.feed(path.read_text(encoding='utf-8')); return result

action=sys.argv[1]
if action=='snapshot':
 root=pathlib.Path(sys.argv[2]); output=pathlib.Path(sys.argv[3])
 result={'root':str(root),'files':snapshot(root)}
 output.write_text(json.dumps(result,sort_keys=True),encoding='utf-8')
 print(json.dumps({'oldWebFiles':len(result['files']),'snapshotSha256':digest(output)}))
elif action=='compare':
 old,new=map(pathlib.Path,sys.argv[2:4]); saved=pathlib.Path(sys.argv[4]); output=pathlib.Path(sys.argv[5]); sha=sys.argv[6]
 baseline=json.loads(saved.read_text()); assert baseline['root']==str(old)
 assert baseline['files']==snapshot(old),'Preserved old web files changed during overlay'
 static=['robots.txt','sitemap.xml','manifest.webmanifest','offline.html','sw.js']
 preserved={}
 for name in static:
  assert (old/name).is_file() and (new/name).is_file(),name
  assert digest(old/name)==digest(new/name),'PWA/SEO static file changed: '+name
  preserved[name]=digest(new/name)
 locations=[element.text for element in ET.parse(old/'sitemap.xml').getroot().iter() if element.tag.split('}')[-1]=='loc']
 assert len(locations)==58 and len(set(locations))==58,'Sitemap baseline changed; review current evidence'
 checked=[]
 for location in locations:
  u=urlsplit(location); assert u.scheme=='https' and u.netloc=='shoditsa.ru'
  relative='index.html' if u.path=='/' else 'seo/'+u.path.lstrip('/')+'.html'
  before,after=read_seo(old/relative),read_seo(new/relative)
  assert before.fingerprint()==after.fingerprint(),'SEO metadata or fallback text differs: '+location
  assert after.canonical==[location] and len(after.headings)==1,'SEO structure invalid: '+location
  assert after.build==sha,'Stale page bundle marker: '+location
  for asset in after.assets:
   path=new/asset
   assert path.is_file() and path.stat().st_size>0,'Missing compiled asset: '+asset
  checked.append(location)
 result={'oldWebUnchanged':True,'oldWebSnapshotSha256':digest(saved),'oldWebFiles':len(baseline['files']),'preservedStaticSha256':preserved,'seoPagesChecked':len(checked),'seoUrls':checked,'newPageBuildSha':sha}
 output.write_text(json.dumps(result,indent=2),encoding='utf-8')
 print(json.dumps({'oldWebUnchanged':True,'seoPagesChecked':len(checked),'pwaStaticFilesUnchanged':len(static)}))
else: raise ValueError('Unknown parity command')

"""Inspectable contact sheets with stable reference IDs; never a semantic auto-pass."""
import json
from pathlib import Path
import sys
from PIL import Image,ImageOps,ImageDraw,ImageFont
from editorial import dump,identity
from runtime import Library,BASE
from media_pipeline import ROOT,ANALYSIS


def textlines(text,width=48):
    import textwrap
    return textwrap.wrap(str(text).replace('\n',' '),width=width)[:3]


def build():
    library=Library();font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15);small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',13)
    with library.connect() as db:rows=[library.editorial.apply(dict(r),library.editorial.all_reviews()) for r in db.execute(BASE+' ORDER BY q.pack_id,r.ordinal,t.ordinal,q.ordinal')]
    records=[];video=[]
    for row in rows:
        for m in library.media.question_media(row['id'],False):
            if not m['file']:continue
            file=library.media.file(m['file']['id']);previews=file['analysis'].get('previews',[])
            if not previews:continue
            info=dict(index=len(records)+len(video),media_id=m['id'],qid=row['id'],identity=identity(row['id']),phase=m['phase'],theme=row['theme_name'],prompt=row['prompt'],answer=row['answer_text'],file_id=file['id'],sha256=file['sha256'],signature=m['signature'],type=m['type'])
            if m['type']=='video':video.append(dict(info,previews=previews))
            else:records.append(dict(info,previews=previews))
    folder=ROOT/'sheets';folder.mkdir(exist_ok=True)
    manifest=[]
    for start in range(0,len(records),12):
        sheet=Image.new('RGB',(1600,1500),'#eeeef0');draw=ImageDraw.Draw(sheet)
        for slot,item in enumerate(records[start:start+12]):
            x=(slot%4)*400;y=(slot//4)*500
            label=f'{item["index"]} {item["identity"]} {item["phase"]}'
            draw.text((x+8,y+5),label,font=small,fill='#232334')
            lines=textlines(item['theme']+' | '+item['answer'],46)
            for line_index,line in enumerate(lines):draw.text((x+8,y+25+line_index*17),line,font=font,fill='#232334')
            with Image.open(Path('archive/local/svoyak-library')/item['previews'][0]['path']) as im:
                thumb=ImageOps.contain(im.convert('RGB'),(384,400));sheet.paste(thumb,(x+8+(384-thumb.width)//2,y+92+(400-thumb.height)//2))
        name=f'images-{start//12:03}.jpg';sheet.save(folder/name,quality=94)
        manifest.append(dict(path=str(folder/name),items=records[start:start+12]))
    for i,item in enumerate(video):
        sheet=Image.new('RGB',(1500,1150),'#eeeef0');draw=ImageDraw.Draw(sheet)
        draw.text((15,5),f'{item["index"]} {item["identity"]} {item["phase"]} | '+item['theme'],font=font,fill='black')
        for j,line in enumerate(textlines(item['prompt']+' → '+item['answer'],150)):draw.text((15,30+j*18),line,font=font,fill='black')
        for j,frame in enumerate(item['previews'][:6]):
            x=(j%2)*750;y=100+(j//2)*350
            draw.text((x+10,y),str(frame['time'])+' sec',font=font,fill='black')
            with Image.open(Path('archive/local/svoyak-library')/frame['path']) as im:
                thumb=ImageOps.contain(im.convert('RGB'),(730,315));sheet.paste(thumb,(x+10+(730-thumb.width)//2,y+25+(315-thumb.height)//2))
        name=f'video-{i:03}.jpg';sheet.save(folder/name,quality=94);manifest.append(dict(path=str(folder/name),items=[item]))
    (folder/'manifest.json').write_text(dump(manifest),encoding='utf-8');print(dump(dict(image_sheets=(len(records)+11)//12,video_sheets=len(video),references=len(records)+len(video))))


if __name__=='__main__':build()

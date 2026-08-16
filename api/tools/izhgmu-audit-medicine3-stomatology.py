#!/usr/bin/env python3
import argparse, hashlib, json, re
from pathlib import Path
import xlrd

p=argparse.ArgumentParser(); p.add_argument('--input-dir',default='/tmp/izhgmu-current'); a=p.parse_args()
root=Path(a.input_dir); report=json.loads((root/'download-report.json').read_text())
src=next(x for x in report['files'] if x.get('status')=='downloaded' and x.get('faculty')=='medicine' and int(x.get('course') or 0)==3 and x.get('term')=='spring' and x.get('sourceKind')=='class' and x.get('language')=='ru')
data=(root/src['filename']).read_bytes(); assert hashlib.sha256(data).hexdigest()==src['sha256']
book=xlrd.open_workbook(file_contents=data,formatting_info=True)
assert book.nsheets==1
sh=book.sheet_by_index(0)

def norm(v):
    if isinstance(v,float) and v.is_integer(): return str(int(v))
    return re.sub(r'\s+',' ',str(v or '')).strip()

def ref(r,c):
    n=c+1; out=''
    while n:
        n,rem=divmod(n-1,26); out=chr(65+rem)+out
    return f'{sh.name}!{out}{r+1}'

hits=[]
rx=re.compile(r'стомат|лекц|11[.:]05|11[.:]20|12[.:]50|13[.:]05|10[.:]15|13[.:]20',re.I)
for r in range(sh.nrows):
    for c in range(sh.ncols):
        value=norm(sh.cell_value(r,c))
        if value and rx.search(value):
            hits.append({'ref':ref(r,c),'value':value,'cellType':int(sh.cell_type(r,c)),'xfIndex':int(sh.cell(r,c).xf_index)})

notes=[]
for key,note in (getattr(sh,'cell_note_map',{}) or {}).items():
    try:
        r,c=key
    except Exception:
        continue
    notes.append({'ref':ref(r,c),'text':norm(getattr(note,'text','') or getattr(note,'author','') or note)})

hyperlinks=[]
for key,item in (getattr(sh,'hyperlink_map',{}) or {}).items():
    try:
        r,c=key
    except Exception:
        continue
    hyperlinks.append({'ref':ref(r,c),'url':norm(getattr(item,'url_or_path','')),'description':norm(getattr(item,'desc',''))})

hidden_rows=[]
for r,info in (getattr(sh,'rowinfo_map',{}) or {}).items():
    if getattr(info,'hidden',0): hidden_rows.append(r+1)
hidden_cols=[]
for c,info in (getattr(sh,'colinfo_map',{}) or {}).items():
    if getattr(info,'hidden',0): hidden_cols.append(c+1)

names=[]
for item in getattr(book,'name_obj_list',[]) or []:
    names.append({'name':norm(getattr(item,'name','')),'formulaText':norm(getattr(item,'formula_text','')),'scope':getattr(item,'scope',None)})

stom_merges=[]
for rlo,rhi,clo,chi in sh.merged_cells:
    if rlo <= 33 and rhi >= 30 and clo <= 21 and chi >= 15:
        stom_merges.append({'r1':rlo+1,'r2':rhi,'c1':clo+1,'c2':chi})

out={
    'version':1,
    'source':{'filename':src['filename'],'sha256':src['sha256'],'sheet':sh.name},
    'searchedEvidence':hits,
    'notes':notes,
    'hyperlinks':hyperlinks,
    'hiddenRows':hidden_rows,
    'hiddenCols':hidden_cols,
    'definedNames':names,
    'stomatologyLegendMergeGeometry':stom_merges,
    'conclusion':{
        'hasStomatologySpecific1105':any('11.05' in x['value'] or '11:05' in x['value'] for x in hits),
        'hasLecture1120':any('11.20' in x['value'] or '11:20' in x['value'] for x in hits),
        'hasLecture1250':any('12.50' in x['value'] or '12:50' in x['value'] for x in hits),
        'commentCount':len(notes),
        'hiddenRowCount':len(hidden_rows),
        'hiddenColCount':len(hidden_cols),
    },
}
(root/'medicine3-stomatology-audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print('IZHGMU_MEDICINE3_STOMATOLOGY_AUDIT',json.dumps(out['conclusion'],ensure_ascii=False))
for item in hits: print('STOM_EVIDENCE',json.dumps(item,ensure_ascii=False))
for item in notes: print('STOM_NOTE',json.dumps(item,ensure_ascii=False))

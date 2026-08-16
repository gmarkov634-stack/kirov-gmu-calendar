#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path
import xlrd

p=argparse.ArgumentParser(); p.add_argument('--input-dir',default='/tmp/izhgmu-current'); a=p.parse_args()
root=Path(a.input_dir); report=json.loads((root/'download-report.json').read_text())
src=next(x for x in report['files'] if x.get('status')=='downloaded' and x.get('faculty')=='medicine' and int(x.get('course') or 0)==3 and x.get('term')=='spring' and x.get('sourceKind')=='class')
data=(root/src['filename']).read_bytes(); assert hashlib.sha256(data).hexdigest()==src['sha256']
book=xlrd.open_workbook(file_contents=data,formatting_info=True); sh=book.sheet_by_index(0)

def txt(r,c):
    v=sh.cell_value(r,c)
    return str(int(v)) if isinstance(v,float) and v.is_integer() else str(v).strip()

def rgb(index):
    value=book.colour_map.get(index)
    return list(value) if value is not None else None

def fill_sig(r,c):
    cell=sh.cell(r,c); xf=book.xf_list[cell.xf_index]; bg=xf.background
    return {
        'fillPattern': int(bg.fill_pattern),
        'patternColorIndex': int(bg.pattern_colour_index),
        'patternRgb': rgb(bg.pattern_colour_index),
        'backgroundColorIndex': int(bg.background_colour_index),
        'backgroundRgb': rgb(bg.background_colour_index),
    }

def fill_key(sig):
    return (sig['fillPattern'],sig['patternColorIndex'],sig['backgroundColorIndex'])

rows=[]
# Include Russian pairs 301-326 and the immediately following English 3501-3506 rows.
for r in range(12,28):
    last=None; run=None; runs=[]
    for c in range(1,sh.ncols):
        sig=fill_sig(r,c); key=fill_key(sig)
        if key!=last:
            if run: runs.append(run)
            run={'c1':c+1,'c2':c+1,**sig,'text':'','nonEmptyCells':[],'xfIndexes':[]}
            last=key
        else:
            run['c2']=c+1
        cell=sh.cell(r,c)
        if int(cell.xf_index) not in run['xfIndexes']: run['xfIndexes'].append(int(cell.xf_index))
        t=txt(r,c)
        if t:
            run['text']+=t
            run['nonEmptyCells'].append({'col':c+1,'value':t})
    if run: runs.append(run)
    rows.append({'row':r+1,'label':txt(r,0),'runs':runs})

metadata=[]
for rlo,rhi,clo,chi in sh.merged_cells:
    if rlo == 30 and rhi == 31 and clo > 0:
        department=txt(rlo,clo)
        if department:
            metadata.append({'department':department,'c1':clo+1,'c2':chi,**fill_sig(rlo,clo)})
metadata.sort(key=lambda item:item['c1'])

out={'version':5,'source':src,'segmentation':'fill_color','rows':rows,'metadataColors':metadata}
(root/'medicine3-style-diagnostic.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
for item in metadata:
    print('METADATA_COLOR',json.dumps(item,ensure_ascii=False))
for row in rows:
    print('COLOR_ROW',row['row'],'LABEL',row['label'])
    print(' COLOR_RUNS',json.dumps([
        {k:v for k,v in run.items() if k not in ('nonEmptyCells',)}
        for run in row['runs']
        if run['text'] or run['fillPattern'] != 0
    ],ensure_ascii=False))

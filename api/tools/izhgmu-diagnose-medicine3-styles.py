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

def style_sig(r,c):
    cell=sh.cell(r,c)
    return {'xf': int(cell.xf_index)}

rows=[]
for r in range(12,25):
    last=None; run=None; runs=[]
    for c in range(1,116):
        sig=style_sig(r,c); key=sig['xf']
        if key!=last:
            if run: runs.append(run)
            run={'c1':c+1,'c2':c+1,'xf':key,'text':''}
            last=key
        else:
            run['c2']=c+1
        t=txt(r,c)
        if t: run['text']+=t
    if run: runs.append(run)
    rows.append({'row':r+1,'label':txt(r,0),'runs':runs})

out={'version':2,'source':src,'rows':rows}
(root/'medicine3-style-diagnostic.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
for row in rows:
    print('STYLE_ROW',row['row'],'LABEL',row['label'])
    print(' XF_RUNS',json.dumps([run for run in row['runs'] if run['text']],ensure_ascii=False))

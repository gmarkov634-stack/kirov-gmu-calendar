#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path
import xlrd
p=argparse.ArgumentParser(); p.add_argument('--input-dir',default='/tmp/izhgmu-current'); a=p.parse_args()
root=Path(a.input_dir); report=json.loads((root/'download-report.json').read_text())
src=next(x for x in report['files'] if x.get('status')=='downloaded' and x.get('faculty')=='medicine' and int(x.get('course') or 0)==3 and x.get('term')=='spring' and x.get('sourceKind')=='class')
data=(root/src['filename']).read_bytes(); assert hashlib.sha256(data).hexdigest()==src['sha256']
book=xlrd.open_workbook(file_contents=data,formatting_info=True); sh=book.sheet_by_index(0)
rows=[]
for r in range(sh.nrows):
    vals=[]
    for c in range(sh.ncols):
        v=sh.cell_value(r,c)
        if isinstance(v,float) and v.is_integer(): text=str(int(v))
        else: text=str(v).strip()
        if text: vals.append({'col':c+1,'value':text,'xf':sh.cell(r,c).xf_index})
    rows.append({'row':r+1,'cells':vals})
merges=[{'r1':rlo+1,'r2':rhi,'c1':clo+1,'c2':chi} for rlo,rhi,clo,chi in sh.merged_cells]
out={'version':2,'source':src,'sheet':sh.name,'rows':rows,'merges':merges}
(root/'medicine3-grid-diagnostic.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
for row in rows:
    if row['cells']:
        print('GRID_ROW',row['row'],json.dumps(row['cells'],ensure_ascii=False))
print('GRID_MERGES',json.dumps(merges,ensure_ascii=False))

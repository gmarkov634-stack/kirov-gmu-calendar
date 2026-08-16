#!/usr/bin/env python3
import argparse, hashlib, json, re
from pathlib import Path
import xlrd

p=argparse.ArgumentParser()
p.add_argument('--input-dir', default='/tmp/izhgmu-current')
p.add_argument('--output', default=None)
a=p.parse_args()
root=Path(a.input_dir)
report=json.loads((root/'download-report.json').read_text())
files=[x for x in report['files'] if x.get('status')=='downloaded' and x.get('faculty')=='medicine' and int(x.get('course') or 0)==3 and x.get('language')=='ru' and x.get('term')=='spring']
class_src=next((x for x in files if x.get('sourceKind')=='class'),None)
lecture_src=next((x for x in files if x.get('sourceKind')=='lecture'),None)
if not class_src or not lecture_src:
    raise SystemExit(f'medicine-3 source pair missing: {files!r}')
path=root/class_src['filename']
data=path.read_bytes()
if hashlib.sha256(data).hexdigest()!=class_src['sha256']:
    raise SystemExit('class SHA mismatch')
if data[:8] != bytes.fromhex('D0CF11E0A1B11AE1'):
    raise SystemExit('class source is not OLE/XLS')
book=xlrd.open_workbook(path, formatting_info=True)
out={'version':2,'classSource':class_src,'lectureSource':lecture_src,'sheets':[]}
for sh in book.sheets():
    nonempty=[]
    groups=[]
    group_rows={}
    for r in range(sh.nrows):
        row_values=[]
        for c in range(sh.ncols):
            v=sh.cell_value(r,c)
            text=str(int(v)) if isinstance(v,float) and v.is_integer() else str(v).strip()
            if text:
                row_values.append({'col':c+1,'value':text})
                if len(nonempty)<180:
                    nonempty.append({'row':r+1,'col':c+1,'value':text})
                if re.fullmatch(r'3\d{2}',text):
                    groups.append({'row':r+1,'col':c+1,'value':text})
        if any(re.fullmatch(r'3\d{2}',x['value']) for x in row_values):
            group_rows[str(r+1)]=row_values
    merges=[{'r1':rlo+1,'r2':rhi,'c1':clo+1,'c2':chi} for rlo,rhi,clo,chi in sh.merged_cells[:500]]
    out['sheets'].append({'name':sh.name,'rows':sh.nrows,'cols':sh.ncols,'groups':groups,'groupRows':group_rows,'merges':merges,'firstNonEmpty':nonempty})
out['groups']=sorted({g['value'] for s in out['sheets'] for g in s['groups']}, key=int)
out['summary']={'groupCount':len(out['groups']),'groups':out['groups'],'sheetCount':len(out['sheets'])}
outfile=Path(a.output) if a.output else root/'medicine3-legacy-diagnostic.json'
outfile.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print('IZHGMU_MEDICINE3_LEGACY',json.dumps(out['summary'],ensure_ascii=False))
for s in out['sheets']:
    print('SHEET',s['name'],'ROWS',s['rows'],'COLS',s['cols'],'GROUPS',','.join(g['value'] for g in s['groups']))
    print('GROUP_ROWS',json.dumps(s['groupRows'],ensure_ascii=False))

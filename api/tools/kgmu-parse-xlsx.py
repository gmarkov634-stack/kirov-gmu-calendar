#!/usr/bin/env python3
import argparse, json, re, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
DAY_MAP = {'ПН':'MO','ВТ':'TU','СР':'WE','ЧТ':'TH','ПТ':'FR','СБ':'SA','ВС':'SU'}
TIME_RUN_RE = re.compile(r'(?<!\d)(?:\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2})(?:\s*,\s*\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2})*')
DATE_TOKEN = r'(?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])'
DATE_RE = re.compile(rf'(?<!\d)({DATE_TOKEN}(?:\.\d{{4}})?)(?!\d)')
DATE_RANGE_RE = re.compile(rf'(?<!\d)({DATE_TOKEN})(?:\.\d{{4}})?\s*-\s*({DATE_TOKEN})(?:\.\d{{4}})?(?!\d)')
GROUP_RE = re.compile(r'\bгруппа\s*(\d{3})\b', re.I)
PERIOD_RE = re.compile(r'((?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.\d{4})[^\n]{0,80}?-\s*((?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.\d{4})')
YEAR_RE = re.compile(r'(20\d{2})\s*[-/]\s*(20\d{2}|\d{2})')
COURSE_RE = re.compile(r'(\d)\s*КУРС', re.I)
AMBIGUOUS_RE = re.compile(r'(?:\b[12]\s*недел|занятие\s+в|по\s+\d{2}\.\d{2}|другой день|по договоренности|перенос|кроме)', re.I)

def col_to_num(ref):
    m = re.match(r'([A-Z]+)', ref)
    n = 0
    for ch in m.group(1): n = n*26 + ord(ch)-64
    return n

def shared_strings(z):
    try: data = z.read('xl/sharedStrings.xml')
    except KeyError: return []
    root = ET.fromstring(data)
    out=[]
    for si in root.findall(f'{{{NS_MAIN}}}si'):
        out.append(''.join(t.text or '' for t in si.iter(f'{{{NS_MAIN}}}t')))
    return out

def first_sheet_path(z):
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    sheet = wb.find(f'.//{{{NS_MAIN}}}sheet')
    rid = sheet.attrib.get(f'{{{NS_REL}}}id')
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rel_ns = 'http://schemas.openxmlformats.org/package/2006/relationships'
    target = None
    for rel in rels.findall(f'{{{rel_ns}}}Relationship'):
        if rel.attrib.get('Id') == rid:
            target = rel.attrib['Target']; break
    if not target: return 'xl/worksheets/sheet1.xml'
    if target.startswith('/'): return target.lstrip('/')
    if target.startswith('xl/'): return target
    return 'xl/' + target.lstrip('/')

def read_rows(path):
    with zipfile.ZipFile(path) as z:
        ss = shared_strings(z)
        root = ET.fromstring(z.read(first_sheet_path(z)))
    rows=[]
    for row in root.findall(f'.//{{{NS_MAIN}}}row'):
        vals={}
        for c in row.findall(f'{{{NS_MAIN}}}c'):
            ref=c.attrib.get('r','A1'); col=col_to_num(ref); typ=c.attrib.get('t')
            if typ == 'inlineStr':
                val=''.join(t.text or '' for t in c.iter(f'{{{NS_MAIN}}}t'))
            else:
                v=c.find(f'{{{NS_MAIN}}}v'); raw='' if v is None else (v.text or '')
                if typ=='s' and raw.isdigit() and int(raw)<len(ss): val=ss[int(raw)]
                else: val=raw
            val=re.sub(r'\s+',' ',str(val)).strip()
            if val: vals[col]=val
        rows.append((int(row.attrib.get('r',len(rows)+1)),vals))
    return rows

def detect_program(text):
    u=text.upper()
    if 'ПЕДИАТРИ' in u: return 'pediatrics'
    if 'СТОМАТОЛ' in u: return 'dentistry'
    if 'ЛЕЧЕБНОЕ ДЕЛО' in u or 'ЛЕЧЕБНОГО ФАКУЛЬТЕТА' in u: return 'medicine'
    return None

def parse_file(path):
    rows=read_rows(path)
    rowtexts=[' '.join(v.values()) for _,v in rows]
    alltext=' '.join(rowtexts)
    yr=YEAR_RE.search(alltext); course=COURSE_RE.search(alltext)
    period=next((PERIOD_RE.search(t) for t in rowtexts if PERIOD_RE.search(t)), None)
    fn=Path(path).name
    program='medicine' if '_medicine_' in fn else 'pediatrics' if '_pediatrics_' in fn else 'dentistry' if '_dentistry_' in fn else detect_program(alltext)
    if not course:
        m=re.search(r'_course-(\d)_', fn); course=m
    header=None; groups={}
    for r, vals in rows:
        matches={c:GROUP_RE.search(v).group(1) for c,v in vals.items() if GROUP_RE.search(v)}
        if len(matches)>=2:
            header=r; groups=matches; break
    calendar_markers=sum(any(x in v.lower() for x in ['месяц','число','день недели','группы']) for _,vals in rows for v in vals.values())
    layout='weekly-grid' if header else ('calendar-grid' if calendar_markers>=3 else 'unknown')
    records=[]; day=None; stats={'cells':0,'with_time':0,'without_time':0,'multi_time_runs':0,'ambiguous':0,'date_ranges':0}
    if header:
        for r,vals in rows:
            if r<=header: continue
            a=vals.get(1,'').strip().upper()
            if a in DAY_MAP: day=a
            if not day: continue
            for col, group in groups.items():
                raw=vals.get(col,'').strip()
                if not raw: continue
                time_runs=[m.group(0) for m in TIME_RUN_RE.finditer(raw)]
                dates=[m.group(1) for m in DATE_RE.finditer(raw)]
                ranges=[m.group(0) for m in DATE_RANGE_RE.finditer(raw)]
                ambiguous=bool(AMBIGUOUS_RE.search(raw))
                stats['cells']+=1
                stats['with_time']+=bool(time_runs); stats['without_time']+=not bool(time_runs)
                stats['multi_time_runs']+=len(time_runs)>1; stats['ambiguous']+=ambiguous; stats['date_ranges']+=bool(ranges)
                records.append({'row':r,'groupCode':group,'weekday':day,'weekdayIso':DAY_MAP[day],'raw':raw,'timeRuns':time_runs,'dates':dates,'dateRanges':ranges,'ambiguous':ambiguous})
    return {
        'version':1,'sourceFile':Path(path).name,'layout':layout,'program':program,'course':int(course.group(1)) if course else None,
        'academicYear': (f"{yr.group(1)}/20{yr.group(2)}" if yr and len(yr.group(2))==2 else f"{yr.group(1)}/{yr.group(2)}" if yr else None),
        'semester': 2 if 'ВТОРОЕ ПОЛУГОДИЕ' in alltext.upper() else 1 if 'ПЕРВОЕ ПОЛУГОДИЕ' in alltext.upper() else None,
        'period': {'start':period.group(1),'end':period.group(2)} if period else None,
        'groupHeaderRow':header,'groups':list(groups.values()),'stats':stats,'records':records,
    }

def self_test():
    assert DAY_MAP['ПН']=='MO'
    s='13.00-14.30, 14.40-15.25 Анатомия 26.01-01.06 (1 занятие во вт.)'
    assert TIME_RUN_RE.search(s).group(0)=='13.00-14.30, 14.40-15.25'
    assert DATE_RANGE_RE.search(s).group(0)=='26.01-01.06'
    assert AMBIGUOUS_RE.search(s)
    assert detect_program('СПЕЦИАЛЬНОСТИ ПЕДИАТРИЯ')=='pediatrics'
    print('kgmu structural parser self-test: OK')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('input',nargs='?'); ap.add_argument('--output'); ap.add_argument('--self-test',action='store_true')
    a=ap.parse_args()
    if a.self_test: self_test(); return
    p=Path(a.input)
    files=sorted(p.glob('*.xlsx')) if p.is_dir() else [p]
    reports=[parse_file(f) for f in files]
    summary={
        'version':1,'fileCount':len(reports),'filesParsed':sum(bool(r['groupHeaderRow']) for r in reports),
        'recordCount':sum(len(r['records']) for r in reports),'ambiguousRecordCount':sum(r['stats']['ambiguous'] for r in reports),
        'layouts':{name:sum(r['layout']==name for r in reports) for name in ['weekly-grid','calendar-grid','unknown']},
        'files':[ {k:r[k] for k in ['sourceFile','layout','program','course','academicYear','semester','period','groups','stats']} for r in reports],
    }
    out={'summary':summary,'reports':reports}
    text=json.dumps(out,ensure_ascii=False,indent=2)
    if a.output: Path(a.output).write_text(text+'\n',encoding='utf-8')
    else: print(text)
if __name__=='__main__': main()

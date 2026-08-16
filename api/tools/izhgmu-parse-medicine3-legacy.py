#!/usr/bin/env python3
import argparse, hashlib, json, re
from datetime import date
from pathlib import Path
import xlrd

WEEKDAY = {'пн':0,'вт':1,'ср':2,'чт':3,'пт':4,'сб':5,'вс':6}
EXPECTED_COUNTS = {
    'Патофизиология': 16,
    'Общественное здоровье и здравоохранение': 10,
    'Пропедевтика внутренних болезней': 17,
    'Общая хирургия': 13,
    'Стоматология': 8,
    'Патологическая анатомия': 15,
    'Фармакология': 13,
}
COLOR_NAMES = {
    (255,102,0): 'Патофизиология',
    (255,255,0): 'Общественное здоровье и здравоохранение',
    (153,204,0): 'Пропедевтика внутренних болезней',
    (255,153,204): 'Общая хирургия',
    (255,128,128): 'Фармакология',
}
BLUE = (153,204,255)
ALIASES = {
    'патофизиология': 'Патофизиология',
    'озз': 'Общественное здоровье и здравоохранение',
    'пропедвнутболез': 'Пропедевтика внутренних болезней',
    'общаяхирург': 'Общая хирургия',
    'стоматол': 'Стоматология',
    'паталоганатом': 'Патологическая анатомия',
    'фармакология': 'Фармакология',
}
META_MATCH = [
    ('Пропедевтика внутренних болезней', re.compile(r'пропед.*внутрен', re.I)),
    ('Патологическая анатомия', re.compile(r'патал|патол', re.I)),
    ('Стоматология', re.compile(r'стоматолог', re.I)),
    ('Фармакология', re.compile(r'фармаколог', re.I)),
    ('Патофизиология', re.compile(r'патофизиолог', re.I)),
    ('Общественное здоровье и здравоохранение', re.compile(r'организац.*здоров', re.I)),
    ('Общая хирургия', re.compile(r'общая\s+хирург', re.I)),
]

def norm(v):
    if isinstance(v,float) and v.is_integer(): return str(int(v))
    return re.sub(r'\s+',' ',str(v or '')).strip()

def compact(v): return re.sub(r'[^а-яё]+','',norm(v).lower().replace('ё','е'))

def col_letters(n):
    out=''
    while n:
        n,rem=divmod(n-1,26); out=chr(65+rem)+out
    return out

def rgb(book,index):
    value=book.colour_map.get(index)
    return tuple(value) if value is not None else None

def fill_rgb(book,sh,r,c):
    xf=book.xf_list[sh.cell(r,c).xf_index]
    if int(xf.background.fill_pattern) == 0: return None
    return rgb(book,int(xf.background.pattern_colour_index))

def parse_period(sh):
    for r in range(min(10,sh.nrows)):
        for c in range(sh.ncols):
            text=norm(sh.cell_value(r,c))
            m=re.search(r'Начало весеннего семестра\s*-\s*(\d{1,2})\s+февраля\s+(20\d{2}).*окончание\s*-\s*(\d{1,2})\s+мая\s+(20\d{2})',text,re.I)
            if m:
                return date(int(m.group(2)),2,int(m.group(1))), date(int(m.group(4)),5,int(m.group(3))), f'{sh.name}!{col_letters(c+1)}{r+1}'
    raise AssertionError('IZH-M3 period missing')

def date_columns(sh,start,end):
    result=[]; year=start.year; month=start.month; previous=None
    for c in range(1,sh.ncols):
        values=[norm(sh.cell_value(10,c)).lower(),norm(sh.cell_value(11,c)).lower()]
        day=next((int(v) for v in values if re.fullmatch(r'\d{1,2}',v)),None)
        weekday=next((WEEKDAY[v] for v in values if v in WEEKDAY),None)
        if day is None or weekday is None: continue
        if previous is not None and day < previous:
            month += 1
            if month == 13: month=1; year+=1
        current=date(year,month,day)
        if current.weekday()!=weekday: raise AssertionError(f'IZH-M3 weekday mismatch {col_letters(c+1)} {current}')
        if not (start <= current <= end): raise AssertionError(f'IZH-M3 date outside semester {current}')
        result.append({'col':c+1,'date':current.isoformat(),'refs':[f'{sh.name}!{col_letters(c+1)}11',f'{sh.name}!{col_letters(c+1)}12']})
        previous=day
    assert len(result)==92, f'IZH-M3 expected 92 teaching columns, got {len(result)}'
    assert result[0]['date']==start.isoformat() and result[-1]['date']==end.isoformat()
    assert [x['col'] for x in result] == list(range(2,94)), 'IZH-M3 date grid must be B:CO without gaps'
    return result

def metadata(sh):
    department_row=next(r for r in range(sh.nrows) if norm(sh.cell_value(r,0)).lower()=='кафедра')
    merged=sorted([(clo,chi) for rlo,rhi,clo,chi in sh.merged_cells if rlo==department_row and rhi==department_row+1 and clo>0])
    out={}
    for clo,chi in merged:
        dept=norm(sh.cell_value(department_row,clo))
        if not dept: continue
        matches=[name for name,rx in META_MATCH if rx.search(dept)]
        if len(matches)!=1: continue
        name=matches[0]
        out[name]={
            'department':dept,
            'timeRaw':norm(sh.cell_value(department_row+1,clo)) or None,
            'assessment':norm(sh.cell_value(department_row+2,clo)) or None,
            'location':norm(sh.cell_value(department_row+3,clo)) or None,
            'refs':{
                'department':f'{sh.name}!{col_letters(clo+1)}{department_row+1}',
                'time':f'{sh.name}!{col_letters(clo+1)}{department_row+2}',
                'assessment':f'{sh.name}!{col_letters(clo+1)}{department_row+3}',
                'location':f'{sh.name}!{col_letters(clo+1)}{department_row+4}',
            },
        }
    assert set(out)==set(EXPECTED_COUNTS), f'IZH-M3 metadata incomplete: {sorted(out)}'
    return out

def raw_text(sh,row,c1,c2):
    return ''.join(norm(sh.cell_value(row,c-1)) for c in range(c1,c2+1))

def color_runs(book,sh,row):
    runs=[]; start=2; current=fill_rgb(book,sh,row,1)
    for col in range(3,95):
        nxt=fill_rgb(book,sh,row,col-1) if col<=93 else object()
        if nxt!=current:
            runs.append((start,col-1,current)); start=col; current=nxt
    return runs

def blue_parts(sh,row,c1,c2):
    cells=[(c,norm(sh.cell_value(row,c-1))) for c in range(c1,c2+1)]
    compact_text=''.join(v for _,v in cells).lower().replace('ё','е')
    if compact_text=='стоматол': return [('Стоматология',list(range(c1,c2+1)),'стоматол')]
    if compact_text=='паталоганатом': return [('Патологическая анатомия',list(range(c1,c2+1)),'паталоганатом')]
    if compact_text=='стоматолпаталоганатом':
        path_start=next(c for c,v in cells if v.lower()=='п' and c>c1)
        return [
            ('Стоматология',list(range(c1,path_start)),'стоматол'),
            ('Патологическая анатомия',list(range(path_start,c2+1)),'паталоганатом'),
        ]
    if compact_text and set(compact_text)=={'с'}:
        marked=[c for c,v in cells if v.lower()=='с']
        return [('Стоматология',marked,'с_markers')]
    if compact_text.startswith('ссссс') and 'паталоганатом' in compact_text:
        path_start=next(c for c,v in cells if v.lower()=='п')
        marked=[c for c,v in cells if c<path_start and v.lower()=='с']
        return [
            ('Стоматология',marked,'с_markers'),
            ('Патологическая анатомия',list(range(path_start,c2+1)),'паталоганатом'),
        ]
    raise AssertionError(f'IZH-M3 unknown blue block row {row+1}: {compact_text}')

def source_piece(sh,row,c1,c2,color,name,cols,alias,dates_by_col,meta):
    if not cols: raise AssertionError(f'IZH-M3 empty discipline span {name}')
    missing=[c for c in cols if c not in dates_by_col]
    if missing: raise AssertionError(f'IZH-M3 unmapped date columns {missing}')
    return {
        'discipline':name,
        'sourceAlias':alias,
        'fillRgb':list(color),
        'columns':cols,
        'dates':[dates_by_col[c]['date'] for c in cols],
        'sourceRanges':[f'{sh.name}!{col_letters(cols[0])}{row+1}:{col_letters(cols[-1])}{row+1}'],
        **meta[name],
    }

def consolidate_and_validate(label,pieces):
    by_name={}
    for item in pieces:
        name=item['discipline']
        if name not in by_name:
            by_name[name]=item
        else:
            target=by_name[name]
            target['columns']+=item['columns']; target['dates']+=item['dates']; target['sourceRanges']+=item['sourceRanges']
            aliases=[x for x in str(target['sourceAlias']).split('+') if x]
            if item['sourceAlias'] not in aliases: aliases.append(item['sourceAlias'])
            target['sourceAlias']='+'.join(aliases)
    series=list(by_name.values())
    assert set(x['discipline'] for x in series)==set(EXPECTED_COUNTS), f'IZH-M3 discipline set mismatch {label}'
    counts={x['discipline']:len(x['dates']) for x in series}
    assert counts==EXPECTED_COUNTS, f'IZH-M3 duration mismatch {label}: {counts}'
    all_cols=[c for x in series for c in x['columns']]
    assert sorted(all_cols)==list(range(2,94)) and len(all_cols)==len(set(all_cols))==92, f'IZH-M3 coverage mismatch {label}'
    for item in series:
        zipped=sorted(zip(item['columns'],item['dates']),key=lambda x:x[0])
        item['columns']=[x[0] for x in zipped]; item['dates']=[x[1] for x in zipped]
    series.sort(key=lambda item:min(item['columns']))
    return series

def parse_russian_row(book,sh,row,dates_by_col,meta):
    label=norm(sh.cell_value(row,0))
    assert re.fullmatch(r'3\d{2}-3\d{2}',label), f'IZH-M3 bad Russian group pair {label}'
    pieces=[]
    for c1,c2,color in color_runs(book,sh,row):
        if color is None: continue
        text=raw_text(sh,row,c1,c2)
        if color==BLUE:
            parts=blue_parts(sh,row,c1,c2)
        else:
            name=COLOR_NAMES.get(color)
            if not name: raise AssertionError(f'IZH-M3 unknown fill {color} row {row+1} {c1}:{c2}')
            expected_alias=compact(text)
            if ALIASES.get(expected_alias)!=name:
                raise AssertionError(f'IZH-M3 color/text mismatch {color} {text!r} at row {row+1}')
            parts=[(name,list(range(c1,c2+1)),expected_alias)]
        for name,cols,alias in parts:
            pieces.append(source_piece(sh,row,c1,c2,color,name,cols,alias,dates_by_col,meta))
    series=consolidate_and_validate(label,pieces)
    return {'groupSpan':label,'groups':label.split('-'),'language':'ru','series':series,'eventCount':92}

def parse_english_row(book,sh,row,dates_by_col,meta):
    label=norm(sh.cell_value(row,0))
    m=re.fullmatch(r'(350\d)-(350\d)\s+англ',label,re.I)
    assert m, f'IZH-M3 bad English group pair {label}'
    pieces=[]
    for c1,c2,color in color_runs(book,sh,row):
        if color is None: continue
        text=raw_text(sh,row,c1,c2); alias=compact(text)
        if color==BLUE:
            if 'стомат' in alias:
                name='Стоматология'
            elif 'паталог' in alias or 'патолог' in alias or alias=='ом':
                name='Патологическая анатомия'
            else:
                raise AssertionError(f'IZH-M3 unknown English blue fragment {text!r} at row {row+1}')
        else:
            name=COLOR_NAMES.get(color)
            if not name: raise AssertionError(f'IZH-M3 unknown English fill {color} row {row+1} {c1}:{c2}')
            # English source deliberately splits three discipline names across non-contiguous runs;
            # color defines the cycle boundary, while the literal fragments remain in provenance.
            allowed_fragments={
                'Пропедевтика внутренних болезней': {'проп','едвнутболез'},
                'Патофизиология': {'пато','физиология'},
            }
            if name in allowed_fragments:
                if alias not in allowed_fragments[name]:
                    raise AssertionError(f'IZH-M3 unexpected English fragment {text!r} for {name} at row {row+1}')
            elif ALIASES.get(alias)!=name:
                raise AssertionError(f'IZH-M3 English color/text mismatch {color} {text!r} at row {row+1}')
        pieces.append(source_piece(sh,row,c1,c2,color,name,list(range(c1,c2+1)),alias,dates_by_col,meta))
    series=consolidate_and_validate(label,pieces)
    return {'groupSpan':f'{m.group(1)}-{m.group(2)}','groups':[m.group(1),m.group(2)],'language':'en','sourceLabel':label,'series':series,'eventCount':92}

def main():
    p=argparse.ArgumentParser(); p.add_argument('--input-dir',default='/tmp/izhgmu-current'); p.add_argument('--output'); a=p.parse_args()
    root=Path(a.input_dir); report=json.loads((root/'download-report.json').read_text())
    src=next(x for x in report['files'] if x.get('status')=='downloaded' and x.get('faculty')=='medicine' and int(x.get('course') or 0)==3 and x.get('term')=='spring' and x.get('sourceKind')=='class')
    data=(root/src['filename']).read_bytes(); assert hashlib.sha256(data).hexdigest()==src['sha256']
    book=xlrd.open_workbook(file_contents=data,formatting_info=True); assert book.nsheets==1
    sh=book.sheet_by_index(0); assert sh.name=='Прак.зан'
    start,end,period_ref=parse_period(sh)
    date_cols=date_columns(sh,start,end); dates_by_col={x['col']:x for x in date_cols}; meta=metadata(sh)

    pairs=[parse_russian_row(book,sh,row,dates_by_col,meta) for row in range(12,25)]
    expected=[f'{n}-{n+1}' for n in range(301,327,2)]
    assert [x['groupSpan'] for x in pairs]==expected

    english_pairs=[parse_english_row(book,sh,row,dates_by_col,meta) for row in range(25,28)]
    assert [x['groupSpan'] for x in english_pairs]==['3501-3502','3503-3504','3505-3506']

    out={
        'profile':'IZH-MEDICINE3-LEGACY-CYCLE',
        'parserVersion':'izhgmu-medicine3-legacy-cycle-v2',
        'source':{'filename':src['filename'],'sha256':src['sha256'],'sheet':sh.name},
        'period':{'start_date':start.isoformat(),'end_date':end.isoformat(),'reference':period_ref},
        'dateColumns':date_cols,
        'groupPairs':pairs,
        'englishGroupPairs':english_pairs,
        'stats':{
            'groupPairCount':len(pairs),
            'groupCount':26,
            'englishGroupPairCount':len(english_pairs),
            'englishGroupCount':6,
            'totalParsedGroupCount':32,
            'dateColumnCount':len(date_cols),
            'eventCountPerGroup':92,
        },
        'publishable':False,
        'blockers':[{'kind':'time_semantics_pending','message':'Parenthesized cycle time variants are preserved from source but not yet assigned to individual dates.'}],
    }
    output=Path(a.output) if a.output else root/'medicine3-legacy-cycle.json'
    output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print('IZHGMU_MEDICINE3_CYCLE',json.dumps({
        'russianGroupPairs':13,'russianGroups':26,'englishGroupPairs':3,'englishGroups':6,
        'totalParsedGroups':32,'datesPerGroup':92,'disciplines':list(EXPECTED_COUNTS),
        'publishable':False,'blockers':out['blockers']
    },ensure_ascii=False))

if __name__=='__main__': main()

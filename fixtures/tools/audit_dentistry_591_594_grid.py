#!/usr/bin/env python3
"""Exact-byte mechanical and source-backed C24 occurrence count audit; no publication."""
import zipfile,xml.etree.ElementTree as E,re,datetime,collections,json,hashlib,sys
p=sys.argv[1]; raw=open(p,'rb').read()
n='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
with zipfile.ZipFile(p) as z:
 root=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 ss=[]
 if 'xl/sharedStrings.xml' in z.namelist():
  a=E.fromstring(z.read('xl/sharedStrings.xml'))
  ss=[''.join(x.text or '' for x in el.iter(n+'t')) for el in a.findall(n+'si')]
 cells={}
 for el in root.iter(n+'c'):
  v=el.find(n+'v')
  cells[el.get('r')]=(ss[int(v.text)] if el.get('t')=='s' else ''.join(x.text or '' for x in el.iter(n+'t')) if el.get('t')=='inlineStr' else v.text if v is not None else '')
 ranges=[x.get('ref') for x in root.iter(n+'mergeCell')]
def num(s):
 k=0
 for c in s:k=k*26+ord(c)-64
 return k
def coord(c):
 m=re.fullmatch('([A-Z]+)([0-9]+)',c);return num(m[1]),int(m[2])
def col(i):
 s=''
 while i: i,x=divmod(i-1,26);s=chr(65+x)+s
 return s
spans=[]
for r in ranges:
 a,b=r.split(':') if ':' in r else (r,r);x,y=coord(a);xx,yy=coord(b)
 spans.append((a,b,x,y,xx,yy))
months=[]
mm={'Сентябрь':(2026,9),'Октябрь':(2026,10),'Ноябрь':(2026,11),'Декабрь':(2026,12),'Январь':(2027,1)}
for a,b,x,y,xx,yy in spans:
 if y==12 and yy==12 and cells.get(a) in mm: months.append((x,xx,*mm[cells[a]]))
days={}; mismatches=[]
for x in range(3,125):
 t=[v for v in months if v[0]<=x<=v[1]]
 if len(t)!=1: mismatches.append(('month',x));continue
 dt=datetime.date(t[0][2],t[0][3],int(cells[col(x)+'13']))
 days[x]=dt
 if cells.get(col(x)+'14','').strip().lower()!=['пн','вт','ср','чт','пт','сб','вс'][dt.weekday()]:mismatches.append(('weekday',x,str(dt)))
groups=['591','592','593','594']; blockcounts=collections.Counter(); grids=collections.defaultdict(dict); joints=[]; unknown=[]
for a,b,x,y,xx,yy in spans:
 if 15<=y<=18 and y==yy and 3<=x<=100:
  blockcounts[groups[y-15]]+=1
  for c in range(x,xx+1):
   if c in grids[y]:mismatches.append(('duplicate',a,col(c)))
   grids[y][c]=a
  v=' '.join(cells.get(a,'').split())
  if v=='Медицина катастроф Физическая подготовка':joints.append((a,b,groups[y-15],[str(days[c]) for c in range(x,xx+1)]))
  if not v:unknown.append(a)
infos=[]
for a,b,x,y,xx,yy in spans:
 if y==15 and yy==18 and x>=101:
  infos.append(dict(label=cells.get(a),range=a+':'+b,start=str(days[x]),end=str(days[xx]),columnCount=xx-x+1))
fridays=[str(days[c]) for c in sorted(days) if datetime.date(2026,9,4)<=days[c]<=datetime.date(2026,12,18) and days[c].weekday()==4]
qa=dict(sourceSha=hashlib.sha256(raw).hexdigest(),byteLength=len(raw),months=sorted(months),headerCount=len(days),groupBlocks=dict(blockcounts),joint=joints,info=infos,fridays=fridays,coverage={g:len(grids[r]) for r,g in enumerate(groups,15)},unknown=unknown,mismatches=mismatches)

import collections,re
groups=['591','592','593','594']; variants=collections.Counter(); overlaps=[]
mapping={'Костнопластические материалы и технологии':28,'Челюстно-лицевая хирургия':23,'Детская стоматология':22,'Ортодонтия и детское протезирование':25,'Медицина катастроф Физическая подготовка':(29,30),'Комплексное зубопротезирование и имплантология':26,'Пародонтология':27,'Заболевания слизистой оболочки рта':24,'КЗП':26,'Комплексное зубопротезирова- ние и имплантология тология (КЗП)':26}
def parse_clock(v):
 m=re.search(r'([0-9]{1,2})[:.]([0-9]{2})-([0-9]{1,2})[:.]([0-9]{2})',v)
 if not m:raise ValueError(v)
 return f'{int(m[1]):02d}:{m[2]}',f'{int(m[3]):02d}:{m[4]}'
by_group_day=collections.defaultdict(list)
for a,b,x,y,xx,yy in spans:
 if 15<=y<=18 and y==yy and 3<=x<=100:
  g=groups[y-15];v=' '.join(cells.get(a,'').split());ref=mapping.get(v)
  if ref is None:raise ValueError((a,v))
  refs=ref if isinstance(ref,tuple) else (ref,)
  for day in (days[c] for c in range(x,xx+1)):
   for r in refs:
    tcell='CI28' if r==28 and g in ('592','594') else f'CE{r}'
    start,end=parse_clock(cells[tcell]);by_group_day[g,day].append((start,end,cells[f'C{r}'],a))
    variants[g]+=1
for friday in fridays:
 day=datetime.date.fromisoformat(friday)
 for g in groups:by_group_day[g,day].append(('14:30','16:00',cells['C31'],'CE31'));variants[g]+=1
for (g,d),items in sorted(by_group_day.items()):
 for i,x in enumerate(items):
  for y in items[i+1:]:
   if x[0]<y[1] and y[0]<x[1]:
    overlaps.append(dict(group=g,date=str(d),first=x,second=y))


expected_sha='55f6431357309340f3a075d807814fa5ff3dd982d16230792ee24ec5f0e5cdff'
def gate(cond,name):
 if not cond:raise SystemExit('REVIEW_REQUIRED: '+name)
gate(qa['sourceSha']==expected_sha and qa['byteLength']==23903,'source identity')
gate(len(ranges)==127 and len(days)==122 and not mismatches,'merged geometry/calendar weekday')
gate([qa['coverage'][g] for g in groups]==[98]*4,'group cycle dates coverage')
gate([qa['groupBlocks'][g] for g in groups]==[8,8,8,9],'group cycle anchor count')
gate([x[0] for x in joints]==['C17','CD16','AY15','AH18'],'joint discipline anchors')
gate(all(len(x[3])==9 for x in joints),'joint block 9 dates each')
gate(len(fridays)==16 and fridays[0]=='2026-09-04' and fridays[-1]=='2026-12-18','mandatory Friday PE dates')
gate([x['label'] for x in infos]==['Практика','Каникулы','Экзамены'],'informational spans')
gate([x['columnCount'] for x in infos]==[12,6,6],'informational day grid length')
gate(not unknown and not qa['mismatches'],'uncovered or undecoded source')
gate(dict(variants)=={g:123 for g in groups},'mandatory timed event count')
gate([(o['group'],o['date']) for o in overlaps]==[('592','2026-09-04'),('594','2026-10-30'),('594','2026-11-06')],'explicit overlaps inventory')
result={'schema':'kgmu-dentistry5-c24-grid-audit-v1',
 'sourceSha256':qa['sourceSha'],'byteLength':len(raw),'status':'REVIEW_REQUIRED',
 'publicationAllowed':False,'parserProfile':'C','sourceSpecificRule':'C24',
 'dateHeaderCount':len(days),'mergedRangeCount':len(ranges),
 'groupCycleAnchors':{g:blockcounts[g] for g in groups},
 'groupCycleDateCoverage':qa['coverage'],
 'jointGroups':{t[2]:{'sourceRange':t[0]+':'+t[1],'dateFrom':t[3][0],'dateTo':t[3][-1],'dateCount':len(t[3])} for t in joints},
 'independentFridayPeDateCount':len(fridays),'independentFridayPeFirst':fridays[0],'independentFridayPeLast':fridays[-1],
 'informationPeriods':{x['label']:{'range':x['range'],'firstGridDate':x['start'],'lastGridDate':x['end'],'gridDateCount':x['columnCount']} for x in infos},
 'mandatoryTimedOccurrencesByGroup':{g:variants[g] for g in groups},
 'allDayInfoOccurrencesByGroup':{g:24 for g in groups},
 'projectedEventCountByGroup':{g:variants[g]+24 for g in groups},
 'projectedTotal':sum(variants.values())+96,
 'sourceBackedOverlaps':[{'group':o['group'],'date':o['date'],'first':{'discipline':o['first'][2],'time':o['first'][0]+'-'+o['first'][1],'sourceCell':o['first'][3]},'second':{'discipline':o['second'][2],'time':o['second'][0]+'-'+o['second'][1],'sourceCell':o['second'][3]}} for o in overlaps],
 'dateWeekdayMismatches':mismatches,'unknownCycleBlocks':unknown,
 'nextGate':'Normalize every occurrence into traceable ScheduleEvent with INFO override, classify 3 overlaps and pass PostgreSQL and full CI before publication.'}
print(json.dumps(result,ensure_ascii=False,sort_keys=True))

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIzhgmuMedicine6LectureStructure, IZHGMU_MEDICINE6_EXPECTED_GROUPS } from '../src/adapters/izhgmu/lecture-medicine6.mjs';
import { buildIzhgmuMedicine6LectureQaCandidate, buildIzhgmuMedicine6LectureCanonicalBatch } from '../src/adapters/izhgmu/lecture-medicine6-canonical.mjs';
function letters(value) { let n=value,out=''; while(n){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);} return out; }
function cell(row,col,value){return {ref:`${letters(col)}${row}`,row,col,value,runs:[],styleId:null};}
function merge(sr,sc,er,ec){return {startRef:`${letters(sc)}${sr}`,endRef:`${letters(ec)}${er}`,startRow:sr,endRow:er,startCol:sc,endCol:ec,ref:`${letters(sc)}${sr}:${letters(ec)}${er}`};}
const monthSpans=[[6,9,'Февраль'],[10,15,'Март'],[16,20,'Апрель'],[21,25,'Май'],[26,27,'Июнь']];
function putDates(cells,row,dates){const monthStart={2:6,3:10,4:16,5:21,6:26};const used={2:0,3:0,4:0,5:0,6:0};for(const iso of dates){const [,m,d]=iso.split('-').map(Number);cells.push(cell(row,monthStart[m]+used[m]++,String(d)));}}
function structure({unknown=false,badSlot=false,missingGia=false}={}){
  const cells=[cell(2,5,'ЛЕКЦИЙ ДЛЯ СТУДЕНТОВ 6 курса ЛЕЧЕБНОГО факультета на ВЕСЕННИЙ СЕМЕСТР 2025-2026 учебного года'),cell(3,4,'396 чел'),cell(3,16,'Начало весеннего семестра - 02 февраля 2026 г., окончание - 30 мая 2026 г.'),cell(4,6,'Пр. аттестация  01.06.2026 –08.06.2026')];
  if(!missingGia)cells.push(cell(5,6,'ГИА   09.06.2026- 22.06.2026'));
  cells.push(cell(6,1,'Дни недели'),cell(6,2,'Время'),cell(6,3,'Предмет'),cell(6,4,'Ауд.'),cell(6,5,'Неделя'),cell(6,28,'Кол-во лекций'));
  const merges=[];for(const[start,end,name]of monthSpans){cells.push(cell(6,start,name));merges.push(merge(6,start,6,end));}
  const rows=[
    [7,'Понедельник','13.00','Онкология','Акт.з.',['2026-02-16','2026-03-02','2026-03-16','2026-03-23','2026-03-30','2026-04-06','2026-04-13','2026-04-20','2026-04-27','2026-05-04'],10],
    [8,null,'14.45','Основы экстренной и неотложной помощи','Акт.з',['2026-02-16','2026-03-02','2026-03-16','2026-03-23','2026-03-30','2026-04-06','2026-04-13'],7],
    [9,null,'13.00','Фтизиатрия','Акт.з',['2026-02-02','2026-02-09'],null],[10,null,'14.45','Фтизиатрия','Акт.з',['2026-02-02','2026-02-09'],null],
    [11,null,'14.45','ДВ- 5 (БЖ)','6 ауд.',['2026-04-20','2026-04-27','2026-05-04','2026-05-11','2026-05-18','2026-05-25'],7],
    [12,null,'14.45','ДВ- 5 ( Лаб.диагностика)','2А ауд',['2026-04-20','2026-04-27','2026-05-04','2026-05-11','2026-05-18','2026-05-25'],7],
    [13,null,'14.45','ДВ- 5 (Наркология)','7 ауд.',['2026-04-20','2026-04-27','2026-05-04','2026-05-11','2026-05-18','2026-05-25'],7],
    [14,'Вторник','13.00','Коммуникативные навыки 1п','1 ауд.',['2026-02-10','2026-02-17','2026-02-24'],3],
    [15,null,'13.00','Основы современной хирургии','1 ауд.',['2026-03-03','2026-03-10','2026-03-17'],3],
    [16,null,'13.00','ДВ-5 (Гематология)','Ауд. 2',['2026-03-24','2026-03-31','2026-04-07','2026-04-14','2026-04-21','2026-04-28','2026-05-05'],7],
    [17,null,'13.00','ДВ-5 (Расстройства личности)','Ауд. 3',['2026-03-24','2026-03-31','2026-04-07','2026-04-14','2026-04-21','2026-04-28','2026-05-05'],7],
    [18,null,'13.00','Фтизиатрия','1 ауд.',['2026-02-03'],null],[19,null,'14.45','Фтизиатрия','1 ауд.',['2026-02-03','2026-02-10'],7],
    [20,'Среда','13.00','Поликл.терапия','Акт.з.',['2026-02-04','2026-02-11','2026-02-18','2026-02-25','2026-03-04','2026-03-11','2026-03-18','2026-03-25','2026-04-01','2026-04-08','2026-04-15'],11],
    [21,null,'14.45','Эпидемиология','Акт.з.',['2026-02-04','2026-02-11','2026-02-18','2026-02-25','2026-03-04','2026-03-11','2026-03-18','2026-03-25','2026-04-01','2026-04-08'],10],
    [22,'Четверг','13.00','Избр.вопр.терапии ','1 ауд.',['2026-02-05','2026-02-12','2026-02-19','2026-02-26','2026-03-05','2026-03-12','2026-03-19'],7],
    [23,null,'13.00','ДВ- 4 (Акт.вопр.онкологии)','1 ауд.',['2026-03-26','2026-04-02','2026-04-09','2026-04-16','2026-04-23','2026-04-30','2026-05-07'],7],
    [24,null,'13.00','ДВ-4 (Основы хирургии военно-полевой травмы)','2 ауд.',['2026-03-26','2026-04-02','2026-04-09','2026-04-16','2026-04-23','2026-04-30','2026-05-07'],7],
    [25,null,'14.45','ДВ-4 (Ульрозвуковая  топогр.и патотопогр.анатом.)','2 ауд.',['2026-02-05','2026-02-12','2026-02-19','2026-02-26','2026-03-05','2026-03-12','2026-03-19'],7],
    [26,null,'14.45','ДВ-4 (Юр.защита и без.врача)','1 ауд.',['2026-02-05','2026-02-12','2026-02-19','2026-02-26','2026-03-05','2026-03-12','2026-03-19'],7],
    [27,'Пятница','13.00','Госпитальня терапия','Акт.з.',['2026-02-06','2026-02-13','2026-02-20','2026-02-27','2026-03-06','2026-03-20','2026-03-27','2026-04-03','2026-04-10','2026-04-17'],10],
    [28,null,'14.45','Функциональная диагностика в клинике вн.болезней','Акт.з.',['2026-02-06','2026-02-13','2026-02-20','2026-02-27','2026-03-06','2026-03-20','2026-03-27'],7],
    [29,null,'14.45','ДВ- 4  (Фитотерапия)','Акт.з.',['2026-04-03','2026-04-10','2026-04-17','2026-04-24','2026-05-08','2026-05-15','2026-05-22'],7],
    [30,null,'14.45','ДВ-4  (Основы  комплем. медицины)','Ауд. 2',['2026-04-03','2026-04-10','2026-04-17','2026-04-24','2026-05-08','2026-05-15','2026-05-22'],7],
    [31,'Суббота','13.00','Коммуникативные навыки 2п','1 ауд.',['2026-02-07','2026-02-14','2026-02-21'],null],
  ];
  if(unknown)rows[0][3]='Новая дисциплина';if(badSlot)rows[0][2]='12.00';
  for(const[sr,er]of[[7,13],[14,19],[20,21],[22,26],[27,30],[31,31]])merges.push(merge(sr,1,er,1));
  for(const[r,day,time,subj,room,dates,count]of rows){if(day)cells.push(cell(r,1,day));cells.push(cell(r,2,time),cell(r,3,subj),cell(r,4,room),cell(r,5,'ежен.'));putDates(cells,r,dates);if(count!=null)cells.push(cell(r,28,String(count)));}
  const roster=[['ДВ- 5 (БЖ)',77],['ДВ- 5 ( Лаб.диагностика)',77],['ДВ- 5 (Наркология)',77],['ДВ-5 (Гематология)',78],['ДВ-5 (Расстройства личности)',77],['ДВ- 4 (Акт.вопр.онкологии)',50],['ДВ-4 (Основы хирургии военно-полевой травмы)',40],['ДВ-4 (Юр.защита и без.врача)',90],['ДВ-4 (Ульрозвуковая топогр.и патотопогр.анатом.)',66],['ДВ- 4 (Фитотерапия)',40],['ДВ-4 (Основы комплем. медицины)',100]];
  roster.forEach(([label,count],i)=>{const row=10+i;cells.push(cell(row,29,label),cell(row,30,String(count)));});
  return{styles:[],sheets:[{name:'Лекции',cells,merges,styledCells:[]}]};
}

test('medicine-6 lecture boundary keeps course-wide core safe and stream/electives deferred',()=>{
  const p=parseIzhgmuMedicine6LectureStructure(structure(),{courseGroups:IZHGMU_MEDICINE6_EXPECTED_GROUPS});
  assert.equal(p.stats.sourceRows,25);assert.equal(p.stats.coreOccurrences,78);assert.equal(p.stats.courseWideCoreOccurrences,72);assert.equal(p.stats.streamOccurrences,6);assert.equal(p.stats.electiveOccurrences,74);assert.equal(p.stats.electiveOptionCount,11);assert.equal(p.stats.electiveDeclaredCountMismatchRows,3);assert.equal(p.stats.structuralReviewCount,0);assert.equal(p.stats.periodMarkerCount,2);assert.deepEqual(p.stats.electiveRosterTotals,{4:386,5:386});
  assert.deepEqual(p.periodMarkers.map(x=>[x.kind,x.startDate,x.endDateInclusive]),[['preliminary_attestation','2026-06-01','2026-06-08'],['gia','2026-06-09','2026-06-22']]);
  assert.equal(p.courseWideCoreSeries[0].groups.length,30);assert.equal(p.streamSeries.every(x=>x.groups.length===0),true);assert.deepEqual(p.blockers.map(x=>x.warning),['stream_group_mapping_required','elective_choice_required']);assert.equal(p.publishable,false);
  const fti=p.series.filter(x=>x.discipline==='Фтизиатрия');assert.equal(fti.reduce((n,x)=>n+x.dates.length,0),7);assert.equal(fti.find(x=>x.declaredCount===7).declaredCountScope,'discipline_total');
});

test('medicine-6 lecture boundary fails closed on new core semantics',()=>{
  const a=parseIzhgmuMedicine6LectureStructure(structure({unknown:true}),{courseGroups:IZHGMU_MEDICINE6_EXPECTED_GROUPS});assert.equal(a.reviewRequired.some(x=>x.warnings.includes('medicine6_lecture_discipline_unknown')),true);
  const b=parseIzhgmuMedicine6LectureStructure(structure({badSlot:true}),{courseGroups:IZHGMU_MEDICINE6_EXPECTED_GROUPS});assert.equal(b.reviewRequired.some(x=>x.warnings.includes('medicine6_lecture_slot_unreviewed')),true);
  assert.throws(()=>parseIzhgmuMedicine6LectureStructure(structure({missingGia:true})),e=>e.code==='IZH_L6_PERIOD_MARKER_CHANGED');assert.throws(()=>parseIzhgmuMedicine6LectureStructure(structure(),{courseGroups:['601']}),e=>e.code==='IZH_L6_GROUP_SET_CHANGED');
});

test('medicine-6 course-wide lecture projection gives 72 canonical events but production stays blocked',()=>{
  const parsed=parseIzhgmuMedicine6LectureStructure(structure(),{courseGroups:IZHGMU_MEDICINE6_EXPECTED_GROUPS});const input={parsed,metadata:{academicYear:'2025-2026',semester:'spring',facultyCode:'medicine',course:6,groupCode:'601',stream:null},source:{fileName:'26_medicine_course-6_lecture_ru.xlsx',fileHash:'abc'}};const candidate=buildIzhgmuMedicine6LectureQaCandidate(input);assert.equal(candidate.events.length,72);assert.equal(candidate.events.every(e=>e.lesson.type.code==='lecture'&&e.audience.group==='601'),true);assert.throws(()=>buildIzhgmuMedicine6LectureCanonicalBatch(input),e=>e.code==='IZH_LECTURE_M6_INCOMPLETE'&&e.blockers.length===2);
});

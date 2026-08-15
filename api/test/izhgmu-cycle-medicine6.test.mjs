import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIzhgmuMedicine6CycleStructure, verifyIzhgmuMedicine6LectureGlossaryStructure } from '../src/adapters/izhgmu/cycle-medicine6.mjs';

function letters(value) { let n = value; let out = ''; while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; }
function cell(row, col, value) { return { ref: `${letters(col)}${row}`, row, col, value, runs: [], styleId: null }; }
function sourceDates() {
  const omitted = new Set(['2026-02-23','2026-03-09','2026-05-01','2026-05-09']); const out = [];
  for (let current = new Date('2026-02-02T00:00:00Z'); current <= new Date('2026-05-30T00:00:00Z'); current.setUTCDate(current.getUTCDate() + 1)) {
    const iso = current.toISOString().slice(0, 10); const weekday = current.getUTCDay();
    if (weekday !== 0 && !omitted.has(iso)) out.push(iso);
  }
  return out;
}
const weekday = ['вс','пн','вт','ср','чт','пт','сб'];
const tokenDefs = [['Эпидемиолог',11],['ФтизиатриЭ',13],['Совхр',5],['Поликтер',8],['Комнав',6],['Госптерап',10],['Избрвоптер',10],['Онкология',10],['Фундиг',6],['Неотпом',7],['Дисвб5',6],['Дисвб4',6]];
function makeStructure({ unknown = false } = {}) {
  const dates = sourceDates(); assert.equal(dates.length, 98); const cells = [cell(1,1,'Начало весеннего семестра - 02 февраля 2026 г., окончание - 30 мая 2026 г.')];
  dates.forEach((iso, index) => { const d = new Date(`${iso}T00:00:00Z`); cells.push(cell(3, 2 + index, String(d.getUTCDate()))); cells.push(cell(4, 2 + index, weekday[d.getUTCDay()])); });
  for (let i = 0; i < 15; i += 1) {
    const row = 5 + i; const start = 601 + i * 2; cells.push(cell(row, 1, `${start}-${start + 1}`)); let col = 2;
    for (let t = 0; t < tokenDefs.length; t += 1) { const [token, len] = tokenDefs[t]; cells.push(cell(row, col, unknown && i === 0 && t === 0 ? 'Неизвестно' : token)); col += len; }
  }
  const metaRow = 20; cells.push(cell(metaRow,1,'Кафедра'), cell(metaRow+1,1,'Время'), cell(metaRow+2,1,'Форма контроля'), cell(metaRow+3,1,'База практической подготовки'));
  const metadata = [
    ['Каф. госпитальной терапии с курсами кардиологии и функциональной диагностики ФПКиПП','8.00-09.30\n09.40-11.50','Экзамен','РКДЦ'],
    ['Фтизиатрии','8.00-09.30\n09.40-12.05','Экзамен (в семестре)','РКТБ'],
    ['Внутренних болезней с курсами лучевых методов диагностики и лечения, ВПТ','8.00-09.30\n09.40-11.35','Зачет','ГКБ6'],
    ['Хирургических болезней с курсом анестезиологии и реаниматологии ФПК и ПП','8.00-09.30\n09.40-11.45','Зачет','ГКБ9'],
    ['Онкологии','8.00-09.30\n09.40-11.45','Зачет','РКОД'],
    ['Инфекционных болезней и эпидемиологии','8.00-09.30\n09.40-12.05','Зачет','РКИБ'],
    ['Поликлинической ткрапии','8.00-09.30\n09.40-11.50','Экзамен','Базы кафедры'],
    ['Госпитальной хирургии','8.00-09.30\n09.40-11.50','Зачет','ГКБ2'],
    ['Каф. госпитальной терапии с курсами кардиологии и функциональной диагностики ФПК И ПП','8.00-09.30\n09.40-11.50','Зачет','РКДЦ'],
    ['Кафедра педагогики, психологии и психосоматической медицины','8.00-09.30\n09.40-11.35','Зачет','Морфкорпус'],
  ];
  metadata.forEach((values, index) => values.forEach((value, off) => cells.push(cell(metaRow + off, 2 + index, value))));
  const erow = 25; cells.push(cell(erow,2,'ДВ 4 (ЗАЧЕТ)'), cell(erow,35,'ДВ 5 (ЗАЧЕТ)'), cell(erow+1,2,'8.00-09.30\n09.40-11.50'), cell(erow+1,35,'8.00-09.30\n09.40-11.50'));
  const d4 = ['Актуальные вопросы онкологии','Фитотерапия в практике врача','Юридическая защита и безопасность врача','Физиологические основы комплементарной медицины','Основы хирургии военно-полевой травмы','Ультразвуковая топографическая и патотопографическая анатомия'];
  const d5 = ['Экстремальная медицина','Основы клинической лабораторной диагностики','Наркология','Вопросы гематологии и гемотрансфузиологии','Расстройства личности'];
  d4.forEach((name,i) => { const col = 2 + i*5; cells.push(cell(erow+2,col,name),cell(erow+3,col,`Кафедра ДВ4 ${i+1}`),cell(erow+4,col,`База ДВ4 ${i+1}`)); });
  d5.forEach((name,i) => { const col = 35 + i*5; cells.push(cell(erow+2,col,name),cell(erow+3,col,`Кафедра ДВ5 ${i+1}`),cell(erow+4,col,`База ДВ5 ${i+1}`)); });
  return { sheets: [{ name:'практич.занятия', cells, merges:[], styledCells:[] }], styles:[] };
}

test('medicine-6 exact cycle keeps 86 safe events and two elective blockers', () => {
  const parsed = parseIzhgmuMedicine6CycleStructure(makeStructure(), { groupCode:'601' });
  assert.equal(parsed.sourceProfile, 'IZH-CYCLE-MEDICINE6'); assert.equal(parsed.stats.dateColumns, 98); assert.equal(parsed.stats.groupRows, 15);
  assert.equal(parsed.stats.safeSeries, 10); assert.equal(parsed.stats.safeEventCount, 86); assert.equal(parsed.stats.electiveBlockCount, 2); assert.equal(parsed.stats.electiveAlternativeCount, 11);
  assert.equal(parsed.reviewRequired.length, 2); assert.deepEqual(parsed.reviewRequired.map((item) => item.electiveSlot).sort(), [4,5]);
  assert.equal(parsed.series.find((item) => item.discipline === 'Функциональная диагностика в клинике внутренних болезней').endTime, '11:50');
  assert.equal(parsed.series.find((item) => item.discipline === 'Основы экстренной и неотложной помощи').department.startsWith('Хирургических болезней'), true);
  assert.deepEqual(parsed.series[0].jointGroups, ['602']); assert.equal(parsed.publishable, false);
});

test('medicine-6 exact cycle fails closed on a new token', () => {
  assert.throws(() => parseIzhgmuMedicine6CycleStructure(makeStructure({ unknown:true }), { groupCode:'601' }), (error) => error.code === 'IZH_CYCLE_M6_TOKEN_UNKNOWN');
});

test('medicine-6 lecture companion must contain the reviewed glossary', () => {
  const values = ['Эпидемиология','Фтизиатрия','Основы современной хирургии','Поликл.терапия','Коммуникативные навыки 1п','Госпитальня терапия','Избр.вопр.терапии','Онкология','Функциональная диагностика в клинике вн.болезней','Основы экстренной и неотложной помощи'];
  const structure = { styles:[], sheets:[{ name:'Лекции', merges:[], styledCells:[], cells:values.map((value,index) => cell(index+1,1,value)) }] };
  assert.equal(verifyIzhgmuMedicine6LectureGlossaryStructure(structure).confirmed.length, 10);
});

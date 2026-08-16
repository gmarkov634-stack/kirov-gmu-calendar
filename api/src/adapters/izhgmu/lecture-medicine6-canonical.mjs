const FACULTY_NAMES = Object.freeze({ medicine: 'Лечебный факультет', pediatrics: 'Педиатрический факультет', dentistry: 'Стоматологический факультет' });
const REFERENCE_ROLE = Object.freeze({ discipline:'lesson', date:'date', start_time:'time', end_time:'time', time:'time', location:'location', declared_count:'note', note:'note', other:'other' });
function requiredString(value,name){const s=String(value??'').trim();if(!s)throw new TypeError(`${name} is required`);return s;}
function optionalString(value){const s=String(value??'').trim();return s||null;}
function academicYear(value){const m=String(value||'').match(/(20\d{2})\D+(20\d{2}|\d{2})/);if(!m)throw new TypeError('metadata.academicYear must identify one academic year');const start=Number(m[1]);let end=Number(m[2]);if(m[2].length===2)end=Math.floor(start/100)*100+end;if(end!==start+1)throw new TypeError('metadata.academicYear must identify consecutive years');return `${start}/${end}`;}
function semester(value){if(value==='autumn'||Number(value)===1)return'autumn';if(value==='spring'||Number(value)===2)return'spring';if(value==='summer'||value==='other')return value;throw new TypeError('metadata.semester must be autumn/spring/summer/other or 1/2');}
function emptyDerived(){return{academic_week:null,sequence:{index:null,total:null,bucket:null},next_same_event:null,is_last_same_event:false,day:{index:null,total:null,remaining:null,next_event:null,gap_minutes:null,overlaps_next:false},cycle:null,assessment:null};}
function canonicalReferences(series){return(series.references||[]).map((ref)=>({role:REFERENCE_ROLE[String(ref.role||'').trim()]||'other',range:requiredString(ref.range,'series.references[].range')}));}
function canonicalLocation(value){const raw=optionalString(value);return raw?{raw,building:null,room:null,address:null}:null;}
function blockers(parsed){return[
  ...(parsed?.reviewRequired||[]).map((item)=>({kind:'series_review',warning:item.warning||item.warnings?.[0]||'needs_review',reference:item.references?.[0]?.range||null,discipline:item.discipline||item.disciplineRaw||null})),
  ...(parsed?.blockers||[]).map((item)=>({kind:item.warning==='elective_choice_required'?'elective_choice':'audience_mapping',warning:item.warning,reference:null,discipline:null,streams:item.streams||null,slots:item.slots||null,occurrences:item.occurrences||0})),
];}
export function izhgmuMedicine6LectureBlockers(parsed){return blockers(parsed);}
export function assertIzhgmuMedicine6LectureComplete(parsed){const items=blockers(parsed);if(!parsed?.publishable||items.length){const e=new Error(`IZH-LECTURE-MEDICINE6 source is incomplete: ${items.length} blocker(s)`);e.code='IZH_LECTURE_M6_INCOMPLETE';e.blockers=items;throw e;}return parsed;}
function normalizeInputs({parsed,metadata,source}){
  if(parsed?.profile!=='IZH-LECTURE-MEDICINE6')throw new TypeError('IZH-LECTURE-MEDICINE6 parsed result is required');
  const group=requiredString(metadata?.groupCode,'metadata.group');
  if(!parsed.courseGroups?.includes(group))throw new TypeError(`metadata.group is not in the reviewed medicine-6 course group set: ${group}`);
  const course=Number(metadata?.course);if(course!==6)throw new TypeError('metadata.course must be 6');
  return{metadata:{academicYear:academicYear(metadata?.academicYear),semester:semester(metadata?.semester),facultyCode:requiredString(metadata?.facultyCode,'metadata.facultyCode'),course,group,stream:optionalString(metadata?.stream)},source:{fileName:requiredString(source?.fileName,'source.fileName'),fileHash:optionalString(source?.fileHash)}};
}
function eventForDate({series,date,metadata,source}){const location=canonicalLocation(series.location);const discipline=requiredString(series.discipline,'series.discipline');return{
  schema_version:'1.0',system:{event_id:null,schedule_version_id:null,fingerprint:null,revision:null,created_at:null,updated_at:null},
  university:{code:'izhgmu',name:'Ижевский государственный медицинский университет'},
  academic:{academic_year:metadata.academicYear,semester:metadata.semester,faculty_code:metadata.facultyCode,faculty_name:FACULTY_NAMES[metadata.facultyCode]||null,course:metadata.course},
  audience:{group:metadata.group,scope:'whole_group',subgroups:[],stream:metadata.stream},
  timing:{date,start_time:requiredString(series.startTime,'series.startTime'),end_time:requiredString(series.endTime,'series.endTime'),all_day:false,time_mode:'floating'},
  lesson:{discipline:{raw:discipline,normalized:discipline},type:{raw:'лекция',code:'lecture'},teachers:[],locations:location?[location]:[],source_note:null,cycle_id:null,joint_groups:[]},
  source:{file_name:source.fileName,file_hash:source.fileHash,sheet:requiredString(series.sourceSheet,'series.sourceSheet'),references:canonicalReferences(series),raw_text:optionalString(series.rawSource)},
  parse:{status:series.status,rule_ids:[...new Set((series.ruleIds||[]).map(String).map(v=>v.trim()).filter(Boolean))],warnings:[...new Set((series.warnings||[]).map(String).map(v=>v.trim()).filter(Boolean))]},
  derived:emptyDerived(),calendar:{title:null,description:null,location:null},
};}
function candidate({parsed,metadata,source,parserName}){const n=normalizeInputs({parsed,metadata,source});const events=[];const projectionSeries=[...(parsed.courseWideCoreSeries||[]),...(parsed.resolvedStudentSeries||[])];for(const series of projectionSeries){if(series.status!=='ok'||!series.groups?.includes(n.metadata.group)||!series.startTime||!series.endTime)continue;for(const date of [...new Set(series.dates||[])])events.push(eventForDate({series,date,metadata:n.metadata,source:n.source}));}events.sort((a,b)=>`${a.timing.date}T${a.timing.start_time}`.localeCompare(`${b.timing.date}T${b.timing.start_time}`));return{schema_version:'1.0',schedule:{university_code:'izhgmu',academic_year:n.metadata.academicYear,semester:n.metadata.semester,faculty_code:n.metadata.facultyCode,course:n.metadata.course,group:n.metadata.group,period:{start_date:parsed.period.start_date,end_date:parsed.period.end_date,week1_start_date:parsed.period.week1_start_date},source_files:[n.source.fileName],generated_at:null,parser:parserName,schedule_version_id:null,previous_schedule_version_id:null,content_fingerprint:null,version_created_at:null},events};}
export function buildIzhgmuMedicine6LectureQaCandidate(input){return candidate({...input,parserName:'izhgmu-lecture-medicine6-v1-qa-candidate'});}
export function buildIzhgmuMedicine6LectureCanonicalBatch(input){assertIzhgmuMedicine6LectureComplete(input.parsed);return candidate({...input,parserName:'izhgmu-lecture-medicine6-v1'});}

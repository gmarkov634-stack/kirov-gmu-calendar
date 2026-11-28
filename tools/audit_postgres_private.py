#!/usr/bin/env python3
"""Local-only rollback compatibility audit; private temporary PostgreSQL cluster.
Uses exact frozen registry assets and existing source-specific local regressions.
Never accesses the configured working database or any external service.
"""
import gzip, hashlib, json, os, pathlib, re, subprocess, sys, tempfile
from pathlib import Path

ROOT=Path.home()/"medschedule-local"
SOURCE=ROOT/"source-review"
INTAKE=SOURCE/"canonical-intake-20261126"
REG=INTAKE/"export/qa/2026-2027-semester-1/intake-2026-11-26"
BIN=Path("/usr/lib/postgresql/16/bin")
PY=ROOT/".venv/bin/python"
MAIN=ROOT/"platform"
SHEET=INTAKE/"platform-sheet-provenance-20261128"
REPLAY=Path((INTAKE/"dentistry-replay-workdir").read_text().strip())
CASES={
 "dentistry-191-194":("candidate/test_local_candidate_compatibility.py","KGMU_DENT1_BUNDLE","candidate/qa-only-bundle.json"),
 "dentistry-291-294":("local-reviewed-draft-v2/test_local_dentistry_291_294_compatibility.py","KGMU_DENT2_ENGINE_ROOT",None),
 "dentistry-391-394":("test_local_dentistry_391_394_full.py","KGMU_DENT3_BUNDLE","bundle-local.json"),
 "dentistry-491-494":("test_local_dentistry_491_494.py","KGMU_DENT4_BUNDLE","bundle-local.json"),
 "dentistry-591-594":("platform-pr61/tests/test_kgmu_dentistry_591_594_pg_review.py","KGMU_DENT5_DRAFT","normalized-draft.json"),
 "medicine-101-110":("test_local_medicine_101_110.py","KGMU_COURSE1_BUNDLE","bundle-local.json"),
 "medicine-111-120":("test_local_medicine_111_120_final.py","KGMU_COURSE1_BUNDLE","bundle-final-local.json"),
 "medicine-211-220":("test_local_medicine_211_220.py","KGMU_MED2_BUNDLE","bundle-local.json"),
 "medicine-501-516":("test_local_medicine_501_516.py","KGMU_MED5_BUNDLE","bundle-local.json"),
 "pediatrics-231-239":("test_local_pediatrics_231_239_full.py","KGMU_PED2_BUNDLE","bundle-local.json"),
 "pediatrics-331-337":("test_local_pediatrics_331_337_full.py","KGMU_PED3_BUNDLE","bundle-local.json"),
 "pediatrics-631-637":("test_local_pediatrics_631_637.py","KGMU_PED6_BUNDLE","bundle-local.json"),
}
def read(p): return json.loads(p.read_bytes())
def sha(b): return hashlib.sha256(b).hexdigest()
def ev(d): return d["events"] if "events" in d else d["parsingResult"]["events"]
def digest(v): return "sha256:"+sha(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode())
def command(args,env=None,cwd=None,check=True):
    return subprocess.run([str(x) for x in args],env=env,cwd=cwd,check=check,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
def require(v,msg):
    if not v: raise RuntimeError(msg)
def sheet_continuity(env,work,sock,entry):
    profile="medicine-111-120";source=SOURCE/profile/entry["sourceSha256"]
    old=source/"bundle-final-local.json";new=work/"corrected.json"
    export=INTAKE/"export"
    node_code=r"""
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { correctExactSheet } from './tools/replay_reviewed_intake.mjs';
import { expandExplicitDecisionManifest, digestNormalizedEvents } from './src/explicit-decisions.js';
import { expandMedicineFacultativeFixture } from './src/medicine-publication-plan.js';
const [old,out,sha]=process.argv.slice(1);
const bundle=JSON.parse(readFileSync(old));
const fixed=correctExactSheet(bundle,{sourceSha256:sha});
const ctx={universityId:bundle.source.universityId,academicPeriodId:bundle.source.academicPeriodId,sourceId:bundle.source.source.sourceId};
const compare=(a,b)=>Number(a.groupId)-Number(b.groupId)||a.date.localeCompare(b.date)||(a.startTime??'').localeCompare(b.startTime??'')||(a.endTime??'').localeCompare(b.endTime??'')||a.discipline.localeCompare(b.discipline)||a.lessonType.localeCompare(b.lessonType)||a.sourceRef.locator.localeCompare(b.sourceRef.locator);
const base=expandExplicitDecisionManifest(fixed.manifest,ctx);
fixed.manifest.candidateDigest=digestNormalizedEvents(base);
const events=[...base,...expandMedicineFacultativeFixture(fixed.facultatives,ctx)].sort(compare);
const strip=e=>{const {eventId,sourceRef,...v}=e;return {...v,sourceRef:{sourceId:sourceRef.sourceId,locator:sourceRef.locator.split('!')[1]}}};
assert.deepEqual(events.map(strip),bundle.parsingResult.events.map(strip));
assert(events.every(e=>e.sourceRef.locator.startsWith('1 леч. 2  !')));
fixed.parsingResult.events=events;
fixed.qaReport.candidateDigest=digestNormalizedEvents(events);
assert.equal(fixed.qaReport.candidateDigest,'sha256:97fd0f8812e4d256693e5e6034933313e73176272064d55a5a8edf94a9b5ebe4');
assert.equal(fixed.qaReport.publicationAllowed,false);
writeFileSync(out,JSON.stringify(fixed));
"""
    command(["/usr/local/bin/node","--input-type=module","-e",node_code,old,new,entry["sourceSha256"]],env,export)
    test=(source/"test_local_medicine_111_120_final.py").read_text()
    require(test.count('row.source_sheet == "1 леч. 2"')==1,"test source assertion")
    keys=[]
    for label,bundle,platform,sheet in [("original",old,MAIN,"1 леч. 2"),("corrected",new,SHEET,"1 леч. 2  ")]:
        keyfile=work/(label+"-keys.json")
        testfile=work/("test_"+label+".py")
        modified=test.replace('row.source_sheet == "1 леч. 2"','row.source_sheet == '+repr(sheet))
        needle='        assert len({row.stable_key for row in rows}) == 4293'
        require(modified.count(needle)==1,"stable-key assertion")
        modified=modified.replace(needle,needle+'\n        Path(os.environ["AUDIT_KEYS"]).write_text(json.dumps(sorted(row.stable_key for row in rows)))')
        testfile.write_text(modified)
        tenv=dict(env,PYTHONPATH=str(platform/"src"),KGMU_COURSE1_BUNDLE=str(bundle),AUDIT_KEYS=str(keyfile))
        result=command([PY,"-m","pytest","-q","-o","addopts=","-p","no:cacheprovider",testfile],tenv,work,check=False)
        print("SHEET_CONTINUITY",label,result.stdout.strip()[-2400:],flush=True)
        require(result.returncode==0 and re.search(r"\b1 passed\b",result.stdout),"sheet test failed")
        require(command([BIN/"psql","-X","-Atc","select (select count(*) from schedule_versions),(select count(*) from schedule_events),(select count(*) from universities),(select count(*) from schedule_imports)"],env).stdout.strip()=="0|0|0|0","sheet rollback")
        vals=read(keyfile)
        require(len(set(vals))==4293,"keys")
        keys.append(set(vals))
    overlap=len(keys[0]&keys[1])
    return {"sourceSha256":entry["sourceSha256"],"originalEventSetDigest":entry["eventSetDigest"],"correctedEventSetDigest":read(new)["qaReport"]["candidateDigest"],"eventCount":4293,"originalSheet":"1 леч. 2","correctedSheet":"1 леч. 2  ","originalKeys":len(keys[0]),"correctedKeys":len(keys[1]),"unchangedKeys":overlap,"changedKeys":4293-overlap,"semanticDifferences":0,"exactSheetPersistence":"PASS","rollbackVerified":True,"continuityGate":"BLOCKED" if overlap!=4293 else "PASS","publicationAllowed":False}

def run():
    registry=read(REG/"registry.json")
    require(command(["git","-C",MAIN,"rev-parse","HEAD"]).stdout.strip()==registry["platformBaseCommit"],"platform pin")
    require(not command(["git","-C",MAIN,"status","--porcelain"]).stdout.strip(),"platform dirty")
    baseenv={k:v for k,v in os.environ.items() if not (k.startswith(("PG","KGMU_","S3_","AWS_","MAX_","YOOKASSA_","DATABASE_")))}
    with tempfile.TemporaryDirectory(prefix="medschedule-review-pg-") as tmp:
        work=Path(tmp);sock=work/"sock";sock.mkdir(mode=0o700)
        data=work/"data";log=work/"postgres.log"
        env=dict(baseenv,PGHOST=str(sock),PGPORT="55433",PGUSER=os.environ["USER"],PGDATABASE="medschedule_local",DATABASE_URL="postgresql+psycopg:///medschedule_local",PYTHONPATH=str(MAIN/"src"),PYTHONDONTWRITEBYTECODE="1")
        command([BIN/"initdb","-D",data,"--no-locale","--encoding=UTF8","--auth-local=trust","--auth-host=reject"],env)
        command([BIN/"pg_ctl","-D",data,"-l",log,"-w","-o",f"-k {sock} -p 55433 -c listen_addresses='' -c unix_socket_permissions=0700","start"],env)
        try:
            command([BIN/"createdb","medschedule_local"],env)
            check=command([BIN/"psql","-X","-Atc","select current_database(),inet_server_addr() is null,current_setting('unix_socket_directories')"],env).stdout.strip()
            require(check==f"medschedule_local|t|{sock}","wrong database: "+check)
            command([PY,"-m","alembic","upgrade","head"],env,MAIN)
            revision=command([BIN/"psql","-X","-Atc","select version_num from alembic_version"],env).stdout.strip()
            print("PRIVATE_POSTGRES",revision,flush=True)
            rows=[]
            for profile,(test,key,rel) in CASES.items():
                entry=next(x for x in registry["sources"] if x.get("package","").startswith("packages/"+profile+"-"))
                s=entry["sourceSha256"];src=SOURCE/profile/s
                raw=(SOURCE/"objects"/(s+".xlsx")).read_bytes()
                require(sha(raw)==s and len(raw)==entry["byteLength"],profile+" raw")
                packed=(REG/entry["package"]).read_bytes()
                require(sha(packed)==entry["packageSha256"],profile+" package")
                unpacked=gzip.decompress(packed)
                require(sha(unpacked)==entry["uncompressedSha256"],profile+" gzip")
                pkg=json.loads(unpacked)
                files={a["path"]:a for a in pkg["artifacts"]}
                require(all(sha(a["content"].encode())==a["sha256"] for a in files.values()),profile+" artifact")
                original=ev(json.loads(files[pkg["originalCandidatePath"]]["content"]))
                require(digest(original)==entry["eventSetDigest"] and len(original)==entry["eventCount"],profile+" digest")
                require(pkg["publicationAllowed"] is False,profile+" gate")
                p=src/rel if rel else src/"local-reviewed-draft-v2/finalization"
                if profile in ("dentistry-391-394","dentistry-491-494"):
                    p=REPLAY/"source-review"/profile/s/rel
                if rel:
                    require(ev(read(p))==original,profile+" candidate changed")
                else:
                    require(ev(read(p/"qa/2026-2027-semester-1/dentistry-291-294.normalized-draft.json"))==original,profile+" candidate changed")
                    require(ev(read(REPLAY/"kgmu-engine/qa/2026-2027-semester-1/dentistry-291-294.normalized-draft.json"))==original,profile+" replay changed")
                tenv=dict(env,**{key:str(p)})
                scope="MAIN_PIN"
                platform=MAIN
                if profile=="dentistry-591-594":
                    platform=src/"platform-pr61";scope="ISOLATED_PR61_SNAPSHOT"
                    tenv.update(KGMU_DENT5_ENGINE_ROOT=str(src/"engine-replay"),KGMU_DENT5_XLSX=str(SOURCE/"objects"/(s+".xlsx")))
                tenv["PYTHONPATH"]=str(platform/"src")
                # Verify the test imports the intended code and connects only to our private socket.
                pcheck=command([PY,"-c","import medschedule,sqlalchemy as sa,os; from medschedule.integrations.kgmu import ingestion; print(ingestion.__file__); e=sa.create_engine(os.environ['DATABASE_URL']); c=e.connect(); print(c.exec_driver_sql(\"select current_setting('unix_socket_directories')\").scalar_one()); c.close(); e.dispose()"],tenv,work).stdout.splitlines()
                require(Path(pcheck[0]).is_relative_to(platform/"src") and pcheck[1]==str(sock),profile+" isolation")
                result=command([PY,"-m","pytest","-q","-o","addopts=","-p","no:cacheprovider",src/test],tenv,work,check=False)
                require(result.returncode!=0 or re.search(r"\b1 passed\b",result.stdout),profile+" skipped: "+result.stdout)
                count=command([BIN/"psql","-X","-Atc","select (select count(*) from schedule_versions),(select count(*) from schedule_events),(select count(*) from universities),(select count(*) from schedule_imports)"],env).stdout.strip()
                require(count=="0|0|0|0",profile+" rollback incomplete: "+count)
                passed=result.returncode==0
                row=dict(profile=profile,eventCount=len(original),eventSetDigest=digest(original),sourceSha256=s,packageSha256=entry["packageSha256"],test=test,testSha256=sha((src/test).read_bytes()),platformScope=scope,result="PASS" if passed else "FAIL",rollbackVerified=True,publicationAllowed=False)
                rows.append(row)
                print(profile,row["result"],len(original),result.stdout.strip()[-450:] if passed else result.stdout.strip()[-2400:],flush=True)
            continuity=sheet_continuity(env,work,sock,next(e for e in registry["sources"] if e.get("package","").startswith("packages/medicine-111-120-")))
            print("SHEET_CONTINUITY_RESULT",json.dumps(continuity,ensure_ascii=False),flush=True)
            report=dict(sheetContinuity=continuity,schema="kgmu-local-postgres-compatibility-v1",engineBaseCommit=registry["engineBaseCommit"],platformBaseCommit=registry["platformBaseCommit"],migration=revision,postgresVersion=command([BIN/"psql","-X","-Atc","show server_version"],env).stdout.strip(),sourceCount=len(rows),eventCount=sum(r["eventCount"] for r in rows if r["result"]=="PASS"),sources=rows,publicationAllowed=False,releaseGate="REVIEW_REQUIRED",privateUnixSocketOnly=True)
            (INTAKE/"postgres-compatibility-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2,sort_keys=True)+"\n")
            print("REPORT",report["sourceCount"],report["eventCount"],"PASS_COUNT",sum(r["result"]=="PASS" for r in rows),flush=True)
        finally:
            command([BIN/"pg_ctl","-D",data,"-m","fast","-w","stop"],env)
    return report
if __name__=="__main__":
    r=run()
    sys.exit(0 if all(s["result"]=="PASS" for s in r["sources"]) else 2)


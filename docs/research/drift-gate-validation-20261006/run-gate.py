from pathlib import Path
import subprocess, os, json, hashlib, shutil, tempfile
import argparse
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--tool',required=True);p.add_argument('--out',required=True);p.add_argument('--python',required=True);args=p.parse_args()
ROOT=Path(args.repo).resolve();TOOL=Path(args.tool).resolve();OUT=Path(args.out).resolve()
OUT.mkdir(parents=True,exist_ok=True)
BASE='3fa83a1cb386ca721ac2528b6401cf70592c8684'
HEAD='454a8707078d46d50db978df3ce539b9b0fa775c'
PYTHON=args.python
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==HEAD
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=TOOL,text=True).strip()=='01e28e1620941a539d3e9c14972201b30adafd3b'
assert not subprocess.check_output(['git','diff','HEAD','--name-only'],cwd=ROOT,text=True).strip(), 'Tracked edits would contaminate this historical assessment'
import yaml

def group(name, paths, all=False): return {'name':name, 'all_changed' if all else 'any_changed':paths,'content':'paths'}
def rule(id, trigger, groups): return {'id':id,'when':{'any_changed':trigger},'require':{'groups':groups},'severity':'blocker','allow_ignore':False}
report=['docs/research/tourism-rereview-implementation-20261006.md']
rules=[
rule('api-contract',['server/routes/**','server/day-alternatives.ts','server/weather-alternatives.ts'],[group('OpenAPI copies',['docs/openapi-rest.json','docs/Bookhaedo-API.yml','frontend/public/openapi.json'],True)]),
rule('trip-write-contract',['server/trip-write.ts','server/trip-snapshot.ts','server/itinerary-write.ts','server/collaboration.ts'],[group('Write and snapshot contract',report),group('Database regression',['tests/review-write-boundaries.test.ts'])]),
rule('provider-boundary',['server/route-response.ts','server/routing.ts','server/providers.ts','shared/route-shape-policy.ts'],[group('Provider limits',report),group('Provider regressions',['tests/route-response-validation.test.ts'])]),
rule('recommendation-recovery',['frontend/src/components/DayAlternatives.vue'],[group('Recovery contract',report),group('Browser regressions',['tests/e2e/tourism-save-recovery.spec.ts'])]),
rule('schema-contract',['db/schema.sql','db/planner.sql','db/migrations/**'],[group('ERD',['docs/erd.dbml']),group('Migration verification',['tests/migrations.test.ts'])]),
rule('ci-contract',['.github/workflows/**','package.json'],[group('Verification scope',report)]),
rule('source-policy',['server/tourism-source-policy.ts','scripts/tourism/source_policy.py','ops/tourism/source-policy.json'],[group('Source policy notes',['docs/tourism-langgraph.md','docs/operations.md','docs/research/*.md']),group('Source policy regressions',['tests/tourism-source-policy.test.ts','tests/tourism-pipeline.test.ts'])])]
policy={'rules':rules,'gate':{'fail_on_blocker':True,'fail_on_major_count':1},'suppression':{'allow_ignores':False}}
(OUT/'review-policy.yml').write_text(yaml.safe_dump(policy,sort_keys=False,allow_unicode=True))
env=os.environ.copy();env.update(PYTHONPATH=str(TOOL),PYTHONDONTWRITEBYTECODE='1',ANTHROPIC_API_KEY='')
summary=[]
def scan(name,cwd,policy):
 cmd=[PYTHON,'-m','drift_gate','check','--base',BASE,'--policy',str(policy),'--anthropic-api-key','','--explain','--out-json',str(OUT/(name+'.json')),'--out-md',str(OUT/(name+'.md'))]
 if name=='current': cmd+=['--out-html',str(OUT/'current.html')]
 p=subprocess.run(cmd,cwd=cwd,env=env,capture_output=True,text=True,timeout=120)
 (OUT/(name+'.log')).write_text(p.stdout+p.stderr)
 data=json.loads((OUT/(name+'.json')).read_text())
 row={'case':name,'exit':p.returncode,'result':data.get('result'),'no_policy':data.get('no_policy'),'summary':data.get('summary'),'violations':[v['rule_id'] for v in data.get('violations',[])],'scan_metrics':data.get('scan_metrics')}
 summary.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
scan('no-policy',ROOT,OUT/'not-configured.yml')
scan('current',ROOT,OUT/'review-policy.yml')
with tempfile.TemporaryDirectory(prefix='bookhaedo-drift-control-') as temp:
 repo=Path(temp)/'repo'
 subprocess.run(['git','clone','--shared','--no-hardlinks','--quiet',str(ROOT),str(repo)],check=True)
 subprocess.run(['git','checkout','--quiet','--detach',HEAD],cwd=repo,check=True)
 subprocess.run(['git','restore','--source',BASE,'--worktree','--','docs/openapi-rest.json','docs/Bookhaedo-API.yml','frontend/public/openapi.json'],cwd=repo,check=True)
 scan('control-missing-api-docs',repo,OUT/'review-policy.yml')
 subprocess.run(['git','restore','--source',HEAD,'--worktree','--','.'],cwd=repo,check=True)
 # Original pre-fix raw JSON parser remains a behavioral regression even though documents/tests are changed.
 for f in ['server/routing.ts','server/providers.ts']:
  subprocess.run(['git','restore','--source',BASE,'--worktree','--',f],cwd=repo,check=True)
 scan('control-old-provider-code',repo,OUT/'review-policy.yml')
 subprocess.run(['git','restore','--source',HEAD,'--worktree','--','.'],cwd=repo,check=True)
 (repo/'tests/e2e/tourism-save-recovery.spec.ts').unlink()
 scan('control-missing-recovery-test',repo,OUT/'review-policy.yml')
(OUT/'gate-summary.json').write_text(json.dumps({'bookhaedoBase':BASE,'bookhaedoHead':HEAD,'driftGateHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=TOOL,text=True).strip(),'scope':'Latest 38-file change; review policy authored for this assessment, not previously enforced CI; optional LLM disabled; controls isolated clones','runs':summary},indent=2,ensure_ascii=False))

expected={'no-policy':(0,'pass',[]),'current':(0,'pass',[]),'control-missing-api-docs':(1,'fail',['api-contract']),'control-old-provider-code':(0,'pass',[]),'control-missing-recovery-test':(1,'fail',['recommendation-recovery'])}
for row in summary:
 assert (row['exit'],row['result'],row['violations'])==expected[row['case']], row['case']
print('All gate control outcomes matched the recorded assessment')

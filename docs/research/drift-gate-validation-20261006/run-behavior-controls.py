from pathlib import Path
import subprocess,tempfile,json,os
import argparse
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--out',required=True);args=p.parse_args()
root=Path(args.repo).resolve();out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()=='454a8707078d46d50db978df3ce539b9b0fa775c'
env=os.environ.copy(); env['NODE_ENV']='test'
with tempfile.TemporaryDirectory(prefix='bookhaedo-behavior-control-') as tmp:
 repo=Path(tmp)/'repo'; subprocess.run(['git','clone','--shared','--quiet',str(root),str(repo)],check=True)
 (repo/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
 for f in ['server/routing.ts','server/providers.ts']:
  subprocess.run(['git','restore','--source','3fa83a1','--worktree','--',f],cwd=repo,check=True)
 p=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','tests/route-response-validation.test.ts'],cwd=repo,env=env,capture_output=True,text=True)
 (out/'control-old-provider-tests.log').write_text(p.stdout+p.stderr)
 print('old-provider-tests exit',p.returncode)
 assert p.returncode==1, 'Expected provider regression tests to fail'
 # Evaluate exact historical URL functions, without historical dependency installation or production writes.
 cases=json.loads((root/'tests/fixtures/tourism/resource-url-cases.json').read_text())
 (out/'source-url-cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2))
 results=[]
 for revision in ['c217502','454a870']:
  for f in ['server/tourism-source-policy.ts','scripts/tourism/source_policy.py','ops/tourism/source-policy.json','ops/tourism/sources.json']:
   (repo/f).write_bytes(subprocess.check_output(['git','show',revision+':'+f],cwd=root))
  (repo/'source-policy-probe.mts').write_text('''import fs from 'node:fs';import{resourceBelongsToSource}from './server/tourism-source-policy.ts';const registry=JSON.parse(fs.readFileSync('ops/tourism/sources.json','utf8'));const sources=Array.isArray(registry)?registry:registry.sources;const cases=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(cases.map(c=>({name:c.name,url:c.url,expected:c.allowed,allowed:resourceBelongsToSource(sources.find(s=>s.id===c.sourceId),c.url)}))));''')
  ts=subprocess.run(['node','--import','tsx','source-policy-probe.mts',str(out/'source-url-cases.json')],cwd=repo,capture_output=True,text=True,check=True)
  pycode="import json,sys;sys.path.insert(0,'scripts/tourism');from source_policy import resource_belongs_to_source;r=json.load(open('ops/tourism/sources.json'));r=r if isinstance(r,list) else r['sources'];print(json.dumps([{'url':c['url'],'allowed':resource_belongs_to_source(next(s for s in r if s['id']==c['sourceId']),c['url'])} for c in json.load(open(sys.argv[1]))]))"
  py=subprocess.run(['python3','-B','-c',pycode,str(out/'source-url-cases.json')],cwd=repo,capture_output=True,text=True,check=True)
  results.append({'revision':revision,'typescript':json.loads(ts.stdout),'python':json.loads(py.stdout)})
 (out/'historical-url-rejection.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
 print('historical URL control captured')

for row in results:
 assert [x['allowed'] for x in row['typescript']]==[x['allowed'] for x in row['python']]
 mismatches=sum(x['allowed']!=x['expected'] for x in row['typescript'])
 assert mismatches==(4 if row['revision']=='c217502' else 0)
print('Historical/current URL outcomes matched in both runtimes')

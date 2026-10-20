from pathlib import Path
import argparse,subprocess
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--target',required=True);a=p.parse_args()
r=Path(a.repo).resolve();t=Path(a.target).resolve();here=Path(__file__).resolve().parent
assert not t.exists(), 'Target must be a new disposable clone'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip()=='454a8707078d46d50db978df3ce539b9b0fa775c'
subprocess.run(['git','clone','--shared','--quiet',str(r),str(t)],check=True)
(t/'node_modules').symlink_to(r/'node_modules',target_is_directory=True)
(t/'tests/drift-contract-probe.test.ts').write_text((here/'contract-probe.test.ts.fixture').read_text())
(t/'tests/e2e/drift-boundary-probe.spec.ts').write_text((here/'browser-probe.spec.ts.fixture').read_text())
c=(t/'playwright.config.ts').read_text().replace('5173','5273').replace('3001','3101').replace("command: 'npm run dev:api'", "command: 'API_PORT=3101 npm run dev:api'").replace("command: 'npm run dev:web'", "command: 'npm run dev:web -- --port 5273'")
(t/'playwright.probe.config.ts').write_text(c)
p=t/'vite.config.ts';p.write_text(p.read_text().replace('5173','5273').replace('3001','3101'))
print(t)

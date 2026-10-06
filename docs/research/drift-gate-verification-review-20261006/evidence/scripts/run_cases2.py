"""Second batch: policy-tuning experiments, content modes (api-routes / env-keys) and a newer tool version."""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

S = Path(sys.argv[1]).resolve()
H = S / 'bookhaedo-head'
TOOL = S / 'tool-pinned'
NEWTOOL = Path('/home/user/cres17/pr-convention-checker')  # ver2 HEAD (f43cada)
PY = S / 'venv' / 'bin' / 'python'
HEAD = '91aaa285525987c47bb033701ef9fa2ee8a5594d'
CASES = S / 'cases'
ENV = {**os.environ}
COMMIT = ['git', '-c', 'user.name=case', '-c', 'user.email=case@example.test']


def sh(*args, cwd=None, check=True, env=None, inp=None):
    p = subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, env=env or ENV, input=inp)
    if check and p.returncode:
        raise RuntimeError(f'{args} failed: {p.stdout[-500:]}{p.stderr[-500:]}')
    return p


def clone(name, rev=HEAD):
    target = CASES / name
    if target.exists():
        shutil.rmtree(target)
    sh('git', 'clone', '--quiet', '--shared', str(H), str(target))
    sh('git', 'checkout', '--quiet', '--detach', rev, cwd=target)
    (target / 'node_modules').symlink_to(H / 'node_modules')
    return target


def edit(repo, rel, fn):
    path = repo / rel
    before = path.read_text()
    after = fn(before)
    if before == after:
        raise RuntimeError(f'no change applied to {rel}')
    path.write_text(after)


def commit(repo, msg):
    sh(*COMMIT, 'commit', '-qam', msg, cwd=repo)
    return sh('git', 'rev-parse', 'HEAD', cwd=repo).stdout.strip()


def gate(repo, base, label, tool=TOOL):
    sh('git', 'add', '-f', '-N', '.', ':!node_modules', cwd=repo, check=False)
    out = CASES / (label + '-out')
    if out.exists():
        shutil.rmtree(out)
    p = sh('python3', 'scripts/check-drift-gate.py', '--base', base, '--tool', str(tool),
           '--python', str(PY), '--out', str(out), cwd=repo, check=False)
    res = {'exit': p.returncode, 'line': (p.stdout.strip() or p.stderr.strip()).splitlines()[-1:]}
    rp = out / 'report.json'
    if rp.exists():
        d = json.loads(rp.read_text())
        res['result'] = d['result']
        res['rules'] = {x['rule_id']: x['status'] for x in d['rule_decisions'] if x['status'] != 'unmatched'}
        res['intensity'] = sorted({f.get('change_intensity', '') for v in d.get('violations', []) for f in v.get('trigger_files', [])} - {''})
        res['unsatisfied'] = [g['name'] for v in d.get('violations', []) for g in v.get('unsatisfied_groups', [])]
        res['group_evidence'] = [g.get('evidence', '') for v in d.get('violations', []) for g in v.get('unsatisfied_groups', []) if g.get('evidence')][:3]
    return res


R = {}
CASES.mkdir(exist_ok=True)

# ---- E1: min_change_intensity on api-contract (does an impl-only route edit stop being a "contract change"?) ----
e1 = clone('e1-intensity')
edit(e1, '.drift-gate.yml', lambda s: s.replace(
    "any_changed: ['server/routes/**', 'server/http/middleware.ts', 'scripts/write-api-spec.mjs', 'server/day-alternatives.ts', 'server/weather-alternatives.ts']",
    "any_changed: ['server/routes/**', 'server/http/middleware.ts', 'scripts/write-api-spec.mjs', 'server/day-alternatives.ts', 'server/weather-alternatives.ts']\n      min_change_intensity: route-contract-change", 1))
base1 = commit(e1, 'policy: intensity')
edit(e1, 'server/routes/ai-recommendations.ts',
     lambda s: s.replace('    if (!context.items.length)\n      return res.json({',
                         "    if (!context.items.length)\n      return res.set('Cache-Control', 'no-store').json({", 1))
R['E1a impl-only header tweak, intensity>=route-contract-change'] = gate(e1, base1, 'e1a')
sh('git', 'checkout', '--quiet', '--', 'server/routes/ai-recommendations.ts', cwd=e1)
edit(e1, 'server/routes/ai-recommendations.ts', lambda s: s + """
aiRecommendations.get(
  '/api/trips/:id/days/:date/ai-recommendations/health',
  wrap(async (_req, res) => res.json({ ok: true })),
);
""")
R['E1b NEW route added, intensity>=route-contract-change'] = gate(e1, base1, 'e1b')

# ---- E2: real route rename with regenerated OpenAPI, content: paths vs api-routes ----
for variant, mode in (('paths', 'paths'), ('apiroutes', 'api-routes')):
    e2 = clone('e2-' + variant)
    if mode != 'paths':
        edit(e2, '.drift-gate.yml', lambda s: s.replace(
            "all_changed: ['docs/openapi-rest.json', 'docs/Bookhaedo-API.yml', 'frontend/public/openapi.json']\n          content: paths",
            "all_changed: ['docs/openapi-rest.json', 'docs/Bookhaedo-API.yml', 'frontend/public/openapi.json']\n          content: api-routes", 1))
        base2 = commit(e2, 'policy: api-routes')
    else:
        base2 = HEAD
    # control: rename in code only
    edit(e2, 'server/routes/ai-recommendations.ts', lambda s: s.replace("'/api/trips/:id/days/:date/ai-recommendations'", "'/api/trips/:id/days/:date/ai-recs'", 1))
    R[f'E2-{variant}-1 rename in code only (docs untouched)'] = gate(e2, base2, f'e2-{variant}-1')
    # correct: rename in generator, regenerate the 3 OpenAPI copies; also add the API regression test file touch
    edit(e2, 'scripts/write-api-spec.mjs', lambda s: s.replace("ai-recommendations", "ai-recs"))
    sh('node', 'scripts/write-api-spec.mjs', cwd=e2)
    edit(e2, 'tests/ai-recommendations.test.ts', lambda s: s + '\n// route renamed\n')
    R[f'E2-{variant}-2 rename in code + regenerated docs + test touch'] = gate(e2, base2, f'e2-{variant}-2')
    # cosmetic: revert the real doc change, only touch a description string in the three files
    for rel in ('docs/openapi-rest.json', 'docs/Bookhaedo-API.yml', 'frontend/public/openapi.json'):
        sh('git', 'checkout', '--quiet', base2, '--', rel, cwd=e2)
    for rel in ('docs/openapi-rest.json', 'docs/Bookhaedo-API.yml', 'frontend/public/openapi.json'):
        edit(e2, rel, lambda s: s.replace('소유자 또는 수락한 동행자만 접근', '소유자 또는 수락한 동행자만 접근 가능', 1))
    R[f'E2-{variant}-3 rename in code + COSMETIC doc edit only'] = gate(e2, base2, f'e2-{variant}-3')

# ---- E3: env-keys content mode on a real, pre-existing drift (API_RATE_LIMIT) ----
e3 = clone('e3-env')
env_rule = """  - id: env-example-sync
    when:
      any_changed: ['server/**', 'shared/**']
      min_change_intensity: config-key-added
    require:
      groups:
        - name: Sample environment keys
          all_changed: ['.env.example']
          content: env-keys
    severity: blocker
    allow_ignore: false
"""
edit(e3, '.drift-gate.yml', lambda s: s.replace('gate:\n', env_rule + 'gate:\n', 1))
base3 = commit(e3, 'policy: env')
edit(e3, 'server/config.ts', lambda s: s.replace("export function validateProduction(", "const caseKey = process.env.CASE_NEW_KEY;\nexport function validateProduction(", 1))
R['E3a NEW env key read in server code, .env.example untouched'] = gate(e3, base3, 'e3a')
edit(e3, '.env.example', lambda s: s + '\nCASE_NEW_KEY=\n')
R['E3b same + key added to .env.example'] = gate(e3, base3, 'e3b')
sh('git', 'checkout', '--quiet', '--', 'server/config.ts', '.env.example', cwd=e3)
edit(e3, 'server/http/rate-limit.ts', lambda s: s.replace('Number(process.env.API_RATE_LIMIT || 300)', 'Number(process.env.API_RATE_LIMIT || 300) ', 1))
R['E3c whitespace-only edit next to PRE-EXISTING undocumented API_RATE_LIMIT'] = gate(e3, base3, 'e3c')

# ---- E4: newer tool (ver2 HEAD f43cada) vs pinned 01e28e1 on identical inputs ----
def direct(repo, base, tool, label):
    out = CASES / (label + '-out')
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    sh('git', 'add', '-f', '-N', '.', ':!node_modules', cwd=repo, check=False)
    env = {**os.environ, 'PYTHONPATH': str(tool), 'PYTHONDONTWRITEBYTECODE': '1', 'ANTHROPIC_API_KEY': ''}
    p = sh(str(PY), '-m', 'drift_gate', 'check', '--base', base, '--policy', str(repo / '.drift-gate.yml'),
           '--anthropic-api-key', '', '--explain', '--out-json', str(out / 'r.json'), '--out-md', str(out / 'r.md'),
           cwd=repo, check=False, env=env)
    if not (out / 'r.json').exists():
        return {'exit': p.returncode, 'error': (p.stdout + p.stderr)[-300:]}
    d = json.loads((out / 'r.json').read_text())
    return {'exit': p.returncode, 'result': d['result'], 'rules': {x['rule_id']: x['status'] for x in d['rule_decisions'] if x['status'] != 'unmatched'}, 'change_types': d['change_types'], 'violations': len(d['violations'])}

cmp = {}
inputs = {
    'head vs 454a870 (the reported change)': (H, '454a8707078d46d50db978df3ce539b9b0fa775c'),
    'C1 no-store tweak': (CASES / 'c1-no-store', HEAD),
    'C2 npm upgrade': (CASES / 'c2-npm-upgrade', HEAD),
    'C3a relax alias (no rule)': (CASES / 'c3-relax-alias', HEAD),
}
for name, (repo, base) in inputs.items():
    a = direct(repo, base, TOOL, 'cmp-pinned')
    b = direct(repo, base, NEWTOOL, 'cmp-new')
    cmp[name] = {'pinned_01e28e1': a, 'new_f43cada': b, 'same_decision': a.get('result') == b.get('result') and a.get('rules') == b.get('rules')}
R['E4 tool version comparison'] = cmp

(S / 'case-results2.json').write_text(json.dumps(R, ensure_ascii=False, indent=2))
for k, v in R.items():
    if k.startswith('E4'):
        print(k)
        for n, c in v.items():
            print('  ', n, '| same decision:', c['same_decision'], '| pinned:', c['pinned_01e28e1'].get('result'), c['pinned_01e28e1'].get('rules'), '| new:', c['new_f43cada'].get('result'), c['new_f43cada'].get('rules'), c['new_f43cada'].get('error', ''))
    else:
        print(k, '=>', 'exit', v['exit'], v.get('result'), v.get('rules'), '| unsatisfied:', v.get('unsatisfied'), '| intensity:', v.get('intensity'))

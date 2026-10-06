"""Run AI-suggestion rejection cases against Bookhaedo ver2 head with the pinned Drift Gate.

Every case is applied to a disposable shared clone; the source worktree is never modified.
For each case we record (1) the Drift Gate verdict and (2) the real behavior test result.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

S = Path(sys.argv[1]).resolve()          # .../scratchpad/dg
H = S / 'bookhaedo-head'
TOOL = S / 'tool-pinned'
PY = S / 'venv' / 'bin' / 'python'
HEAD = '91aaa285525987c47bb033701ef9fa2ee8a5594d'
CASES = S / 'cases'
OUT = S / 'case-results.json'
ENV = {**os.environ}


def sh(*args, cwd=None, check=True, env=None):
    p = subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, env=env or ENV)
    if check and p.returncode:
        raise RuntimeError(f'{args} failed: {p.stdout[-400:]}{p.stderr[-400:]}')
    return p


def clone(name, rev=HEAD):
    target = CASES / name
    if target.exists():
        shutil.rmtree(target)
    sh('git', 'clone', '--quiet', '--shared', str(H), str(target))
    sh('git', 'checkout', '--quiet', '--detach', rev, cwd=target)
    (target / 'node_modules').symlink_to(H / 'node_modules')
    return target


def gate(repo, base, label, tool=TOOL):
    sh('git', 'add', '-f', '-N', '.', ':!node_modules', cwd=repo, check=False)
    out = CASES / (label + '-out')
    if out.exists():
        shutil.rmtree(out)
    p = sh('python3', 'scripts/check-drift-gate.py', '--base', base, '--tool', str(tool),
           '--python', str(PY), '--out', str(out), cwd=repo, check=False)
    result = {'exit': p.returncode, 'line': (p.stdout.strip() or p.stderr.strip()).splitlines()[-1:] or ['']}
    report = out / 'report.json'
    if report.exists():
        data = json.loads(report.read_text())
        result['result'] = data.get('result')
        result['changed_files_scanned'] = data['scan_metrics']['scanned_files']
        result['rules'] = {d['rule_id']: d['status'] for d in data['rule_decisions']}
        result['violations'] = [
            {k: v for k, v in x.items() if k in ('rule_id', 'severity', 'message', 'missing', 'group', 'reason')}
            for x in data.get('violations', [])
        ][:4]
        result['triggered_files'] = sorted({f for d in data['rule_decisions'] for f in d['trigger_files']})
    return result


def vitest(repo, files):
    p = sh('npx', 'vitest', 'run', '--config', 'vitest.config.ts', *files, cwd=repo, check=False)
    text = p.stdout + p.stderr
    tests = re.search(r'Tests\s+(.*)', text)
    failed = re.findall(r'^\s+×\s+(.*?)\s+\d+ms', text, re.M)[:5]
    return {'exit': p.returncode, 'summary': tests.group(1).strip() if tests else text[-300:], 'failed_examples': failed}


def patch(repo, name):
    sh('git', 'add', '-f', '-N', '.', ':!node_modules', cwd=repo, check=False)
    diff = sh('git', 'diff', 'HEAD', '--', '.', ':!node_modules', cwd=repo).stdout
    (CASES / f'{name}.patch').write_text(diff)
    return len(diff.splitlines())


def edit(repo, rel, fn):
    path = repo / rel
    before = path.read_text()
    after = fn(before)
    if before == after:
        raise RuntimeError(f'no change applied to {rel}')
    path.write_text(after)


results = {}
CASES.mkdir(exist_ok=True)

# Baseline: unmodified head, no change at all.
base = clone('c0-baseline')
results['C0 head (no change)'] = {'gate': gate(base, HEAD, 'c0')}

# C1: AI claim "NEEDS_ANCHOR response lacks Cache-Control: no-store" -> false (middleware sets it).
c1 = clone('c1-no-store')
before = vitest(c1, ['tests/ai-recommendations.test.ts'])
edit(c1, 'server/routes/ai-recommendations.ts',
     lambda s: s.replace('    if (!context.items.length)\n      return res.json({',
                         "    if (!context.items.length)\n      return res.set('Cache-Control', 'no-store').json({", 1))
results['C1 add redundant no-store'] = {
    'patch_lines': patch(c1, 'c1-no-store'),
    'gate': gate(c1, HEAD, 'c1'),
    'behavior_before_change': before,
    'behavior_after_change': vitest(c1, ['tests/ai-recommendations.test.ts']),
}

# C2: AI suggestion "upgrade npm to fix the CI audit flake" -> no evidence, rejected.
c2 = clone('c2-npm-upgrade')
edit(c2, '.github/workflows/ci.yml',
     lambda s: s.replace('      - run: npm ci\n', '      - run: npm ci\n      - run: npm install -g npm@11\n', 1))
results['C2 npm upgrade in CI'] = {'patch_lines': patch(c2, 'c2-npm-upgrade'), 'gate': gate(c2, HEAD, 'c2')}

# C3: AI suggestion "row-level fingerprint (relax alias protection)" -> deferred, protection must not be weakened.
c3 = clone('c3-relax-alias')
edit(c3, 'server/tourism-matching.ts',
     lambda s: s.replace("(['title', 'contentSha256', 'regionId'] as const)", "(['title', 'regionId'] as const)", 1))
results['C3a relax alias fingerprint (current policy)'] = {
    'patch_lines': patch(c3, 'c3-relax-alias'),
    'gate': gate(c3, HEAD, 'c3a'),
    'behavior': vitest(c3, ['tests/tourism-alias.test.ts', 'tests/tourism-matching.test.ts']),
}

# C3b: same change, but the baseline policy already has a rule covering link-protection code.
c3b = clone('c3b-relax-alias-with-rule')
rule = """  - id: tourism-link-protection
    when:
      any_changed: ['server/tourism-matching.ts', 'ops/tourism/approved-aliases.json']
    require:
      groups:
        - name: Alias regression
          any_changed: ['tests/tourism-alias.test.ts', 'tests/tourism-matching.test.ts']
          content: paths
        - name: Link contract
          any_changed: ['docs/tourism-langgraph.md']
          content: paths
    severity: blocker
    allow_ignore: false
"""
edit(c3b, '.drift-gate.yml', lambda s: s.replace('gate:\n', rule + 'gate:\n', 1))
sh('git', '-c', 'user.name=case', '-c', 'user.email=case@example.test', 'commit', '-qam', 'policy: link protection', cwd=c3b)
base_b = sh('git', 'rev-parse', 'HEAD', cwd=c3b).stdout.strip()
edit(c3b, 'server/tourism-matching.ts',
     lambda s: s.replace("(['title', 'contentSha256', 'regionId'] as const)", "(['title', 'regionId'] as const)", 1))
results['C3b relax alias fingerprint (rule present, code only)'] = {'gate': gate(c3b, base_b, 'c3b')}
# C3c: satisfy the rule with cosmetic edits only; behavior is still wrong.
edit(c3b, 'tests/tourism-alias.test.ts', lambda s: s + '\n// reviewed\n')
edit(c3b, 'docs/tourism-langgraph.md', lambda s: s + '\n')
results['C3c same weakened code + cosmetic co-change'] = {
    'gate': gate(c3b, base_b, 'c3c'),
    'behavior': vitest(c3b, ['tests/tourism-alias.test.ts', 'tests/tourism-matching.test.ts']),
}

# C4: real regression found earlier (c217502 rejected percent-encoded HARP URLs). Would this policy have seen it?
c4 = clone('c4-history', 'c217502')
sh('git', 'checkout', '--quiet', '91aaa28', '--', '.drift-gate.yml', 'scripts/check-drift-gate.py', cwd=c4)
sh('git', 'reset', '--quiet', cwd=c4)
changed = sh('git', 'diff', '--name-only', 'b47f09f', 'c217502', cwd=c4).stdout.split()
r4 = gate(c4, 'b47f09f', 'c4')
r4['commit_changed_files'] = [f for f in changed if not f.startswith('docs/research')]
r4['source_policy_files_touched_but_unmatched'] = [
    f for f in r4['commit_changed_files']
    if re.search(r'source-policy|source_policy|tourism-knowledge|tourism-matching|audit-dependencies', f)
    and f not in r4.get('triggered_files', [])
]
results['C4 historical c217502 (policy applied retroactively)'] = r4

OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps({k: {kk: (vv if kk != 'gate' else {a: b for a, b in vv.items() if a in ('exit', 'result', 'line', 'rules')})
                      for kk, vv in v.items()} for k, v in results.items()}, ensure_ascii=False, indent=1)[:9000])

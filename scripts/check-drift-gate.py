"""Require a configured, pinned Drift Gate local check; do not interpret PASS as behavioral proof."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

PIN = '01e28e1620941a539d3e9c14972201b30adafd3b'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True, help='Reviewed base commit/ref')
    parser.add_argument('--tool', required=True, help='Drift Gate source checkout')
    parser.add_argument('--python', default=sys.executable, help='Python with Drift Gate dependencies')
    parser.add_argument('--out', default='.drift-gate-report')
    args = parser.parse_args()
    root = Path.cwd()
    policy = root / '.drift-gate.yml'
    if not policy.is_file():
        print('Drift Gate policy is required.', file=sys.stderr)
        return 2
    tool = Path(args.tool).resolve()
    try:
        version = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=tool, text=True).strip()
        dirty = subprocess.check_output(
            ['git', 'status', '--porcelain', '--untracked-files=all', '--', 'drift_gate', 'pyproject.toml'],
            cwd=tool, text=True,
        ).strip()
        if version != PIN or dirty:
            print('Drift Gate source must match the reviewed, unchanged commit: ' + PIN, file=sys.stderr)
            return 2
    except (OSError, subprocess.SubprocessError):
        print('Cannot verify Drift Gate checkout.', file=sys.stderr)
        return 2
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = out / 'report.json'
    # A failed invocation must never reuse an old successful report.
    report.unlink(missing_ok=True)
    env = {**os.environ, 'PYTHONPATH': str(tool), 'PYTHONDONTWRITEBYTECODE': '1', 'ANTHROPIC_API_KEY': ''}
    command = [
        args.python, '-m', 'drift_gate', 'check', '--base', args.base,
        '--policy', str(policy), '--anthropic-api-key', '', '--explain',
        '--out-json', str(report), '--out-md', str(out / 'report.md'),
    ]
    try:
        process = subprocess.run(command, cwd=root, env=env, timeout=120, capture_output=True, text=True)
        (out / 'run.log').write_text(process.stdout + process.stderr, encoding='utf-8')
        data = json.loads(report.read_text(encoding='utf-8'))
    except (OSError, subprocess.SubprocessError, ValueError):
        print('Drift Gate did not produce a valid report. See the selected output directory.', file=sys.stderr)
        return 2
    if process.returncode not in (0, 1) or data.get('result') not in ('pass', 'warn', 'fail'):
        print('Drift Gate execution failed.', file=sys.stderr)
        return 2
    metrics = data.get('scan_metrics', {})
    if not metrics.get('evaluated_rules', 0):
        print('Drift Gate evaluated no configured rules.', file=sys.stderr)
        return 2
    decisions = data.get('rule_decisions', [])
    count = sum(d.get('status') == 'pass' for d in decisions)
    types = data.get('change_types', [])
    if not metrics.get('scanned_files'):
        scope = 'no-changes'
    elif types and types[0] in ('docs-only', 'test-only'):
        scope = 'docs/test-only'
    elif not any(d.get('status') != 'unmatched' for d in decisions):
        scope = 'no-matching-rule'
    else:
        scope = 'evaluated'
    print(f"Drift Gate: {data['result']} | scope={scope} | passed matched rules={count} | configured rules={metrics['evaluated_rules']}")
    return 1 if process.returncode or data['result'] == 'fail' else 0


if __name__ == '__main__':
    sys.exit(main())

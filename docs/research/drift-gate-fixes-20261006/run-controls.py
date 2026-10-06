"""Reproduce the co-change rejection controls without modifying either source checkout."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def run(*args, cwd=None):
    return subprocess.check_output(list(args), cwd=cwd)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True)
    parser.add_argument('--base', required=True)
    parser.add_argument('--tool', required=True)
    parser.add_argument('--python', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    root, tool, out = (Path(value).resolve() for value in (args.repo, args.tool, args.out))
    out.mkdir(parents=True, exist_ok=True)
    # Includes committed changes after base and tracked worktree changes. Add new files first.
    patch = run('git', 'diff', '--binary', '--no-ext-diff', args.base, cwd=root)
    results = []
    with tempfile.TemporaryDirectory(prefix='bookhaedo-gate-controls-') as temporary:
        target = Path(temporary) / 'bookhaedo'
        run('git', 'clone', '--quiet', '--shared', str(root), str(target))
        run('git', 'checkout', '--quiet', '--detach', args.base, cwd=target)
        subprocess.run(['git', 'apply', '--whitespace=nowarn', '-'], input=patch, cwd=target, check=True)
        # This disposable clone contains only baseline files and the reviewed patch.
        run('git', 'add', '-f', '-N', '.', cwd=target)

        def check(label, expected, base=None, selected_tool=tool):
            destination = out / label
            command = ['python3', 'scripts/check-drift-gate.py', '--base', base or args.base,
                       '--tool', str(selected_tool), '--python', args.python, '--out', str(destination)]
            process = subprocess.run(command, cwd=target, capture_output=True, text=True)
            (out / (label + '.log')).write_text(process.stdout + process.stderr, encoding='utf-8')
            print(f'{label}: exit {process.returncode} (expected {expected})')
            if process.returncode != expected:
                raise RuntimeError(f'{label}: unexpected exit; inspect its log')
            results.append({'label': label, 'exitCode': process.returncode, 'expected': expected})

        check('isolated-current', 0)
        for label, paths in [
            ('missing-api-contract', ['docs/openapi-rest.json', 'docs/Bookhaedo-API.yml', 'frontend/public/openapi.json']),
            ('missing-recovery-e2e', ['tests/e2e/tourism-save-recovery.spec.ts']),
        ]:
            previous = {path: (target / path).read_bytes() for path in paths}
            for path in paths:
                (target / path).write_bytes(run('git', 'show', args.base + ':' + path, cwd=target))
            check(label, 1)
            for path, content in previous.items():
                (target / path).write_bytes(content)
        policy = target / '.drift-gate.yml'
        original = policy.read_bytes()
        policy.unlink()
        check('missing-policy', 2)
        policy.write_text('rules: []\n', encoding='utf-8')
        check('empty-policy', 2)
        policy.write_bytes(original)
        dirty_tool = Path(temporary) / 'dirty-tool'
        run('git', 'clone', '--quiet', '--shared', str(tool), str(dirty_tool))
        with (dirty_tool / 'pyproject.toml').open('a', encoding='utf-8') as stream:
            stream.write('\n# intentional control change\n')
        check('dirty-tool', 2, selected_tool=dirty_tool)
        run('git', 'restore', 'pyproject.toml', cwd=dirty_tool)
        (dirty_tool / 'drift_gate' / 'unreviewed_control.py').write_text('# intentional untracked source\n', encoding='utf-8')
        check('untracked-tool-source', 2, selected_tool=dirty_tool)
        stale = out / 'invalid-base'
        stale.mkdir(exist_ok=True)
        (stale / 'report.json').write_text('{"result":"pass"}', encoding='utf-8')
        check('invalid-base', 2, base='definitely-not-a-git-ref')
        if (stale / 'report.json').exists():
            raise RuntimeError('A stale report survived the failed invocation')
    (out / 'controls.json').write_text(json.dumps({
        'base': args.base,
        'toolCommit': run('git', 'rev-parse', 'HEAD', cwd=tool).decode().strip(),
        'results': results, 'staleReportRemoved': True,
    }, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()

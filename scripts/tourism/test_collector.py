"""Integration checks against a real loopback HTTP server, not external mutations."""
import fcntl
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('collector.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Integration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.state = {'year': 2026, 'changed': False, 'failures': [], 'calls': [], 'bad': False,
                      'robots': 'User-agent: *\nAllow: /\n', 'csv_path': '/event2026.csv',
                      'short_row': False, 'duplicate_name': False}
        state = self.state

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass

            def do_GET(self):
                state['calls'].append({'path': self.path, 'start': time.time()})
                if self.path == '/robots.txt':
                    if state.get('robots_status'):
                        self.send_response(state['robots_status']); self.end_headers(); return
                    body = state['robots'].encode()
                    tag = state['robots']
                elif self.path == '/dataset.html':
                    paths = ['/event2025.csv', state['csv_path'], state['csv_path']]
                    if state['year'] == 2027: paths.append('/event2027.csv')
                    if state['duplicate_name']: paths.append('/other/event2026.csv')
                    body = ''.join(f'<a href="{p}">CSV</a>' for p in paths).encode()
                    tag = body.decode()
                else:
                    if state['failures']:
                        status = state['failures'].pop(0)
                        self.send_response(status)
                        self.send_header('Retry-After', '0.08')
                        self.end_headers(); return
                    body = ('ID,イベント名,開始日\n01,' + ('変更' if state['changed'] else '祭り') + ',2026-10-20\n').encode()
                    if state['bad']: body = b'<html>error</html>'
                    if state['short_row']: body = 'ID,イベント名,開始日\n01,祭り\n'.encode()
                    tag = self.path + str(state['changed']) + str(state['bad']) + str(state['short_row'])
                if self.headers.get('If-None-Match') == tag:
                    self.send_response(304); self.end_headers(); return
                self.send_response(200)
                self.send_header('ETag', tag)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers(); self.wfile.write(body)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.page = f'http://127.0.0.1:{self.server.server_port}/dataset.html'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.tmp.cleanup()

    def collector(self):
        return module.Collector(self.root, self.page, interval=0.04, min_year=2026)

    def test_gate_rechecks_deadline_after_early_wakeup(self):
        c = self.collector()
        try:
            c.db.execute('INSERT INTO gate VALUES (?,?)', (c.origin.netloc, 100.0))
            c.db.commit()
            with patch.object(module.time, 'time', side_effect=[100.01, 100.039, 100.04, 100.04]), \
                 patch.object(module.time, 'sleep') as sleep:
                self.assertGreaterEqual(c.gate(), 100.04)
                self.assertEqual(sleep.call_count, 2)
        finally:
            c.db.close()

    def test_robots_404_stops_before_discovery_and_drops_stale_rules(self):
        c = self.collector(); c.robots()
        self.state['robots_status'] = 404
        with self.assertRaises(module.urllib.error.HTTPError):
            c.robots()
        self.assertIsNone(c.robot)
        self.assertTrue(all(call['path'] == '/robots.txt' for call in self.state['calls']))
        self.assertEqual(len(self.state['calls']), 2)
        c.db.close()

    def test_repeated_run_discovery_new_year_and_changed_file(self):
        c = self.collector(); c.robots()
        first = c.run('fixture')
        second = c.run('fixture')
        self.assertEqual([r['change'] for r in first['resources']], ['new'])
        self.assertEqual(second['page_status'], 304)
        self.assertEqual([r['change'] for r in second['resources']], ['unchanged'])
        self.assertEqual(second['resources'][0]['status'], 304)
        self.state['year'] = 2027
        third = c.run('fixture')
        self.assertEqual(third['resources_found'], 2)
        self.assertEqual(third['resources'][1]['year'], 2027)
        self.assertEqual(third['resources'][1]['change'], 'new')
        self.state['changed'] = True
        fourth = c.run('fixture')
        self.assertEqual([r['change'] for r in fourth['resources']], ['updated', 'updated'])
        self.assertEqual(c.db.execute('SELECT COUNT(*) FROM versions').fetchone()[0], 4)
        self.assertEqual(len(list((self.root / 'blobs').iterdir())), 2)
        self.assertFalse(any(x['path'] == '/event2025.csv' for x in self.state['calls']))
        c.db.close()

    def test_429_503_retry_obeys_interval_and_retry_after(self):
        self.state['failures'] = [429, 503]
        c = self.collector(); c.robots()
        result = c.run('fixture')
        self.assertEqual(result['errors'], [])
        calls = [x for x in self.state['calls'] if x['path'] == '/event2026.csv']
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(b['start'] - a['start'] >= 0.075 for a, b in zip(calls, calls[1:])))
        logs = [json.loads(x) for x in (self.root / 'requests.jsonl').read_text().splitlines()]
        self.assertTrue(all(b['start'] - a['start'] >= 0.039 for a, b in zip(logs, logs[1:])))
        c.db.close()

    def test_retry_exhaustion_and_invalid_csv_preserve_last_good_version(self):
        c = self.collector(); c.robots(); c.run('fixture')
        self.state['failures'] = [503, 503, 503]
        failure = c.run('fixture')
        self.assertEqual(len(failure['errors']), 1)
        self.assertEqual(c.db.execute('SELECT COUNT(*) FROM versions').fetchone()[0], 1)
        self.state['bad'] = True
        failure = c.run('fixture')
        self.assertEqual(len(failure['errors']), 1)
        self.assertEqual(c.db.execute('SELECT COUNT(*) FROM versions').fetchone()[0], 1)
        c.db.close()

    def test_process_restart_preserves_gate_and_deduplication(self):
        c = self.collector(); c.robots(); c.run('fixture'); c.db.close()
        c = self.collector(); again = c.run('fixture')
        self.assertEqual(again['resources'][0]['change'], 'unchanged')
        logs = [json.loads(x) for x in (self.root / 'requests.jsonl').read_text().splitlines()]
        self.assertTrue(all(b['start'] - a['start'] >= 0.039 for a, b in zip(logs, logs[1:])))
        c.db.close()

    def test_same_state_directory_rejects_concurrent_process(self):
        with (self.root / '.collector.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            run = subprocess.run([sys.executable, str(Path(__file__).with_name('collector.py')),
                                  '--state-dir', str(self.root)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 2)
            self.assertIn('already_running', run.stdout)

    def test_pinned_resource_does_not_collect_old_versions_and_fails_when_missing(self):
        c = module.Collector(self.root, self.page, interval=0.01,
                             resource_url=self.page.replace('/dataset.html', '/event2026.csv'))
        try:
            c.robots()
            self.state['year'] = 2027
            report = c.run('fixture')
            self.assertEqual(report['errors'], [])
            self.assertEqual(len(report['resources']), 1)
            self.assertEqual(report['resources'][0]['key'], 'event2026.csv')
            self.state['csv_path'] = '/new-directory/event2026.csv'
            missing = c.run('fixture')
            self.assertEqual(missing['resources'], [])
            self.assertIn('No eligible CSV', missing['errors'][0]['error'])
        finally:
            c.db.close()

    def test_external_interval_cannot_be_lowered(self):
        c = module.Collector(self.root, module.SOURCES['eniwa-events'], interval=0.01)
        self.assertEqual(c.interval, 60)
        c.db.close()

    def test_robots_can_refresh_even_after_disallow_all(self):
        c = self.collector(); self.state['robots'] = 'User-agent: *\nDisallow: /\n'
        c.robots()
        with self.assertRaisesRegex(ValueError, 'disallows'):
            c.discover()
        self.state['robots'] = 'User-agent: *\nAllow: /\n'
        c.robots()
        self.assertEqual(c.run('fixture')['errors'], [])
        c.db.close()

    def test_return_to_old_content_is_reported_as_changed(self):
        c = self.collector(); c.robots(); first = c.run('fixture')
        self.state['changed'] = True; c.run('fixture')
        self.state['changed'] = False; reverted = c.run('fixture')
        self.assertEqual(reverted['resources'][0]['change'], 'updated')
        self.assertEqual(reverted['resources'][0]['sha256'], first['resources'][0]['sha256'])
        self.assertEqual(c.db.execute('SELECT COUNT(*) FROM versions').fetchone()[0], 2)
        c.db.close()

    def test_short_csv_row_is_rejected(self):
        c = self.collector(); c.robots(); c.run('fixture')
        self.state['short_row'] = True
        report = c.run('fixture')
        self.assertEqual(len(report['errors']), 1)
        self.assertEqual(c.db.execute('SELECT COUNT(*) FROM versions').fetchone()[0], 1)
        c.db.close()

    def test_resource_path_move_does_not_add_active_duplicates(self):
        c = self.collector(); c.robots(); c.run('fixture')
        self.state['csv_path'] = '/new-directory/event2026.csv'
        report = c.run('fixture')
        self.assertEqual(report['resources'][0]['change'], 'unchanged')
        self.assertEqual(c.db.execute('SELECT COUNT(*) FROM resources').fetchone()[0], 1)
        self.assertEqual(c.db.execute('SELECT COUNT(*) FROM versions').fetchone()[0], 1)
        c.db.close()

    def test_404_and_403_are_not_retried(self):
        c = self.collector(); c.robots()
        for status in (404, 403):
            self.state['failures'] = [status]
            before = len(self.state['calls'])
            report = c.run('fixture')
            self.assertEqual(len(report['errors']), 1)
            self.assertEqual(sum(x['path'] == '/event2026.csv' for x in self.state['calls'][before:]), 1)
        c.db.close()

    def test_same_filename_on_different_paths_requires_review(self):
        self.state['duplicate_name'] = True
        c = self.collector(); c.robots()
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            c.discover()
        c.db.close()

    def test_longer_robots_interval_survives_restart(self):
        self.state['robots'] = 'User-agent: *\nCrawl-delay: 1\n'
        c = self.collector(); c.robots(); c.run('fixture'); c.db.close()
        c = self.collector(); c.robots(); c.db.close()
        calls = self.state['calls']
        self.assertGreaterEqual(calls[-1]['start'] - calls[-2]['start'], 0.99)


if __name__ == '__main__':
    unittest.main(verbosity=2)

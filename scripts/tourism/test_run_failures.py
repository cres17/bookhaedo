"""The normalizer must see failures that happen before CSV processing."""
import hashlib
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, closing
from pathlib import Path
from unittest.mock import patch
import collector
from normalize import normalize_report


class RunFailures(unittest.TestCase):
    def check_failure(self, phase, via_cli=True):
        body = 'NO,イベント名,説明,開始日,終了日,開始日時特記事項,備考,緯度,経度\n1,fixture,,2026-10-01,2026-10-02,,,,\n'.encode()
        with tempfile.TemporaryDirectory() as folder:
            c = collector.Collector(folder, 'http://127.0.0.1/dataset.html', interval=0)
            digest = hashlib.sha256(body).hexdigest()
            blob = Path(folder) / 'blobs' / digest / 'source.csv'
            blob.parent.mkdir(parents=True); blob.write_bytes(body)
            report = {'source': 'eniwa-events', 'started_at': '2026-10-01T00:00:00Z',
                      'resources_found': 1, 'resources': [{'url': 'https://www.harp.lg.jp/opendata/dataset/1823/resource/8944/event2026.csv',
                      'key': 'event2026.csv', 'sha256': digest, 'year': 2026}], 'errors': []}
            c.db.execute('INSERT INTO runs(source,started,report) VALUES(?,?,?)', ('eniwa-events', 1, json.dumps(report)))
            c.db.commit(); c.db.close()
            self.assertEqual(len(normalize_report(folder, 'eniwa-events', 2026)['records']), 1)
            with patch.object(collector, 'SOURCES', {'eniwa-events': 'http://127.0.0.1/dataset.html'}), \
                 patch.object(collector.Collector, 'robots', side_effect=ValueError('robots unavailable') if phase == 'robots' else None), \
                 patch.object(collector.Collector, 'discover', side_effect=ValueError(phase + ' unavailable')), \
                 patch.object(sys, 'argv', ['collector', '--source', 'eniwa-events', '--state-dir', folder]), redirect_stdout(io.StringIO()):
                if via_cli:
                    self.assertEqual(collector.main(), 1)
                else:
                    current = collector.Collector(folder, 'http://127.0.0.1/dataset.html', interval=0)
                    try:
                        self.assertEqual(len(current.run('eniwa-events')['errors']), 1)
                    finally:
                        current.db.close()
            with self.assertRaisesRegex(ValueError, 'Incomplete collector run'):
                normalize_report(folder, 'eniwa-events', 2026)
            with closing(sqlite3.connect(Path(folder) / 'state.sqlite')) as db:
                self.assertEqual(db.execute('SELECT count(*) FROM runs').fetchone()[0], 2)
            self.assertEqual(blob.read_bytes(), body)

    def test_robots_failure_invalidates_latest_publishable_run(self):
        self.check_failure('robots')

    def test_discovery_failure_invalidates_latest_publishable_run(self):
        self.check_failure('discovery')

    def test_ambiguous_discovery_invalidates_latest_publishable_run(self):
        self.check_failure('Ambiguous CSV filename')

    def test_library_run_also_records_discovery_failures(self):
        self.check_failure('discovery', via_cli=False)

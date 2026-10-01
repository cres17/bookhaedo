import csv
import io
import json
import unittest
from pathlib import Path
from normalize import normalize_csv, normalize_report

ROOT = Path(__file__).resolve().parents[2]


class Normalize(unittest.TestCase):
    def test_actual_source_probe_samples(self):
        sources = {s['id']: s for s in json.loads((ROOT / 'ops/tourism/sources.json').read_text())}
        probe = json.loads((ROOT / 'docs/research/tourism-source-probe-20261001.json').read_text())
        for item in probe['sources'][:3]:
            source = sources[item['source'].replace('_', '-')]
            resource = item['resources'][0]
            csv_text = io.StringIO()
            writer = csv.writer(csv_text)
            writer.writerow(resource['columns'])
            writer.writerows(resource['sample'])
            body = csv_text.getvalue().encode(resource['encoding'])
            records = normalize_csv(body, source, {'url':resource['url'], 'key':'sample.csv'}, '2026-10-01T00:00:00Z')
            self.assertEqual(len(records), len(resource['sample']))
            if source['id'] == 'furano-places':
                self.assertTrue(all(r['hoursStatus'] == 'historical' for r in records))
            if source['id'] == 'furano-events':
                self.assertTrue(all(r['dateStatus'] == 'recurring' and r['startDate'] is None for r in records))
            if source['id'] == 'eniwa-events':
                self.assertEqual(records[0]['externalId'], '0000000001')
                self.assertIsNone(records[0]['latitude'])

    def fixture(self, **changes):
        source = {'id':'eniwa-events','kind':'event','regionId':'new-chitose'}
        row = {'NO':'0000000001','イベント名':'event','説明':'text','開始日':'2026-10-01',
               '終了日':'2026-10-02','開始日時特記事項':'','備考':'','緯度':'','経度':''}
        row.update(changes)
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=row.keys())
        writer.writeheader(); writer.writerow(row)
        return output.getvalue().encode('cp932'),source

    def test_uncertain_dates_are_never_promoted_to_confirmed(self):
        body,source = self.fixture(備考='日程変更の予定、未確定')
        r = normalize_csv(body,source,{'url':'fixture','key':'x'},'2026-10-01T00:00:00Z')[0]
        self.assertEqual(r['dateStatus'],'tentative')

    def test_invalid_date_and_coordinates_fail_closed(self):
        for changes in [{'開始日':'2026-02-30'}, {'緯度':'0','経度':'0'}, {'緯度':'43'}, {'終了日':'2026-09-01'}]:
            with self.subTest(changes=changes):
                body,source = self.fixture(**changes)
                with self.assertRaises(ValueError):
                    normalize_csv(body,source,{'url':'fixture','key':'x'},'2026-10-01T00:00:00Z')

    def test_missing_columns_and_empty_records_are_quarantined(self):
        body,source = self.fixture()
        for invalid in [b'<html>error</html>', b'NO,event\n1,x', body.splitlines()[0]+b'\n']:
            with self.assertRaises(ValueError):
                normalize_csv(invalid,source,{'url':'fixture','key':'x'},'2026-10-01T00:00:00Z')

    def test_complete_report_hash_year_selection_and_failed_run(self):
        import hashlib
        import sqlite3
        import tempfile
        body, _ = self.fixture()
        digest = hashlib.sha256(body).hexdigest()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            blob = root / 'blobs' / digest / 'source.csv'
            blob.parent.mkdir(parents=True)
            blob.write_bytes(body)
            resource = {'url':'https://www.harp.lg.jp/opendata/dataset/1823/resource/8944/event2026.csv',
                        'key':'event2026.csv','sha256':digest,'year':2026}
            report = {'source':'eniwa-events','started_at':'2026-10-01T00:00:00Z',
                      'resources_found':1,'resources':[resource],'errors':[]}
            with sqlite3.connect(root / 'state.sqlite') as db:
                db.execute('CREATE TABLE runs(id INTEGER PRIMARY KEY, source TEXT, report TEXT)')
                db.execute('INSERT INTO runs(source,report) VALUES (?,?)',('eniwa-events',json.dumps(report)))
            self.assertEqual(normalize_report(root,'eniwa-events',2026)['records'][0]['externalId'],'0000000001')
            with self.assertRaisesRegex(ValueError,'requested event year'):
                normalize_report(root,'eniwa-events',2027)
            blob.write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError,'SHA mismatch'):
                normalize_report(root,'eniwa-events',2026)
            blob.write_bytes(body)
            report['errors'] = [{'error':'503'}]
            with sqlite3.connect(root / 'state.sqlite') as db:
                db.execute('INSERT INTO runs(source,report) VALUES (?,?)',('eniwa-events',json.dumps(report)))
            with self.assertRaisesRegex(ValueError,'Incomplete collector run'):
                normalize_report(root,'eniwa-events',2026)

    def test_hokuto_resource_pin_and_existing_schema(self):
        import hashlib
        import sqlite3
        import tempfile
        source = next(s for s in json.loads((ROOT / 'ops/tourism/sources.json').read_text()) if s['id'] == 'hokuto-places')
        body = 'ID,名称,説明,緯度,経度,利用可能日時特記事項\n0001,北斗施設fixture,,41.9,140.65,年中無休\n'.encode('cp932')
        digest = hashlib.sha256(body).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            blob = root / 'blobs' / digest / 'source.csv'
            blob.parent.mkdir(parents=True); blob.write_bytes(body)
            resource = {'url':source['resourceUrl'],'key':'012360_torurism_20260826.csv','sha256':digest}
            report = {'source':'hokuto-places','started_at':'2026-10-01T00:00:00Z','resources_found':1,'resources':[resource],'errors':[]}
            with sqlite3.connect(root / 'state.sqlite') as db:
                db.execute('CREATE TABLE runs(id INTEGER PRIMARY KEY, source TEXT, report TEXT)')
                db.execute('INSERT INTO runs(source,report) VALUES (?,?)',('hokuto-places',json.dumps(report)))
            result = normalize_report(root,'hokuto-places')
            self.assertEqual(result['records'][0]['externalId'],'0001')
            self.assertEqual(result['records'][0]['regionId'],'hakodate')
            self.assertIsNone(result['records'][0]['sourceUpdatedAt'])
            report['resources'][0]['url'] = 'https://www.harp.lg.jp/opendata/dataset/1657/resource/old/old.csv'
            with sqlite3.connect(root / 'state.sqlite') as db:
                db.execute('INSERT INTO runs(source,report) VALUES (?,?)',('hokuto-places',json.dumps(report)))
            with self.assertRaisesRegex(ValueError,'Resource version is not approved'):
                normalize_report(root,'hokuto-places')


if __name__ == '__main__':
    unittest.main()

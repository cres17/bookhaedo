#!/usr/bin/env python3
"""Bounded, persistent approved HARP/Sapporo CSV collector. Runtime state stays outside Git."""
import argparse
import csv
import fcntl
import hashlib
import io
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path

from source_policy import approved_source_policy, collector_policy

REGISTRY = Path(__file__).resolve().parents[2] / 'ops/tourism/sources.json'
REGISTERED = {s['id']: s for s in json.loads(REGISTRY.read_text())
              if s['enabled'] and s['rightsStatus'] == 'approved' and approved_source_policy(s)}
SOURCES = {key: source['sourceUrl'] for key, source in REGISTERED.items()}
AGENT = 'BookhaedoTourismCollector/0.1'


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.links.extend(v for k, v in attrs if k == 'href' and v)


class Collector:
    def __init__(self, root, page, interval=60, attempts=3, min_year=2026, resource_url=None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.page = page
        self.resource_url = resource_url
        self.origin = urllib.parse.urlsplit(page)
        if self.origin.scheme not in ('https', 'http'):
            raise ValueError('Unsupported URL scheme')
        self.local = self.origin.hostname in ('127.0.0.1', 'localhost')
        policy = None if self.local else collector_policy(page, resource_url, REGISTERED.values())
        if not self.local and not policy:
            raise ValueError('Only approved HARP/Sapporo HTTPS or loopback fixture is allowed')
        floor = policy['minimumIntervalSeconds'] if policy else 0
        self.interval = interval if self.local else max(floor, interval)
        self.attempts = attempts
        self.min_year = min_year
        self.db = sqlite3.connect(self.root / 'state.sqlite')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS gate(origin TEXT PRIMARY KEY, last_start REAL);
          CREATE TABLE IF NOT EXISTS domain_delays(origin TEXT PRIMARY KEY, seconds REAL);
          CREATE TABLE IF NOT EXISTS documents(url TEXT PRIMARY KEY, etag TEXT, modified TEXT, body BLOB);
          CREATE TABLE IF NOT EXISTS resources(source TEXT, url TEXT, key TEXT, sha TEXT,
            PRIMARY KEY(source,url));
          CREATE TABLE IF NOT EXISTS versions(source TEXT, key TEXT, sha TEXT, rows INTEGER,
            PRIMARY KEY(source,key,sha));
          CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, source TEXT, started REAL, report TEXT);
        ''')
        stored = self.db.execute('SELECT seconds FROM domain_delays WHERE origin=?',
                                 (self.origin.netloc,)).fetchone()
        if stored:
            self.interval = max(self.interval, stored[0])
        self.robot = None

    def log(self, event):
        with (self.root / 'requests.jsonl').open('a') as f:
            f.write(json.dumps(event, ensure_ascii=False) + '\n')

    def gate(self):
        origin = self.origin.netloc
        # State directory has an exclusive process lock; timestamp survives restart.
        row = self.db.execute('SELECT last_start FROM gate WHERE origin=?', (origin,)).fetchone()
        if row:
            deadline = row[0] + self.interval
            # Recheck after waking; wall-clock adjustments or early wakes must not shorten the gate.
            while (remaining := deadline - time.time()) > 0:
                time.sleep(remaining)
        started = time.time()
        self.db.execute('INSERT OR REPLACE INTO gate VALUES (?,?)', (origin, started))
        self.db.commit()
        return started

    def fetch(self, url, conditional=True):
        target = urllib.parse.urlsplit(url)
        if target.netloc != self.origin.netloc or target.scheme != self.origin.scheme:
            raise ValueError('Cross-origin fetch refused')
        is_robots = urllib.parse.urlsplit(url).path == '/robots.txt'
        if self.robot and not is_robots and not self.robot.can_fetch(AGENT, url):
            raise ValueError('robots.txt disallows URL')
        cached = self.db.execute('SELECT etag,modified,body FROM documents WHERE url=?', (url,)).fetchone()
        headers = {'User-Agent': AGENT}
        if conditional and cached:
            if cached[0]: headers['If-None-Match'] = cached[0]
            if cached[1]: headers['If-Modified-Since'] = cached[1]
        # Reject redirects so requests cannot bypass the host gate or allowlist.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, hdrs, newurl):
                return None
        handlers = [NoRedirect()]
        if self.local:
            handlers.append(urllib.request.ProxyHandler({}))
        opener = urllib.request.build_opener(*handlers)
        for attempt in range(1, self.attempts + 1):
            started = self.gate()
            try:
                with opener.open(urllib.request.Request(url, headers=headers), timeout=30) as r:
                    body = r.read(2_000_001)
                    if len(body) > 2_000_000: raise ValueError('Response too large')
                    self.db.execute('INSERT OR REPLACE INTO documents VALUES (?,?,?,?)',
                                    (url, r.headers.get('ETag'), r.headers.get('Last-Modified'), body))
                    self.db.commit()
                    self.log({'url': url, 'start': started, 'attempt': attempt, 'status': r.status})
                    return body, r.status
            except urllib.error.HTTPError as e:
                self.log({'url': url, 'start': started, 'attempt': attempt, 'status': e.code})
                e.close()
                if e.code == 304 and cached: return bytes(cached[2]), 304
                if e.code not in (429, 500, 502, 503, 504) or attempt == self.attempts: raise
                delay = e.headers.get('Retry-After', '')
                try: seconds = float(delay)
                except ValueError:
                    try: seconds = parsedate_to_datetime(delay).timestamp() - time.time()
                    except (ValueError, TypeError, OverflowError): seconds = 2 ** (attempt - 1)
                time.sleep(max(0, seconds))
            except (urllib.error.URLError, TimeoutError) as e:
                self.log({'url': url, 'start': started, 'attempt': attempt, 'error': str(e)})
                if attempt == self.attempts: raise
                # A failed conditional request is not a successful refresh. Retry the same
                # approved URL without validators, still through the persistent host gate.
                headers.pop('If-None-Match', None)
                headers.pop('If-Modified-Since', None)
                time.sleep(2 ** (attempt - 1))

    def robots(self):
        # Conservative source policy: unavailable robots (including 404) stops collection.
        # Do not infer permission or fall back to stale rules after a failed refresh.
        self.robot = None
        url = urllib.parse.urlunsplit((self.origin.scheme, self.origin.netloc, '/robots.txt', '', ''))
        body, _ = self.fetch(url)
        self.robot = urllib.robotparser.RobotFileParser()
        self.robot.parse(body.decode('utf-8').splitlines())
        self.interval = max(self.interval, self.robot.crawl_delay(AGENT) or 0)
        self.db.execute('INSERT OR REPLACE INTO domain_delays VALUES (?,?)',
                        (self.origin.netloc, self.interval))
        self.db.commit()

    def discover(self):
        html, status = self.fetch(self.page)
        parser = Links()
        parser.feed(html.decode('utf-8'))
        found = {}
        for href in parser.links:
            url = urllib.parse.urljoin(self.page, href)
            split = urllib.parse.urlsplit(url)
            if split.netloc != self.origin.netloc or split.scheme != self.origin.scheme: continue
            name = urllib.parse.unquote(split.path.rsplit('/', 1)[-1]).strip()
            if not name.lower().endswith('.csv'): continue
            if self.resource_url and url != self.resource_url: continue
            years = re.findall(r'(?<!\d)(20\d{2})(?!\d)', name)
            year = int(years[-1]) if years else None
            if year is not None and year < self.min_year: continue
            # Stable logical key survives a changed resource directory or duplicate link.
            key = name.replace(' ', '').casefold()
            if key in found and found[key]['url'] != url:
                raise ValueError('Ambiguous CSV filename across resource URLs: ' + name)
            found.setdefault(key, {'url': url, 'key': key, 'year': year})
        return list(found.values()), status

    def save_report(self, source, started, report):
        self.db.execute('INSERT INTO runs(source,started,report) VALUES (?,?,?)',
                        (source, started, json.dumps(report, ensure_ascii=False)))
        self.db.commit()

    def failed_report(self, source, started, error):
        report = {'source': source, 'started_at': datetime.fromtimestamp(started, timezone.utc).isoformat(),
                  'resources_found': 0, 'resources': [], 'errors': [{'error': str(error)}]}
        self.save_report(source, started, report)
        return report

    def run(self, source):
        started = time.time()
        try:
            discovered, status = self.discover()
        except Exception as error:
            # Library callers must not leave the previous success as the latest run either.
            return self.failed_report(source, started, error)
        report = {'source': source, 'started_at': datetime.now(timezone.utc).isoformat(),
                  'page_status': status, 'resources_found': len(discovered), 'resources': [], 'errors': []}
        for item in discovered:
            try:
                body, code = self.fetch(item['url'])
                for encoding in ('utf-8-sig', 'cp932'):
                    try: text = body.decode(encoding); break
                    except UnicodeDecodeError: continue
                else: raise ValueError('Unsupported encoding')
                reader = csv.DictReader(io.StringIO(text), strict=True)
                if not reader.fieldnames or not any('名称' in k or 'イベント名' in k for k in reader.fieldnames):
                    raise ValueError('Unexpected CSV schema')
                rows = [r for r in reader if any((v or '').strip() for v in r.values() if isinstance(v, str))]
                if any(None in r or any(v is None for v in r.values()) for r in rows):
                    raise ValueError('Malformed CSV row')
                sha = hashlib.sha256(body).hexdigest()
                folder = self.root / 'blobs' / sha
                folder.mkdir(parents=True, exist_ok=True)
                original = folder / 'source.csv'
                if not original.exists():
                    tmp = folder / 'source.csv.tmp'; tmp.write_bytes(body); tmp.replace(original)
                with self.db:
                    active = self.db.execute('SELECT sha FROM resources WHERE source=? AND key=?',
                                            (source, item['key'])).fetchall()
                    self.db.execute('INSERT OR IGNORE INTO versions VALUES (?,?,?,?)',
                                    (source, item['key'], sha, len(rows)))
                    change = 'new' if not active else ('unchanged' if all(r[0] == sha for r in active) else 'updated')
                    self.db.execute('DELETE FROM resources WHERE source=? AND key=?',
                                    (source, item['key']))
                    self.db.execute('INSERT OR REPLACE INTO resources VALUES (?,?,?,?)',
                                    (source, item['url'], item['key'], sha))
                report['resources'].append({**item, 'status': code, 'change': change,
                                             'sha256': sha, 'rows': len(rows), 'encoding': encoding})
            except Exception as e:
                report['errors'].append({'url': item['url'], 'error': str(e)})
        if not discovered: report['errors'].append({'error': 'No eligible CSV discovered'})
        self.save_report(source, started, report)
        return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', choices=SOURCES, default='eniwa-events')
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--rounds', type=int, default=1)
    parser.add_argument('--repeat-seconds', type=float, default=60)
    parser.add_argument('--min-year', type=int, default=2026)
    args = parser.parse_args()
    if args.rounds < 1 or args.repeat_seconds < 0: parser.error('Invalid repetition settings')
    root = Path(args.state_dir); root.mkdir(parents=True, exist_ok=True)
    with (root / '.collector.lock').open('a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'status': 'already_running'})); return 2
        c = Collector(root, SOURCES[args.source], interval=REGISTERED[args.source].get('minimumIntervalSeconds', 60), min_year=args.min_year,
                      resource_url=REGISTERED[args.source].get('resourceUrl'))
        try:
            reports = []
            for i in range(args.rounds):
                if i: time.sleep(args.repeat_seconds)
                started = time.time()
                try:
                    c.robots()  # Revalidate robots; all HTTP requests share the gate.
                    report = c.run(args.source)
                except Exception as e:
                    report = c.failed_report(args.source, started, e)
                reports.append(report)
                print(json.dumps(report, ensure_ascii=False), flush=True)
            (root / 'latest-report.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2))
            return 1 if any(r['errors'] for r in reports) else 0
        finally: c.db.close()


if __name__ == '__main__':
    raise SystemExit(main())

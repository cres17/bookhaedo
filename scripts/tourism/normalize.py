#!/usr/bin/env python3
"""Normalize a complete successful collector report. No network, inference, or DB writes."""
import argparse
import csv
import hashlib
import io
import json
import re
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlsplit

PARSER_VERSION = 'harp-csv-v1'
REGISTRY = Path(__file__).resolve().parents[2] / 'ops/tourism/sources.json'


def iso_date(value):
    value = value.strip()
    if not value:
        return None
    value = value.replace('/', '-')
    return date.fromisoformat(value).isoformat()


def normalize_csv(body, source, resource, fetched_at):
    for encoding in ('utf-8-sig', 'cp932'):
        try:
            text = body.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError('Unsupported CSV encoding')
    reader = csv.DictReader(io.StringIO(text), strict=True)
    id_column = 'NO' if source['id'] == 'eniwa-events' else 'ID'
    title_column = 'イベント名' if source['kind'] == 'event' else '名称'
    required = [id_column, title_column, '説明']
    if source['id'] == 'eniwa-events':
        required += ['開始日', '終了日', '開始日時特記事項', '備考', '緯度', '経度']
    elif source['kind'] == 'place':
        required += ['緯度', '経度', '利用可能日時特記事項']
    else:
        required += ['開催パターン']
    if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames) or not set(required) <= set(reader.fieldnames):
        raise ValueError('Required columns changed; quarantine this source')
    records, seen = [], set()
    for row in reader:
        if None in row or any(v is None for v in row.values()):
            raise ValueError('Incomplete CSV row')
        if not any(v.strip() for v in row.values()):
            continue
        external_id, title = row[id_column].strip(), row[title_column].strip()
        if not external_id or not title or external_id in seen:
            raise ValueError('Missing or duplicate stable ID')
        seen.add(external_id)
        lat_raw, lon_raw = row.get('緯度', '').strip(), row.get('経度', '').strip()
        if bool(lat_raw) != bool(lon_raw):
            raise ValueError('Incomplete coordinates')
        lat, lon = (float(lat_raw), float(lon_raw)) if lat_raw else (None, None)
        if lat is not None and not (41 <= lat <= 46.1 and 137 <= lon <= 147):
            raise ValueError('Coordinates outside Hokkaido')
        start, end = iso_date(row.get('開始日', '')), iso_date(row.get('終了日', ''))
        if start and end and start > end:
            raise ValueError('Reversed event dates')
        schedule = '\n'.join(row.get(k, '') for k in ['開催パターン', '開始日時特記事項', '備考', '利用可能日時特記事項']).strip()
        # These statuses describe date completeness and conservative text heuristics,
        # not a verified announcement that an event will take place.
        uncertain = bool(re.search(r'未確定|未定|変更|予定|調整中', schedule))
        status = 'tentative' if uncertain else 'confirmed' if start and end else 'recurring' if '毎年' in schedule else 'unknown'
        records.append({
            'externalId': external_id, 'kind': source['kind'], 'regionId': source['regionId'],
            'titleJa': title, 'descriptionJa': row['説明'].strip(),
            'resourceUrl': resource['url'], 'contentSha256': hashlib.sha256(body).hexdigest(),
            'sourceUpdatedAt': None, 'evidencePointer': f"csv:{resource['key']}:ID={external_id};columns={','.join(required)}",
            'latitude': lat, 'longitude': lon, 'locationStatus': 'provided' if lat is not None else 'missing',
            'startDate': start, 'endDate': end, 'timezone': 'Asia/Tokyo', 'dateStatus': status,
            'scheduleRaw': schedule, 'hoursStatus': 'historical' if re.search(r'20\d{2}', schedule) and source['kind'] == 'place' else 'unknown',
            'validFrom': None, 'validUntil': None,
        })
    if not records:
        raise ValueError('No valid records; keep previous snapshot')
    return records


def normalize_report(state_dir, source_id, year=None):
    root = Path(state_dir)
    sources = {s['id']: s for s in json.loads(REGISTRY.read_text())}
    source = sources[source_id]
    if not source['enabled'] or source['rightsStatus'] != 'approved':
        raise ValueError('Source reuse is not approved')
    # Only latest complete success is publishable. An older success is not a fresh fetch.
    import sqlite3
    with sqlite3.connect(f'file:{root / "state.sqlite"}?mode=ro', uri=True) as db:
        result = db.execute('SELECT report FROM runs WHERE source=? ORDER BY id DESC LIMIT 1', (source_id,)).fetchone()
    if not result:
        raise ValueError('No collector report')
    report = json.loads(result[0])
    if report['errors'] or not report['resources'] or len(report['resources']) != report['resources_found']:
        raise ValueError('Incomplete collector run; keep previous snapshot')
    fetched_at = report['started_at']
    datetime.fromisoformat(fetched_at)
    year = year if year is not None else date.today().year
    resources = [r for r in report['resources'] if source_id != 'eniwa-events' or r.get('year') == year]
    if not resources:
        raise ValueError('No resource for requested event year; do not reuse an older file')
    records, seen = [], set()
    for resource in resources:
        sha = resource['sha256']
        if not re.fullmatch(r'[a-f0-9]{64}', sha):
            raise ValueError('Invalid blob SHA')
        url = urlsplit(resource['url'])
        if url.scheme != 'https' or url.netloc != 'www.harp.lg.jp' or not url.path.startswith('/opendata/dataset/'):
            raise ValueError('Resource URL outside allowlist')
        body = (root / 'blobs' / sha / 'source.csv').read_bytes()
        if hashlib.sha256(body).hexdigest() != sha:
            raise ValueError('Blob SHA mismatch')
        for record in normalize_csv(body, source, resource, fetched_at):
            if record['externalId'] in seen:
                raise ValueError('Ambiguous IDs across files; select the intended resource before publishing')
            seen.add(record['externalId'])
            records.append(record)
    return {'sourceId': source_id, 'parserVersion': PARSER_VERSION, 'fetchedAt': fetched_at, 'records': records}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--year', type=int, help='Eniwa resource year; default current year. Dates still come from CSV.')
    args = parser.parse_args()
    result = normalize_report(args.state_dir, args.source, args.year)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix('.tmp')
    tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    tmp.replace(output)
    print(f"Normalized {len(result['records'])} records; no catalog/itinerary modifications")


if __name__ == '__main__':
    main()

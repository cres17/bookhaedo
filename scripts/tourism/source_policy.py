"""Read the reviewed allowlist independently of source registry metadata."""
import json
import re
from pathlib import Path
from urllib.parse import urlsplit, unquote

POLICY = json.loads(
    (Path(__file__).resolve().parents[2] / 'ops/tourism/source-policy.json').read_text()
)
if POLICY['version'] != 1:
    raise ValueError('Unsupported tourism source policy')


def clean_url(value):
    # Match TypeScript without normalizing away traversal or rewriting source attribution.
    if (not isinstance(value, str) or len(value) > 8192 or not value.startswith('https://')
            or any(ord(c) < 33 or ord(c) > 126 for c in value)
            or any(c in value for c in ('\\', '?', '#'))):
        return None
    try:
        url = urlsplit(value)
        if (url.scheme != 'https' or url.username or url.password or url.query or url.fragment
                or '%' in url.netloc or url.netloc != url.hostname or url.geturl() != value):
            return None
        if re.search(r'%(?:2e|2f|5c|25|3f|23)|%(?![a-f0-9]{2})', url.path, re.I):
            return None
        decoded = unquote(url.path, encoding='utf-8', errors='strict')
        if (any(ord(c) < 32 or ord(c) == 127 for c in decoded)
                or any(part in ('.', '..') for part in decoded.split('/'))):
            return None
        return url
    except (ValueError, UnicodeDecodeError):
        return None


def harp_url(value):
    url = clean_url(value)
    return bool(
        url
        and f'{url.scheme}://{url.netloc}' == POLICY['harp']['origin']
        and url.path.startswith(POLICY['harp']['datasetPrefix'])
    )


def approved_source_policy(source):
    if (
        harp_url(source['sourceUrl'])
        and source.get('parserVersion', 'harp-csv-v1') == 'harp-csv-v1'
    ):
        return POLICY['harp']
    for policy in POLICY['exceptions']:
        if policy['sourceId'] == source['id'] and all(
            policy[key] == source.get(key)
            for key in ('sourceUrl', 'resourceUrl', 'parserVersion')
        ):
            return policy
    return None


def approved_resource_url(value):
    return harp_url(value) or bool(
        clean_url(value)
        and any(policy['resourceUrl'] == value for policy in POLICY['exceptions'])
    )


def resource_belongs_to_source(source, value):
    if not approved_source_policy(source) or not approved_resource_url(value):
        return False
    if source.get('resourceUrl') and value != source['resourceUrl']:
        return False
    if harp_url(source['sourceUrl']):
        page, resource = urlsplit(source['sourceUrl']), urlsplit(value)
        return (
            resource.netloc == page.netloc
            and resource.path.startswith(page.path.replace('.html', '/'))
        )
    return value == source.get('resourceUrl')


def collector_policy(page, resource_url, sources):
    if harp_url(page):
        return POLICY['harp']
    for source in sources:
        if source['sourceUrl'] == page and source.get('resourceUrl') == resource_url:
            policy = approved_source_policy(source)
            if policy:
                return policy
    return None

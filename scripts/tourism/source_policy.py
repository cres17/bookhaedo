"""Read the reviewed allowlist independently of source registry metadata."""
import json
from pathlib import Path
from urllib.parse import urlsplit

POLICY = json.loads(
    (Path(__file__).resolve().parents[2] / 'ops/tourism/source-policy.json').read_text()
)
if POLICY['version'] != 1:
    raise ValueError('Unsupported tourism source policy')


def clean_url(value):
    if (
        not isinstance(value, str)
        or not value.startswith('https://')
        or any(ord(c) < 33 or ord(c) > 126 for c in value)
        or any(c in value for c in ('\\', '%', '?', '#'))
    ):
        return None
    try:
        url = urlsplit(value)
        if (
            url.scheme == 'https'
            and not url.username
            and not url.password
            and not url.query
            and not url.fragment
            and not any(part in ('.', '..') for part in url.path.split('/'))
        ):
            return url
    except ValueError:
        pass
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

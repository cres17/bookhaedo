# Hokkaido geodata import report

Generated from the snapshots downloaded on 2026-09-08.

## Outcome

| Stage | Result |
| --- | ---: |
| Municipal CSV input rows | 35,578 |
| Valid municipal facility rows | 34,628 |
| Quarantined municipal rows | 950 |
| OSM travel POIs extracted | 21,018 |
| OSM duplicate representations collapsed | 215 |
| Canonical places generated | 20,803 |
| Current PostGIS places after non-destructive upsert | 20,810 |
| Municipal records matched to OSM places | 3,981 |
| Ambiguous municipal matches skipped | 3 |

Canonical place categories:

| Category | Rows |
| --- | ---: |
| Attraction | 12,737 |
| Restaurant | 5,963 |
| Lodging | 2,103 |

## Quality findings

1. The municipal CSV is CP932, not UTF-8. The pipeline exports a normalized
   UTF-8 copy before loading it.
2. All 950 rejected rows belong to `国・都道府県機関`. In every rejected row,
   latitude and longitude are identical, placing the longitude outside
   Hokkaido. These rows are quarantined instead of silently repaired.
3. The municipal dataset is mainly public infrastructure, not a tourism
   catalog. It contains medical facilities, evacuation sites, parks, welfare
   facilities, schools, and other public services. It is therefore retained as
   a reference table and never creates a canonical travel place by itself.
4. The source publisher warns that some facility records may be old, renamed,
   closed, or missing newly opened facilities. OSM is the primary POI source;
   municipal records only add an address or municipality when normalized names
   match exactly within 250 metres.
5. Every loaded canonical place has a non-empty name, a coordinate inside the
   Hokkaido extract bounds, and a valid PostGIS geography point.

## Remaining product-level caveats

- Assignment to the 12 product regions currently uses the nearest configured
  regional anchor. Median anchor distance is 9.176 km, the 95th percentile is
  65.132 km, and the maximum is 119.342 km. A municipality-to-region reference
  table or administrative polygons should replace this heuristic before a
  public launch.
- OSM coverage is broad but metadata is sparse: 15,558 places have no address,
  16,283 have no website, and 18,589 have no opening-hours tag. Official pages,
  Rakuten, and Hot Pepper remain necessary for operational details.
- Small parks, memorials, peaks, and public artworks are included in the raw
  attraction catalog. The recommendation/UI layer should rank or filter them
  instead of presenting all attractions equally.

## Provenance and licenses

- OpenStreetMap extract: ODbL 1.0, attribution `© OpenStreetMap contributors`.
  Snapshot replication timestamp: `2026-09-07T20:21:20Z`.
- Hokkaido facility database: the portal resource is marked CC BY and combines
  MLIT National Land Numerical Information with municipal open data. Keep the
  stored source name and original-material field when redistributing records.

Source pages:

- https://download.geofabrik.de/asia/japan/hokkaido.html
- https://www.harp.lg.jp/opendata/dataset/227.html

Machine-readable details are stored in
`data/processed/quality_report.json`; rejected records are stored in
`data/processed/municipal_facilities_rejected.csv`.

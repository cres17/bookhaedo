# Data source policy

Kita Plan separates data that can be stored from data that should be fetched on demand.

| Domain | Primary source | Storage policy |
| --- | --- | --- |
| Attractions | OpenStreetMap + curated official pages | Store normalized records with attribution |
| Restaurants | Hot Pepper + OpenStreetMap | Store permitted fields and source identifiers |
| Lodging | Rakuten SimpleHotelSearch | Store basic catalog fields; fetch price/vacancy separately |
| Events | Official tourism associations | Curate records and always retain the official URL |
| Pop-ups | Venue event pages | Best-effort, short-lived records with automatic expiry |

## Local geodata snapshots

| File | Role | Encoding / license | Import rule |
| --- | --- | --- | --- |
| `hokkaido-260907.osm.pbf` | Primary source for travel POIs | ODbL 1.0; © OpenStreetMap contributors | Extract named attractions, restaurants, and lodging |
| `Hokkaido_OD_GeoDataBase.csv` | Municipal/public-facility location reference | CP932; resource marked CC BY, with underlying MLIT and municipal sources | Keep valid rows in staging; only enrich an OSM place on exact normalized name + 250 m proximity |

The municipal CSV is not treated as a current tourism catalog. Its official
description warns that names, closures, and newly opened facilities may be stale.
Rows with invalid/out-of-Hokkaido coordinates are quarantined rather than repaired
by inference. The generated `data/processed/quality_report.json` records counts and
all merge decisions.

Source pages:

- Hokkaido facility database: https://www.harp.lg.jp/opendata/dataset/227.html
- OpenStreetMap Hokkaido extract: https://download.geofabrik.de/asia/japan/hokkaido.html

## Source-aware rules

- Every imported entity must retain `source`, `externalId`, `sourceUrl`, and `fetchedAt`.
- Do not merge ratings from different platforms into one score.
- Do not permanently copy Google reviews or images.
- Preserve raw Japanese event schedule text beside normalized occurrences.
- Deduplicate places by source identifier first, then normalized name and nearby coordinates.

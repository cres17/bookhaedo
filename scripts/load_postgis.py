#!/usr/bin/env python3
"""Load processed Hokkaido geodata into the local PostgreSQL/PostGIS catalog."""

from __future__ import annotations

import argparse
import csv
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb


DATA_SOURCES = [
    (
        "OSM",
        "OpenStreetMap Hokkaido extract",
        "https://download.geofabrik.de/asia/japan/hokkaido.html",
        "ODbL 1.0",
        "© OpenStreetMap contributors",
    ),
    (
        "MUNICIPALITY",
        "Hokkaido facility location database",
        "https://www.harp.lg.jp/opendata/dataset/227.html",
        "CC BY (resource page; observe underlying source terms)",
        "北海道オープンデータポータル / 国土数値情報 / 道内市町村オープンデータ",
    ),
]


def blank_to_none(value: str | None):
    return value if value not in (None, "") else None


def load(args: argparse.Namespace) -> None:
    report = json.loads((args.data_dir / "quality_report.json").read_text(encoding="utf-8"))
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    with psycopg.connect(args.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(args.schema.read_text(encoding="utf-8"))
            cursor.execute(
                """
                INSERT INTO geo_data.import_run (id, started_at, osm_replication_timestamp, quality_report)
                VALUES (%s, %s, %s, %s)
                """,
                (run_id, now, blank_to_none(report["osm"].get("replication_timestamp")), Jsonb(report)),
            )
            for code, name, url, license_name, attribution in DATA_SOURCES:
                cursor.execute(
                    """
                    INSERT INTO geo_data.data_source
                      (code, source_name, source_url, license, attribution, snapshot_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (code) DO UPDATE SET
                      source_name = EXCLUDED.source_name,
                      source_url = EXCLUDED.source_url,
                      license = EXCLUDED.license,
                      attribution = EXCLUDED.attribution,
                      snapshot_at = EXCLUDED.snapshot_at
                    """,
                    (code, name, url, license_name, attribution, blank_to_none(report["osm"].get("replication_timestamp")) if code == "OSM" else now),
                )

            with (args.data_dir / "municipal_facilities_utf8.csv").open(encoding="utf-8", newline="") as handle:
                municipal_rows = list(csv.DictReader(handle))
            for row in municipal_rows:
                cursor.execute(
                    """
                    INSERT INTO geo_data.municipal_facility (
                      external_id, name_ja, normalized_name, municipality_name,
                      latitude, longitude, location, source_address, search_address,
                      building, data_type, source_name, original_material
                    ) VALUES (
                      %s, %s, %s, %s, %s, %s,
                      ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                      %s, %s, %s, %s, %s, %s
                    )
                    ON CONFLICT (external_id) DO UPDATE SET
                      name_ja = EXCLUDED.name_ja,
                      normalized_name = EXCLUDED.normalized_name,
                      municipality_name = EXCLUDED.municipality_name,
                      latitude = EXCLUDED.latitude,
                      longitude = EXCLUDED.longitude,
                      location = EXCLUDED.location,
                      source_address = EXCLUDED.source_address,
                      search_address = EXCLUDED.search_address,
                      building = EXCLUDED.building,
                      data_type = EXCLUDED.data_type,
                      source_name = EXCLUDED.source_name,
                      original_material = EXCLUDED.original_material,
                      imported_at = now()
                    """,
                    (
                        row["external_id"], row["name_ja"], row["normalized_name"], row["municipality_name"],
                        float(row["latitude"]), float(row["longitude"]), float(row["longitude"]), float(row["latitude"]),
                        blank_to_none(row["source_address"]), blank_to_none(row["search_address"]), blank_to_none(row["building"]),
                        row["data_type"], row["source_name"], blank_to_none(row["original_material"]),
                    ),
                )

            with (args.data_dir / "places_merged.csv").open(encoding="utf-8", newline="") as handle:
                place_rows = list(csv.DictReader(handle))
            for row in place_rows:
                cursor.execute(
                    """
                    INSERT INTO geo_data.place (
                      id, region_id, category, name_ja, name_en, name_ko,
                      normalized_name, municipality_name, address, latitude, longitude,
                      location, phone, website, opening_hours, osm_tags, source_count,
                      region_distance_km
                    ) VALUES (
                      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                      %s, %s, %s, %s, %s, %s
                    )
                    ON CONFLICT (id) DO UPDATE SET
                      region_id = EXCLUDED.region_id,
                      category = EXCLUDED.category,
                      name_ja = EXCLUDED.name_ja,
                      name_en = EXCLUDED.name_en,
                      name_ko = EXCLUDED.name_ko,
                      normalized_name = EXCLUDED.normalized_name,
                      municipality_name = EXCLUDED.municipality_name,
                      address = EXCLUDED.address,
                      latitude = EXCLUDED.latitude,
                      longitude = EXCLUDED.longitude,
                      location = EXCLUDED.location,
                      phone = EXCLUDED.phone,
                      website = EXCLUDED.website,
                      opening_hours = EXCLUDED.opening_hours,
                      osm_tags = EXCLUDED.osm_tags,
                      source_count = EXCLUDED.source_count,
                      region_distance_km = EXCLUDED.region_distance_km,
                      updated_at = now()
                    """,
                    (
                        row["id"], row["region_id"], row["category"], row["name_ja"],
                        blank_to_none(row["name_en"]), blank_to_none(row["name_ko"]), row["normalized_name"],
                        blank_to_none(row["municipality_name"]), blank_to_none(row["address"]),
                        float(row["latitude"]), float(row["longitude"]), float(row["longitude"]), float(row["latitude"]),
                        blank_to_none(row["phone"]), blank_to_none(row["website"]), blank_to_none(row["opening_hours"]),
                        Jsonb(json.loads(row["osm_tags_json"])), int(row["source_count"]), float(row["region_distance_km"]),
                    ),
                )

            with (args.data_dir / "place_sources.csv").open(encoding="utf-8", newline="") as handle:
                for row in csv.DictReader(handle):
                    cursor.execute(
                        """
                        INSERT INTO geo_data.place_source
                          (source_code, external_id, place_id, source_url, license, raw_data, fetched_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (source_code, external_id) DO UPDATE SET
                          place_id = EXCLUDED.place_id,
                          source_url = EXCLUDED.source_url,
                          license = EXCLUDED.license,
                          raw_data = EXCLUDED.raw_data,
                          fetched_at = EXCLUDED.fetched_at
                        """,
                        (
                            row["source_code"], row["external_id"], row["place_id"],
                            blank_to_none(row["source_url"]), row["license"], Jsonb(json.loads(row["raw_data"])), now,
                        ),
                    )

            with (args.data_dir / "merge_audit.csv").open(encoding="utf-8", newline="") as handle:
                audit_rows = list(csv.DictReader(handle))
            for row in audit_rows:
                cursor.execute(
                    """
                    INSERT INTO geo_data.merge_audit
                      (municipal_external_id, place_id, distance_m, match_rule)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (municipal_external_id) DO UPDATE SET
                      place_id = EXCLUDED.place_id,
                      distance_m = EXCLUDED.distance_m,
                      match_rule = EXCLUDED.match_rule,
                      matched_at = now()
                    """,
                    (row["municipal_external_id"], row["place_id"], float(row["distance_m"]), row["match_rule"]),
                )

            cursor.execute(
                """
                UPDATE geo_data.import_run SET
                  completed_at = %s,
                  municipal_row_count = %s,
                  osm_poi_count = %s,
                  canonical_place_count = %s,
                  municipal_match_count = %s
                WHERE id = %s
                """,
                (
                    datetime.now(timezone.utc), len(municipal_rows), report["osm"]["extracted_rows"],
                    len(place_rows), len(audit_rows), run_id,
                ),
            )

        connection.commit()

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                  (SELECT count(*) FROM geo_data.municipal_facility),
                  (SELECT count(*) FROM geo_data.place),
                  (SELECT count(*) FROM geo_data.place_source),
                  (SELECT count(*) FROM geo_data.merge_audit),
                  PostGIS_Version()
                """
            )
            municipal_count, place_count, source_count, audit_count, postgis_version = cursor.fetchone()
            print(json.dumps({
                "import_run_id": run_id,
                "municipal_facilities": municipal_count,
                "places": place_count,
                "place_sources": source_count,
                "merge_audits": audit_count,
                "postgis_version": postgis_version,
            }, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--database-url",
        default="postgresql://kita_plan:kita_plan_local@localhost:5433/kita_plan",
    )
    parser.add_argument("--schema", type=Path, default=Path("db/schema.sql"))
    parser.add_argument("--data-dir", type=Path, default=Path("data/processed"))
    load(parser.parse_args())


if __name__ == "__main__":
    main()

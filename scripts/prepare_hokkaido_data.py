#!/usr/bin/env python3
"""Normalize the Hokkaido municipal CSV, extract OSM travel POIs, and merge them.

The municipal CSV is a facility-location reference database, not a current
tourism catalog. All valid rows are retained for traceability, but only rows
that match an OSM POI by normalized name and proximity enrich canonical places.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import unicodedata
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import osmium
from shapely import wkb


HOKKAIDO_BOUNDS = (41.15, 46.05, 137.90, 146.30)
NAMESPACE = uuid.UUID("b0dd4cbe-2702-42d7-95fe-91f50d122548")

REGION_ANCHORS = {
    "sapporo": [(43.0687, 141.3508), (43.0555, 141.3533), (42.9666, 141.1668)],
    "otaru": [(43.1970, 140.9937)],
    "hakodate": [(41.7737, 140.7266)],
    "asahikawa-biei": [(43.7635, 142.3580), (43.5910, 142.4611)],
    "furano": [(43.3420, 142.3913)],
    "niseko-kutchan": [(42.9018, 140.7455), (42.8615, 140.7048)],
    "toya-noboribetsu": [(42.5650, 140.8210), (42.4965, 141.1437)],
    "obihiro-tokachi": [(42.9178, 143.2020)],
    "kushiro-akan": [(42.9906, 144.3820), (43.4356, 144.0956)],
    "abashiri-shiretoko": [(44.0197, 144.2540), (44.0706, 144.9950)],
    "wakkanai-rishiri-rebun": [(45.4170, 141.6770), (45.1785, 141.2414), (45.3030, 141.0478)],
    "new-chitose": [(42.7752, 141.6923)],
}

FOOD_AMENITIES = {"restaurant", "cafe", "fast_food", "food_court", "ice_cream", "pub", "bar"}
FOOD_SHOPS = {"bakery", "confectionery", "chocolate", "deli", "cheese", "seafood", "coffee", "tea"}
LODGING_TOURISM = {
    "hotel", "hostel", "guest_house", "motel", "chalet", "apartment",
    "camp_site", "caravan_site", "alpine_hut", "wilderness_hut",
}
ATTRACTION_TOURISM = {"attraction", "museum", "gallery", "viewpoint", "zoo", "aquarium", "theme_park", "artwork"}
ATTRACTION_LEISURE = {
    "park", "garden", "nature_reserve", "water_park", "amusement_arcade",
    "sports_centre", "playground", "bowling_alley", "escape_game",
}
ATTRACTION_NATURAL = {"peak", "volcano", "hot_spring", "waterfall", "beach", "cape", "geyser", "cave_entrance"}
ATTRACTION_AMENITY = {"arts_centre", "theatre", "cinema", "planetarium", "marketplace", "place_of_worship"}
ATTRACTION_MAN_MADE = {"lighthouse", "observatory"}
ATTRACTION_SHOPS = {
    "antiques", "art", "books", "boutique", "clothes", "craft", "department_store",
    "fabric", "fashion", "gift", "jewelry", "mall", "music", "outdoor", "pottery",
    "second_hand", "shoes", "sports", "toys", "variety_store", "video_games",
}
VISITOR_CRAFTS = {
    "basket_maker", "bookbinder", "ceramics", "glassblower", "jeweller", "painter",
    "photographer", "pottery", "sculptor", "shoemaker", "tailor", "woodworker",
}

MUNICIPAL_FIELDS = [
    "external_id", "name_ja", "normalized_name", "municipality_name",
    "latitude", "longitude", "source_address", "search_address", "building",
    "data_type", "source_name", "original_material",
]
OSM_FIELDS = [
    "external_id", "category", "name_ja", "name_en", "normalized_name",
    "municipality_name", "address", "latitude", "longitude", "phone",
    "website", "opening_hours", "region_id", "region_distance_km", "tags_json",
]
PLACE_FIELDS = [
    "id", "region_id", "category", "name_ja", "name_en", "name_ko",
    "normalized_name", "municipality_name", "address", "latitude", "longitude",
    "phone", "website", "opening_hours", "osm_tags_json", "source_count",
    "region_distance_km", "sources_json",
]


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").casefold()
    value = re.sub(r"[\s\u3000・･·,，.。'\"「」『』【】()（）\[\]{}〈〉《》/\\_-]+", "", value)
    return value


def stable_id(prefix: str, value: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"{prefix}:{value}"))


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def in_hokkaido(lat: float, lon: float) -> bool:
    min_lat, max_lat, min_lon, max_lon = HOKKAIDO_BOUNDS
    return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon


def nearest_region(lat: float, lon: float) -> tuple[str, float]:
    candidates = []
    for region_id, anchors in REGION_ANCHORS.items():
        candidates.append((min(haversine_km(lat, lon, a, b) for a, b in anchors), region_id))
    distance, region_id = min(candidates)
    return region_id, round(distance, 3)


def compact_tags(tags: dict[str, str]) -> dict[str, str]:
    useful = {
        "name", "name:ja", "name:ko", "name:en", "tourism", "amenity",
        "leisure", "historic", "natural", "man_made", "information", "shop",
        "craft", "second_hand", "brand", "brand:wikidata", "operator", "religion", "denomination",
        "bath_type", "piste:type", "piste:difficulty",
        "cuisine", "stars", "website", "contact:website", "phone",
        "contact:phone", "opening_hours", "addr:full", "addr:city",
        "addr:town", "addr:village", "addr:suburb", "addr:street",
        "addr:housenumber", "wikidata", "wikipedia",
    }
    return {key: value for key, value in tags.items() if key in useful}


def classify(tags: dict[str, str]) -> str | None:
    amenity = tags.get("amenity", "")
    tourism = tags.get("tourism", "")
    if amenity in FOOD_AMENITIES:
        return "RESTAURANT"
    if tags.get("shop") in FOOD_SHOPS:
        return "RESTAURANT"
    if tourism in LODGING_TOURISM:
        return "LODGING"
    if tourism in ATTRACTION_TOURISM:
        return "ATTRACTION"
    if tourism == "information" and tags.get("information") in {"office", "visitor_centre"}:
        return "ATTRACTION"
    if tags.get("leisure") in ATTRACTION_LEISURE:
        return "ATTRACTION"
    if tags.get("natural") in ATTRACTION_NATURAL:
        return "ATTRACTION"
    if amenity in ATTRACTION_AMENITY:
        return "ATTRACTION"
    if tags.get("man_made") in ATTRACTION_MAN_MADE:
        return "ATTRACTION"
    if tags.get("shop") in ATTRACTION_SHOPS:
        return "ATTRACTION"
    if tags.get("craft") in VISITOR_CRAFTS:
        return "ATTRACTION"
    if tags.get("piste:type"):
        return "ATTRACTION"
    if tags.get("tower:type") == "observation":
        return "ATTRACTION"
    if tags.get("historic") and tags.get("historic") != "no":
        return "ATTRACTION"
    return None


def make_address(tags: dict[str, str]) -> str:
    if tags.get("addr:full"):
        return tags["addr:full"]
    locality = tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village") or ""
    street = tags.get("addr:street", "")
    number = tags.get("addr:housenumber", "")
    return " ".join(value for value in (locality, street, number) if value)


def make_osm_record(external_id: str, tags: dict[str, str], lat: float, lon: float) -> dict[str, Any] | None:
    category = classify(tags)
    name_ja = tags.get("name:ja") or tags.get("name") or ""
    if not category or not name_ja or not in_hokkaido(lat, lon):
        return None
    region_id, distance = nearest_region(lat, lon)
    municipality = tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village") or ""
    return {
        "external_id": external_id,
        "category": category,
        "name_ja": name_ja,
        "name_en": tags.get("name:en", ""),
        "name_ko": tags.get("name:ko", ""),
        "normalized_name": normalize_name(name_ja),
        "municipality_name": municipality,
        "address": make_address(tags),
        "latitude": round(lat, 7),
        "longitude": round(lon, 7),
        "phone": tags.get("contact:phone") or tags.get("phone") or "",
        "website": tags.get("contact:website") or tags.get("website") or "",
        "opening_hours": tags.get("opening_hours", ""),
        "region_id": region_id,
        "region_distance_km": distance,
        "tags_json": json.dumps(compact_tags(tags), ensure_ascii=False, sort_keys=True),
    }


class POIHandler(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.factory = osmium.geom.WKBFactory()
        self.records: list[dict[str, Any]] = []
        self.stats = Counter()

    def node(self, node: osmium.osm.Node) -> None:
        tags = dict(node.tags)
        if not classify(tags):
            return
        self.stats["candidate_nodes"] += 1
        if not node.location.valid():
            self.stats["invalid_node_location"] += 1
            return
        record = make_osm_record(f"node/{node.id}", tags, node.location.lat, node.location.lon)
        if record:
            self.records.append(record)
        else:
            self.stats["filtered_node"] += 1

    def area(self, area: osmium.osm.Area) -> None:
        tags = dict(area.tags)
        if not classify(tags):
            return
        self.stats["candidate_areas"] += 1
        try:
            geometry = wkb.loads(self.factory.create_multipolygon(area), hex=True)
            point = geometry.representative_point()
        except Exception:
            self.stats["invalid_area_geometry"] += 1
            return
        osm_type = "way" if area.from_way() else "relation"
        record = make_osm_record(f"{osm_type}/{area.orig_id()}", tags, point.y, point.x)
        if record:
            self.records.append(record)
        else:
            self.stats["filtered_area"] += 1


def write_csv(path: Path, fieldnames: list[str], rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def prepare_municipal_csv(source: Path, output_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    valid: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    categories = Counter()
    with source.open("r", encoding="cp932", newline="") as handle:
        for row_number, row in enumerate(csv.DictReader(handle), start=2):
            name = (row.get("施設名") or "").strip()
            municipality = (row.get("市町村名") or "").strip()
            try:
                lat = float(row.get("緯度") or "")
                lon = float(row.get("経度") or "")
                coordinate_ok = in_hokkaido(lat, lon)
            except ValueError:
                lat, lon, coordinate_ok = None, None, False
            base = {
                "external_id": "municipal/" + hashlib.sha1(
                    f"{name}|{municipality}|{row.get('緯度')}|{row.get('経度')}|{row.get('原典資料名')}".encode("utf-8")
                ).hexdigest(),
                "name_ja": name,
                "normalized_name": normalize_name(name),
                "municipality_name": municipality,
                "latitude": lat,
                "longitude": lon,
                "source_address": (row.get("住所_出典元") or "").strip(),
                "search_address": (row.get("検索用住所") or "").strip(),
                "building": (row.get("ビル等") or "").strip(),
                "data_type": (row.get("データ区分") or "").strip(),
                "source_name": (row.get("出典") or "").strip(),
                "original_material": (row.get("原典資料名") or "").strip(),
                "row_number": row_number,
            }
            categories[base["data_type"]] += 1
            if coordinate_ok and name and municipality:
                valid.append(base)
            else:
                base["reject_reason"] = "coordinate_outside_hokkaido_or_invalid" if not coordinate_ok else "missing_required_text"
                rejected.append(base)

    write_csv(output_dir / "municipal_facilities_utf8.csv", MUNICIPAL_FIELDS, valid)
    rejected_fields = MUNICIPAL_FIELDS + ["row_number", "reject_reason"]
    write_csv(output_dir / "municipal_facilities_rejected.csv", rejected_fields, rejected)
    profile = {
        "source_encoding": "CP932 (Shift_JIS compatible)",
        "total_rows": len(valid) + len(rejected),
        "valid_rows": len(valid),
        "rejected_rows": len(rejected),
        "rejected_rate": round(len(rejected) / max(1, len(valid) + len(rejected)), 6),
        "distinct_normalized_names": len({row["normalized_name"] for row in valid}),
        "category_counts": dict(categories.most_common()),
    }
    return valid, profile


def extract_osm(source: Path, output_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    reader = osmium.io.Reader(str(source))
    header = reader.header()
    replication_timestamp = header.get("osmosis_replication_timestamp") or ""
    replication_base_url = header.get("osmosis_replication_base_url") or ""
    reader.close()

    handler = POIHandler()
    handler.apply_file(str(source), locations=True, idx="flex_mem")
    handler.records.sort(key=lambda row: (row["category"], row["normalized_name"], row["external_id"]))
    write_csv(output_dir / "osm_pois.csv", OSM_FIELDS, handler.records)
    profile = {
        "replication_timestamp": replication_timestamp,
        "replication_base_url": replication_base_url,
        "extracted_rows": len(handler.records),
        "category_counts": dict(Counter(row["category"] for row in handler.records)),
        "geometry_stats": dict(handler.stats),
    }
    return handler.records, profile


def osm_richness(row: dict[str, Any]) -> int:
    return sum(bool(row.get(field)) for field in ("name_en", "name_ko", "address", "phone", "website", "opening_hours")) + len(row["tags_json"])


def merge_places(
    osm_rows: list[dict[str, Any]], municipal_rows: list[dict[str, Any]], output_dir: Path
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    # Collapse duplicate OSM node/area representations only when the normalized
    # name and category match and coordinates are within 50 metres.
    buckets: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in osm_rows:
        buckets[(row["category"], row["normalized_name"])].append(row)

    canonical: list[dict[str, Any]] = []
    osm_duplicate_count = 0
    for rows in buckets.values():
        groups: list[list[dict[str, Any]]] = []
        for row in sorted(rows, key=osm_richness, reverse=True):
            for group in groups:
                leader = group[0]
                if haversine_km(float(row["latitude"]), float(row["longitude"]), float(leader["latitude"]), float(leader["longitude"])) <= 0.05:
                    group.append(row)
                    osm_duplicate_count += 1
                    break
            else:
                groups.append([row])

        for group in groups:
            leader = max(group, key=osm_richness)
            place_id = stable_id("place", leader["external_id"])
            sources = [
                {
                    "source_code": "OSM",
                    "external_id": item["external_id"],
                    "source_url": f"https://www.openstreetmap.org/{item['external_id']}",
                    "license": "ODbL 1.0",
                    "raw_data": json.loads(item["tags_json"]),
                }
                for item in group
            ]
            canonical.append({
                "id": place_id,
                "region_id": leader["region_id"],
                "category": leader["category"],
                "name_ja": leader["name_ja"],
                "name_en": leader.get("name_en", ""),
                "name_ko": leader.get("name_ko", ""),
                "normalized_name": leader["normalized_name"],
                "municipality_name": leader.get("municipality_name", ""),
                "address": leader.get("address", ""),
                "latitude": leader["latitude"],
                "longitude": leader["longitude"],
                "phone": leader.get("phone", ""),
                "website": leader.get("website", ""),
                "opening_hours": leader.get("opening_hours", ""),
                "osm_tags_json": leader["tags_json"],
                "source_count": len(sources),
                "region_distance_km": leader["region_distance_km"],
                "sources": sources,
            })

    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for place in canonical:
        by_name[place["normalized_name"]].append(place)

    merge_audit: list[dict[str, Any]] = []
    municipal_matches = 0
    ambiguous_matches = 0
    for facility in municipal_rows:
        candidates = []
        for place in by_name.get(facility["normalized_name"], []):
            distance = haversine_km(
                float(facility["latitude"]), float(facility["longitude"]),
                float(place["latitude"]), float(place["longitude"]),
            )
            if distance <= 0.25:
                candidates.append((distance, place))
        if not candidates:
            continue
        candidates.sort(key=lambda item: item[0])
        if len(candidates) > 1 and abs(candidates[0][0] - candidates[1][0]) < 0.02:
            ambiguous_matches += 1
            continue
        distance, place = candidates[0]
        if not place["municipality_name"]:
            place["municipality_name"] = facility["municipality_name"]
        if not place["address"]:
            place["address"] = facility["search_address"] or facility["source_address"]
        place["sources"].append({
            "source_code": "MUNICIPALITY",
            "external_id": facility["external_id"],
            "source_url": "https://www.harp.lg.jp/opendata/dataset/227.html",
            "license": "CC BY",
            "raw_data": {
                "data_type": facility["data_type"],
                "source_name": facility["source_name"],
                "original_material": facility["original_material"],
            },
        })
        place["source_count"] = len(place["sources"])
        merge_audit.append({
            "municipal_external_id": facility["external_id"],
            "place_id": place["id"],
            "distance_m": round(distance * 1000, 2),
            "match_rule": "exact_normalized_name_within_250m",
        })
        municipal_matches += 1

    output_rows = []
    source_rows = []
    for place in canonical:
        output = {**place, "sources_json": json.dumps(place["sources"], ensure_ascii=False, sort_keys=True)}
        output_rows.append(output)
        for source in place["sources"]:
            source_rows.append({"place_id": place["id"], **source})
    output_rows.sort(key=lambda row: (row["region_id"], row["category"], row["name_ja"]))
    write_csv(output_dir / "places_merged.csv", PLACE_FIELDS, output_rows)
    write_csv(
        output_dir / "place_sources.csv",
        ["place_id", "source_code", "external_id", "source_url", "license", "raw_data"],
        ({**row, "raw_data": json.dumps(row["raw_data"], ensure_ascii=False, sort_keys=True)} for row in source_rows),
    )
    write_csv(output_dir / "merge_audit.csv", ["municipal_external_id", "place_id", "distance_m", "match_rule"], merge_audit)
    profile = {
        "canonical_places": len(output_rows),
        "category_counts": dict(Counter(row["category"] for row in output_rows)),
        "region_counts": dict(Counter(row["region_id"] for row in output_rows)),
        "osm_duplicate_rows_collapsed": osm_duplicate_count,
        "municipal_matches": municipal_matches,
        "ambiguous_municipal_matches_skipped": ambiguous_matches,
        "municipal_match_rate": round(municipal_matches / max(1, len(municipal_rows)), 6),
    }
    return output_rows, merge_audit, profile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--municipal-csv", type=Path, default=Path("Hokkaido_OD_GeoDataBase.csv"))
    parser.add_argument("--osm-pbf", type=Path, default=Path("hokkaido-260907.osm.pbf"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/processed"))
    args = parser.parse_args()

    started = datetime.now(timezone.utc)
    municipal_rows, municipal_profile = prepare_municipal_csv(args.municipal_csv, args.output_dir)
    osm_rows, osm_profile = extract_osm(args.osm_pbf, args.output_dir)
    places, merge_audit, merge_profile = merge_places(osm_rows, municipal_rows, args.output_dir)

    quality_report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": round((datetime.now(timezone.utc) - started).total_seconds(), 3),
        "municipal_csv": municipal_profile,
        "osm": osm_profile,
        "merge": merge_profile,
        "quality_decisions": [
            "Municipal CSV decoded as CP932 and exported as UTF-8.",
            "Coordinates outside the Hokkaido bounding box are quarantined, not corrected by guesswork.",
            "Municipal facilities do not create canonical travel places on their own because the source warns that records may be stale.",
            "Municipal data enriches OSM places only on exact normalized-name matches within 250 metres.",
            "OSM node/area duplicates collapse only on exact normalized-name/category matches within 50 metres.",
        ],
        "source_licenses": {
            "OSM": "OpenStreetMap contributors, ODbL 1.0",
            "MUNICIPALITY": "Hokkaido Open Data Portal resource marked CC BY; underlying records include MLIT National Land Numerical Information and municipal open data.",
        },
        "outputs": {
            "municipal_valid": "municipal_facilities_utf8.csv",
            "municipal_rejected": "municipal_facilities_rejected.csv",
            "osm_pois": "osm_pois.csv",
            "places": "places_merged.csv",
            "place_sources": "place_sources.csv",
            "merge_audit": "merge_audit.csv",
        },
    }
    (args.output_dir / "quality_report.json").write_text(
        json.dumps(quality_report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({
        "municipal_valid": len(municipal_rows),
        "municipal_rejected": municipal_profile["rejected_rows"],
        "osm_pois": len(osm_rows),
        "canonical_places": len(places),
        "municipal_matches": len(merge_audit),
        "quality_report": str(args.output_dir / "quality_report.json"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

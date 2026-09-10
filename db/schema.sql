CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS geo_data;

CREATE TABLE IF NOT EXISTS geo_data.import_run (
  id text PRIMARY KEY,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  osm_replication_timestamp timestamptz,
  municipal_row_count integer NOT NULL DEFAULT 0,
  osm_poi_count integer NOT NULL DEFAULT 0,
  canonical_place_count integer NOT NULL DEFAULT 0,
  municipal_match_count integer NOT NULL DEFAULT 0,
  quality_report jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS geo_data.data_source (
  code text PRIMARY KEY,
  source_name text NOT NULL,
  source_url text NOT NULL,
  license text NOT NULL,
  attribution text NOT NULL,
  snapshot_at timestamptz
);

CREATE TABLE IF NOT EXISTS geo_data.municipal_facility (
  external_id text PRIMARY KEY,
  name_ja text NOT NULL,
  normalized_name text NOT NULL,
  municipality_name text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  location geography(Point, 4326) NOT NULL,
  source_address text,
  search_address text,
  building text,
  data_type text NOT NULL,
  source_name text NOT NULL,
  original_material text,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS municipal_facility_location_gix
  ON geo_data.municipal_facility USING gist (location);
CREATE INDEX IF NOT EXISTS municipal_facility_normalized_name_idx
  ON geo_data.municipal_facility (normalized_name);

CREATE TABLE IF NOT EXISTS geo_data.place (
  id text PRIMARY KEY,
  region_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('ATTRACTION', 'RESTAURANT', 'LODGING')),
  name_ja text NOT NULL,
  name_en text,
  name_ko text,
  normalized_name text NOT NULL,
  municipality_name text,
  address text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  location geography(Point, 4326) NOT NULL,
  phone text,
  website text,
  opening_hours text,
  osm_tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_count integer NOT NULL DEFAULT 1,
  region_distance_km double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS place_location_gix
  ON geo_data.place USING gist (location);
CREATE INDEX IF NOT EXISTS place_region_category_idx
  ON geo_data.place (region_id, category);
CREATE INDEX IF NOT EXISTS place_normalized_name_idx
  ON geo_data.place (normalized_name);

CREATE TABLE IF NOT EXISTS geo_data.place_source (
  source_code text NOT NULL REFERENCES geo_data.data_source(code),
  external_id text NOT NULL,
  place_id text NOT NULL REFERENCES geo_data.place(id) ON DELETE CASCADE,
  source_url text,
  license text NOT NULL,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_code, external_id)
);

CREATE INDEX IF NOT EXISTS place_source_place_id_idx
  ON geo_data.place_source (place_id);

CREATE TABLE IF NOT EXISTS geo_data.merge_audit (
  municipal_external_id text PRIMARY KEY,
  place_id text NOT NULL REFERENCES geo_data.place(id) ON DELETE CASCADE,
  distance_m double precision NOT NULL,
  match_rule text NOT NULL,
  matched_at timestamptz NOT NULL DEFAULT now()
);

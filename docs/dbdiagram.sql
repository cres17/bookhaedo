-- Book해도. ERD visualization SQL
-- dbdiagram.io > Import > PostgreSQL 에 이 파일 전체를 붙여 넣으세요.
-- 시각화 전용이며 실제 마이그레이션은 db/schema.sql + db/planner.sql + db/admin.sql 입니다.

CREATE SCHEMA geo_data;
CREATE SCHEMA planner;

CREATE TABLE geo_data.import_run (
  id text PRIMARY KEY,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  osm_replication_timestamp timestamptz,
  municipal_row_count integer NOT NULL DEFAULT 0,
  osm_poi_count integer NOT NULL DEFAULT 0,
  canonical_place_count integer NOT NULL DEFAULT 0,
  municipal_match_count integer NOT NULL DEFAULT 0,
  quality_report jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE geo_data.data_source (
  code text PRIMARY KEY,
  source_name text NOT NULL,
  source_url text NOT NULL,
  license text NOT NULL,
  attribution text NOT NULL,
  snapshot_at timestamptz
);

CREATE TABLE geo_data.municipal_facility (
  external_id text PRIMARY KEY,
  name_ja text NOT NULL,
  normalized_name text NOT NULL,
  municipality_name text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  location geography NOT NULL,
  source_address text,
  search_address text,
  building text,
  data_type text NOT NULL,
  source_name text NOT NULL,
  original_material text,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE geo_data.place (
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
  location geography NOT NULL,
  phone text,
  website text,
  opening_hours text,
  osm_tags jsonb NOT NULL DEFAULT '{}',
  source_count integer NOT NULL DEFAULT 1,
  region_distance_km double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE geo_data.place_source (
  source_code text NOT NULL,
  external_id text NOT NULL,
  place_id text NOT NULL,
  source_url text,
  license text NOT NULL,
  raw_data jsonb NOT NULL DEFAULT '{}',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_code, external_id),
  CONSTRAINT fk_place_source_source FOREIGN KEY (source_code) REFERENCES geo_data.data_source(code),
  CONSTRAINT fk_place_source_place FOREIGN KEY (place_id) REFERENCES geo_data.place(id) ON DELETE CASCADE
);

CREATE TABLE geo_data.merge_audit (
  municipal_external_id text PRIMARY KEY,
  place_id text NOT NULL,
  distance_m double precision NOT NULL,
  match_rule text NOT NULL,
  matched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_merge_place FOREIGN KEY (place_id) REFERENCES geo_data.place(id) ON DELETE CASCADE
);

CREATE TABLE planner.app_user (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER', 'ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE planner.session (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES planner.app_user(id) ON DELETE CASCADE
);

CREATE TABLE planner.trip (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  transport_mode text NOT NULL DEFAULT 'DRIVE'
    CHECK (transport_mode IN ('DRIVE', 'TAXI', 'TRANSIT', 'WALK', 'BICYCLE')),
  cost_settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_trip_user FOREIGN KEY (user_id) REFERENCES planner.app_user(id) ON DELETE CASCADE
);

CREATE TABLE planner.trip_day (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL,
  visit_date date NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  CONSTRAINT uq_trip_day UNIQUE (trip_id, visit_date),
  CONSTRAINT fk_day_trip FOREIGN KEY (trip_id) REFERENCES planner.trip(id) ON DELETE CASCADE
);

CREATE TABLE planner.itinerary_item (
  id uuid PRIMARY KEY,
  day_id uuid NOT NULL,
  place_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  note text NOT NULL DEFAULT '',
  CONSTRAINT uq_day_position UNIQUE (day_id, position),
  CONSTRAINT uq_day_place UNIQUE (day_id, place_id),
  CONSTRAINT fk_item_day FOREIGN KEY (day_id) REFERENCES planner.trip_day(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_place FOREIGN KEY (place_id) REFERENCES geo_data.place(id)
);

CREATE TABLE planner.google_place_link (
  place_id text PRIMARY KEY,
  google_place_id text NOT NULL,
  matched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_google_place FOREIGN KEY (place_id) REFERENCES geo_data.place(id)
);

CREATE TABLE planner.review_import (
  id uuid PRIMARY KEY,
  place_id text NOT NULL,
  provider_run_id text UNIQUE,
  google_place_id text NOT NULL,
  coverage_start date NOT NULL,
  coverage_end date NOT NULL,
  complete boolean NOT NULL DEFAULT false,
  received_count integer NOT NULL,
  accepted_count integer NOT NULL,
  rejected_count integer NOT NULL,
  duplicate_count integer NOT NULL,
  reason text NOT NULL,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_review_coverage CHECK (coverage_end >= coverage_start),
  CONSTRAINT fk_review_import_place FOREIGN KEY (place_id) REFERENCES geo_data.place(id)
);

CREATE TABLE planner.place_review_stats (
  place_id text NOT NULL,
  import_id uuid NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('WEEK', 'MONTH')),
  period_start date NOT NULL,
  review_count integer NOT NULL CHECK (review_count >= 0),
  average_rating numeric,
  previous_review_count integer,
  growth_rate numeric,
  complete boolean NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (import_id, period_type, period_start),
  CONSTRAINT fk_stats_place FOREIGN KEY (place_id) REFERENCES geo_data.place(id),
  CONSTRAINT fk_stats_import FOREIGN KEY (import_id) REFERENCES planner.review_import(id) ON DELETE CASCADE
);

CREATE TABLE planner.place_review_trend (
  place_id text PRIMARY KEY,
  import_id uuid NOT NULL,
  trend_type text NOT NULL,
  recent_review_count integer NOT NULL,
  previous_review_count integer NOT NULL,
  growth_rate numeric,
  seasonal_patterns jsonb NOT NULL DEFAULT '[]',
  quality jsonb NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_trend_place FOREIGN KEY (place_id) REFERENCES geo_data.place(id),
  CONSTRAINT fk_trend_import FOREIGN KEY (import_id) REFERENCES planner.review_import(id)
);

CREATE INDEX idx_place_region_category ON geo_data.place(region_id, category);
CREATE INDEX idx_place_source_place ON geo_data.place_source(place_id);
CREATE INDEX idx_trip_user ON planner.trip(user_id);
CREATE INDEX idx_session_user ON planner.session(user_id);
CREATE INDEX idx_review_stats_place_period ON planner.place_review_stats(place_id, period_type, period_start);

CREATE TABLE planner.admin_audit (
 id uuid PRIMARY KEY,
 actor_id uuid REFERENCES planner.app_user(id) ON DELETE SET NULL,
 target_id uuid REFERENCES planner.app_user(id) ON DELETE SET NULL,
 before_state jsonb NOT NULL,
 after_state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

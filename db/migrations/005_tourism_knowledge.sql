-- Additive knowledge storage; catalog and itinerary data are preserved.
CREATE SCHEMA IF NOT EXISTS tourism_knowledge;
CREATE TABLE tourism_knowledge.source (
  id text PRIMARY KEY,
  publisher text NOT NULL,
  source_url text NOT NULL,
  license_id text NOT NULL,
  license_url text NOT NULL,
  rights_status text NOT NULL CHECK (rights_status IN ('approved','permission_pending','withdrawn')),
  enabled boolean NOT NULL DEFAULT false,
  active_snapshot_id uuid
);
CREATE TABLE tourism_knowledge.snapshot (
  id uuid PRIMARY KEY,
  source_id text NOT NULL REFERENCES tourism_knowledge.source(id),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  parser_version text NOT NULL,
  fetched_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  record_count integer NOT NULL CHECK (record_count > 0),
  UNIQUE (source_id, id)
);
ALTER TABLE tourism_knowledge.source ADD FOREIGN KEY (id,active_snapshot_id)
  REFERENCES tourism_knowledge.snapshot(source_id,id);
CREATE TABLE tourism_knowledge.record (
  snapshot_id uuid NOT NULL REFERENCES tourism_knowledge.snapshot(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('place','event')),
  region_id text NOT NULL,
  canonical_place_id text REFERENCES geo_data.place(id) ON DELETE SET NULL,
  title_ja text NOT NULL,
  description_ja text NOT NULL,
  resource_url text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  source_updated_at timestamptz,
  evidence_pointer text NOT NULL,
  latitude double precision,
  longitude double precision,
  location_status text NOT NULL CHECK (location_status IN ('provided','missing')),
  start_date date,
  end_date date,
  timezone text NOT NULL DEFAULT 'Asia/Tokyo' CHECK (timezone='Asia/Tokyo'),
  date_status text NOT NULL CHECK (date_status IN ('confirmed','tentative','recurring','unknown')),
  schedule_raw text NOT NULL DEFAULT '',
  hours_status text NOT NULL CHECK (hours_status IN ('historical','unknown')),
  valid_from date,
  valid_until date,
  withdrawn_at timestamptz,
  search_text tsvector GENERATED ALWAYS AS
    (to_tsvector('simple',title_ja || ' ' || description_ja)) STORED,
  PRIMARY KEY (snapshot_id,external_id),
  CHECK ((latitude IS NULL AND longitude IS NULL AND location_status='missing') OR
    (latitude BETWEEN 41 AND 46.1 AND longitude BETWEEN 137 AND 147 AND location_status='provided')),
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date<=end_date),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from<=valid_until),
  CHECK (kind<>'event' OR date_status<>'confirmed' OR (start_date IS NOT NULL AND end_date IS NOT NULL))
);
CREATE INDEX tourism_record_search_idx ON tourism_knowledge.record USING gin(search_text);
CREATE INDEX tourism_record_place_idx ON tourism_knowledge.record(canonical_place_id);
CREATE INDEX tourism_record_dates_idx ON tourism_knowledge.record(region_id,start_date,end_date);

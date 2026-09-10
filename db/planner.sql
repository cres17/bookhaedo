CREATE SCHEMA IF NOT EXISTS planner;
CREATE TABLE IF NOT EXISTS planner.app_user (
 id uuid PRIMARY KEY,
 email text NOT NULL UNIQUE,
 display_name text NOT NULL,
 password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS planner.session (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES planner.app_user(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_user_idx ON planner.session(user_id);
CREATE TABLE IF NOT EXISTS planner.trip (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES planner.app_user(id) ON DELETE CASCADE,
 title text NOT NULL,
 transport_mode text NOT NULL DEFAULT 'DRIVE' CHECK (transport_mode IN ('DRIVE','WALK','TRANSIT')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_user_idx ON planner.trip(user_id);
CREATE TABLE IF NOT EXISTS planner.trip_day (
 id uuid PRIMARY KEY,
 trip_id uuid NOT NULL REFERENCES planner.trip(id) ON DELETE CASCADE,
 visit_date date NOT NULL,
 UNIQUE(trip_id, visit_date)
);
CREATE TABLE IF NOT EXISTS planner.itinerary_item (
 id uuid PRIMARY KEY,
 day_id uuid NOT NULL REFERENCES planner.trip_day(id) ON DELETE CASCADE,
 place_id text NOT NULL REFERENCES geo_data.place(id),
 position integer NOT NULL CHECK (position >= 0),
 UNIQUE(day_id, position),
 UNIQUE(day_id, place_id)
);
-- Preserve existing trips and allow the expanded transport selection.
ALTER TABLE planner.trip DROP CONSTRAINT IF EXISTS trip_transport_mode_check;
ALTER TABLE planner.trip ADD CONSTRAINT trip_transport_mode_check CHECK (transport_mode IN ('DRIVE','TAXI','TRANSIT','WALK','BICYCLE'));
ALTER TABLE planner.trip ADD COLUMN IF NOT EXISTS cost_settings jsonb NOT NULL DEFAULT '{}';
ALTER TABLE planner.itinerary_item ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
ALTER TABLE planner.trip_day ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0);
CREATE TABLE IF NOT EXISTS planner.google_place_link (
 place_id text PRIMARY KEY REFERENCES geo_data.place(id),
 google_place_id text NOT NULL,
 matched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS planner.review_import (
 id uuid PRIMARY KEY,
 place_id text NOT NULL REFERENCES geo_data.place(id),
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
 CHECK (coverage_end >= coverage_start)
);
CREATE TABLE IF NOT EXISTS planner.place_review_stats (
 place_id text NOT NULL REFERENCES geo_data.place(id),
 import_id uuid NOT NULL REFERENCES planner.review_import(id) ON DELETE CASCADE,
 period_type text NOT NULL CHECK (period_type IN ('WEEK','MONTH')),
 period_start date NOT NULL,
 review_count integer NOT NULL CHECK (review_count >= 0),
 average_rating numeric,
 previous_review_count integer,
 growth_rate numeric,
 complete boolean NOT NULL,
 calculated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(import_id,period_type,period_start)
);
CREATE INDEX IF NOT EXISTS review_stats_place_idx ON planner.place_review_stats(place_id,period_type,period_start);
CREATE TABLE IF NOT EXISTS planner.place_review_trend (
 place_id text PRIMARY KEY REFERENCES geo_data.place(id),
 import_id uuid NOT NULL REFERENCES planner.review_import(id),
 trend_type text NOT NULL,
 recent_review_count integer NOT NULL,
 previous_review_count integer NOT NULL,
 growth_rate numeric,
 seasonal_patterns jsonb NOT NULL DEFAULT '[]',
 quality jsonb NOT NULL,
 calculated_at timestamptz NOT NULL DEFAULT now()
);

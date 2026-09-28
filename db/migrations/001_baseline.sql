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

-- Optional fixed visit times; NULL uses the calendar's suggested placement.
ALTER TABLE planner.itinerary_item ADD COLUMN IF NOT EXISTS start_minute integer CHECK (start_minute BETWEEN 0 AND 1439);
ALTER TABLE planner.itinerary_item ADD COLUMN IF NOT EXISTS end_minute integer CHECK (end_minute BETWEEN 1 AND 1440);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='itinerary_time_range' AND conrelid='planner.itinerary_item'::regclass) THEN
    ALTER TABLE planner.itinerary_item ADD CONSTRAINT itinerary_time_range CHECK ((start_minute IS NULL AND end_minute IS NULL) OR (start_minute IS NOT NULL AND end_minute IS NOT NULL AND end_minute > start_minute));
  END IF;
END $$;
ALTER TABLE planner.app_user ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'MEMBER' CHECK(role IN ('MEMBER','ADMIN'));
ALTER TABLE planner.app_user ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED'));
CREATE TABLE IF NOT EXISTS planner.admin_audit (
 id uuid PRIMARY KEY,
 actor_id uuid REFERENCES planner.app_user(id) ON DELETE SET NULL,
 target_id uuid REFERENCES planner.app_user(id) ON DELETE SET NULL,
 before_state jsonb NOT NULL,
 after_state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS planner.trip_member (
 trip_id uuid NOT NULL REFERENCES planner.trip(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES planner.app_user(id) ON DELETE CASCADE,
 joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(trip_id,user_id)
);
CREATE TABLE IF NOT EXISTS planner.trip_invitation (
 id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES planner.trip(id) ON DELETE CASCADE,
 sender_id uuid REFERENCES planner.app_user(id) ON DELETE SET NULL,
 email text, token_hash text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','REVOKED')),
 accepted_by uuid REFERENCES planner.app_user(id) ON DELETE SET NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invitation_pending_email ON planner.trip_invitation(trip_id,email) WHERE status='PENDING' AND email IS NOT NULL;
CREATE TABLE IF NOT EXISTS planner.notification (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES planner.app_user(id) ON DELETE CASCADE,
 trip_id uuid REFERENCES planner.trip(id) ON DELETE CASCADE,
 message text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_user ON planner.notification(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS planner.checklist_item (
 id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES planner.trip(id) ON DELETE CASCADE,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200), done boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS planner.trip_message (
 id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES planner.trip(id) ON DELETE CASCADE,
 user_id uuid REFERENCES planner.app_user(id) ON DELETE SET NULL,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_trip ON planner.trip_message(trip_id,created_at DESC);
CREATE TABLE IF NOT EXISTS planner.expense (
 id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES planner.trip(id) ON DELETE CASCADE,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 amount integer NOT NULL CHECK(amount > 0 AND amount <= 100000000),
 payer_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS planner.expense_share (
 expense_id uuid NOT NULL REFERENCES planner.expense(id) ON DELETE CASCADE,
 participant_id uuid NOT NULL, amount integer NOT NULL CHECK(amount>=0),
 PRIMARY KEY(expense_id,participant_id)
);
-- Participant IDs remain as settlement evidence after account deletion; no profile data stored.
ALTER TABLE planner.itinerary_item ADD COLUMN IF NOT EXISTS estimated_cost integer CHECK(estimated_cost>=0 AND estimated_cost<=100000000);

-- Personal spending is visible only to its author and is excluded from shared settlement.
ALTER TABLE planner.expense ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'SHARED' CHECK(scope IN ('SHARED','PERSONAL'));
ALTER TABLE planner.expense ADD COLUMN IF NOT EXISTS personal_owner_id uuid REFERENCES planner.app_user(id) ON DELETE CASCADE;
ALTER TABLE planner.expense ADD COLUMN IF NOT EXISTS place_id text;
ALTER TABLE planner.expense ADD COLUMN IF NOT EXISTS visit_date date;
ALTER TABLE planner.expense ADD COLUMN IF NOT EXISTS place_name text;
ALTER TABLE planner.expense ADD COLUMN IF NOT EXISTS estimated_cost integer CHECK(estimated_cost BETWEEN 0 AND 100000000);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='expense_scope_owner' AND conrelid='planner.expense'::regclass) THEN
  ALTER TABLE planner.expense ADD CONSTRAINT expense_scope_owner CHECK((scope='SHARED' AND personal_owner_id IS NULL) OR (scope='PERSONAL' AND personal_owner_id IS NOT NULL AND payer_id=personal_owner_id));
 END IF;
END $$;

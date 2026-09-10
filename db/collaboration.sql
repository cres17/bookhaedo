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

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

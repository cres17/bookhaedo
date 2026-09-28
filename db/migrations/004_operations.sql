-- Shared fixed-window counters allow every API instance to enforce one limit.
-- Keys are SHA-256 digests; raw IP addresses and user IDs are not retained here.
CREATE TABLE IF NOT EXISTS planner.rate_limit_bucket (
 namespace text NOT NULL,
 key_hash text NOT NULL CHECK(length(key_hash)=64),
 hits integer NOT NULL CHECK(hits>=0),
 reset_at timestamptz NOT NULL,
 PRIMARY KEY(namespace,key_hash)
);
CREATE INDEX IF NOT EXISTS rate_limit_expiry_idx ON planner.rate_limit_bucket(reset_at);

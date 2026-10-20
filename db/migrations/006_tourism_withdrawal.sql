-- Withdrawal follows source + stable external ID, independently of snapshot retention.
CREATE TABLE tourism_knowledge.withdrawal (
  source_id text NOT NULL REFERENCES tourism_knowledge.source(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  withdrawn_at timestamptz NOT NULL,
  PRIMARY KEY (source_id, external_id)
);
INSERT INTO tourism_knowledge.withdrawal(source_id,external_id,withdrawn_at)
SELECT v.source_id,r.external_id,min(r.withdrawn_at)
FROM tourism_knowledge.record r JOIN tourism_knowledge.snapshot v ON v.id=r.snapshot_id
WHERE r.withdrawn_at IS NOT NULL GROUP BY v.source_id,r.external_id;

CREATE FUNCTION tourism_knowledge.remember_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_key text; active_id uuid;
BEGIN
  -- The nested update only copies the existing withdrawal into the current version.
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  SELECT s.id,s.active_snapshot_id INTO source_key,active_id
  FROM tourism_knowledge.source s JOIN tourism_knowledge.snapshot v ON v.source_id=s.id
  WHERE v.id=NEW.snapshot_id FOR UPDATE OF s;
  INSERT INTO tourism_knowledge.withdrawal(source_id,external_id,withdrawn_at)
  VALUES(source_key,NEW.external_id,NEW.withdrawn_at)
  ON CONFLICT(source_id,external_id) DO UPDATE
  SET withdrawn_at=LEAST(tourism_knowledge.withdrawal.withdrawn_at,EXCLUDED.withdrawn_at);
  -- A direct SQL withdrawal might have waited while publication activated a new version.
  UPDATE tourism_knowledge.record SET withdrawn_at=NEW.withdrawn_at
  WHERE snapshot_id=active_id AND external_id=NEW.external_id AND withdrawn_at IS NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tourism_record_withdrawal
AFTER UPDATE OF withdrawn_at ON tourism_knowledge.record
FOR EACH ROW WHEN (NEW.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at)
EXECUTE FUNCTION tourism_knowledge.remember_withdrawal();

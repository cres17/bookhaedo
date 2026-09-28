-- Preserve catalog and historical participant UUIDs. Index referencing columns for deletion/access.
CREATE INDEX IF NOT EXISTS trip_member_user_idx ON planner.trip_member(user_id);
CREATE INDEX IF NOT EXISTS expense_trip_idx ON planner.expense(trip_id);
CREATE INDEX IF NOT EXISTS expense_owner_idx ON planner.expense(personal_owner_id);
CREATE INDEX IF NOT EXISTS checklist_trip_idx ON planner.checklist_item(trip_id);
CREATE INDEX IF NOT EXISTS itinerary_place_idx ON planner.itinerary_item(place_id);
CREATE INDEX IF NOT EXISTS session_expiry_idx ON planner.session(expires_at);

-- Validate final transaction state so replacing all shares remains atomic.
CREATE FUNCTION planner.check_expense_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; e planner.expense%ROWTYPE; total bigint;
BEGIN
 IF TG_TABLE_NAME='expense' THEN target := COALESCE(NEW.id, OLD.id);
 ELSE target := COALESCE(NEW.expense_id, OLD.expense_id); END IF;
 SELECT * INTO e FROM planner.expense WHERE id=target FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT COALESCE(sum(amount),0) INTO total FROM planner.expense_share WHERE expense_id=target;
 IF total <> e.amount OR (e.scope='PERSONAL' AND EXISTS (
   SELECT 1 FROM planner.expense_share WHERE expense_id=target AND participant_id<>e.personal_owner_id
 )) THEN RAISE EXCEPTION 'Expense shares must match expense' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='expense_share' AND TG_OP='UPDATE' AND OLD.expense_id<>NEW.expense_id THEN
   RAISE EXCEPTION 'Share parent is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM planner.expense e WHERE e.amount<>(SELECT COALESCE(sum(s.amount),0) FROM planner.expense_share s WHERE s.expense_id=e.id)
 OR (e.scope='PERSONAL' AND EXISTS(SELECT 1 FROM planner.expense_share s WHERE s.expense_id=e.id AND s.participant_id<>e.personal_owner_id)))
 THEN RAISE EXCEPTION 'Existing expense balance requires repair' USING ERRCODE='23514'; END IF;
END $$;
CREATE CONSTRAINT TRIGGER expense_balance AFTER INSERT OR UPDATE ON planner.expense
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION planner.check_expense_balance();
CREATE CONSTRAINT TRIGGER expense_share_balance AFTER INSERT OR UPDATE OR DELETE ON planner.expense_share
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION planner.check_expense_balance();

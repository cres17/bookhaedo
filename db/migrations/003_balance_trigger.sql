-- Branch on the trigger table before referencing its record fields.
CREATE OR REPLACE FUNCTION planner.check_expense_balance() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF TG_TABLE_NAME='expense_share' THEN
   IF TG_OP='UPDATE' THEN
     IF OLD.expense_id<>NEW.expense_id THEN
       RAISE EXCEPTION 'Share parent is immutable' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 RETURN NULL;
END $$;

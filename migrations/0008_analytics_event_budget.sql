-- Keep historical budgets up to 4000 readable; only new intake uses the lower Free quota.
ALTER TABLE day_budget ADD COLUMN ingest_checks INTEGER NOT NULL DEFAULT 0 CHECK(ingest_checks BETWEEN 0 AND 4000);
DROP TRIGGER IF EXISTS events_budget;
CREATE TRIGGER events_budget BEFORE INSERT ON events
WHEN (SELECT accepted FROM day_budget WHERE day = NEW.utc_day) >= 2000
  AND NOT EXISTS(SELECT 1 FROM events WHERE id = NEW.id)
BEGIN
  SELECT RAISE(IGNORE);
END;

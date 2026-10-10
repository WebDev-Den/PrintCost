ALTER TABLE import_daily ADD COLUMN history_delete_attempts INTEGER NOT NULL DEFAULT 0 CHECK(history_delete_attempts BETWEEN 0 AND 200);
ALTER TABLE import_daily ADD COLUMN cleanup_claimed INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_claimed BETWEEN 0 AND 1);
CREATE INDEX import_keys_expiry ON import_keys(expires_at);
CREATE INDEX import_limits_expiry ON import_limits(next_allowed);
-- Reinstall for databases that applied 0007 before the pending-index hint.
DROP TRIGGER import_job_guard;
CREATE TRIGGER import_job_guard BEFORE INSERT ON import_jobs BEGIN
  SELECT RAISE(ABORT,'IMPORT_KEY_CHANGED') WHERE NOT EXISTS (SELECT 1 FROM import_keys WHERE uid=NEW.owner_uid AND hash=NEW.key_hash
    AND fingerprint=NEW.fingerprint AND expires_at>NEW.created_at);
  SELECT RAISE(ABORT,'IMPORT_COOLDOWN') WHERE EXISTS (SELECT 1 FROM import_limits WHERE uid=NEW.owner_uid AND next_allowed>NEW.created_at);
  SELECT RAISE(ABORT,'IMPORT_ACTIVE') WHERE EXISTS (SELECT 1 FROM import_jobs INDEXED BY import_jobs_pending WHERE owner_uid=NEW.owner_uid AND status IN ('queued','processing'));
  SELECT RAISE(ABORT,'IMPORT_BUSY') WHERE (SELECT COUNT(*) FROM import_jobs WHERE status IN ('queued','processing'))>=100;
  SELECT RAISE(ABORT,'IMPORT_BUDGET') WHERE EXISTS (SELECT 1 FROM import_daily WHERE day=date(NEW.created_at,'unixepoch') AND
    (items+NEW.total>2500 OR jobs>=100));
END;

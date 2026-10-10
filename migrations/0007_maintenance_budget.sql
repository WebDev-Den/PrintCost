ALTER TABLE import_daily ADD COLUMN maintenance_dispatches INTEGER NOT NULL DEFAULT 0 CHECK(maintenance_dispatches BETWEEN 0 AND 300);
ALTER TABLE import_daily ADD COLUMN admin_preflight_checks INTEGER NOT NULL DEFAULT 0 CHECK(admin_preflight_checks BETWEEN 0 AND 500);
ALTER TABLE import_daily ADD COLUMN manager_preflight_checks INTEGER NOT NULL DEFAULT 0 CHECK(manager_preflight_checks BETWEEN 0 AND 500);
ALTER TABLE import_daily ADD COLUMN unknown_preflight_checks INTEGER NOT NULL DEFAULT 0 CHECK(unknown_preflight_checks BETWEEN 0 AND 100);
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

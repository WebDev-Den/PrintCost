CREATE TABLE IF NOT EXISTS import_keys (
  uid TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','manager')), company_id TEXT,
  fingerprint TEXT NOT NULL, valid_since INTEGER NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS import_limits (uid TEXT PRIMARY KEY, next_allowed INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS import_daily (
  day TEXT PRIMARY KEY, items INTEGER NOT NULL DEFAULT 0,
  jobs INTEGER NOT NULL DEFAULT 0, access_checks INTEGER NOT NULL DEFAULT 0, dispatches INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, key_hash TEXT NOT NULL, fingerprint TEXT NOT NULL,
  idempotency TEXT NOT NULL, payload_hash TEXT NOT NULL, payload TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','completed','partial','failed','cancelled')),
  total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 100), cursor INTEGER NOT NULL DEFAULT 0,
  results TEXT NOT NULL DEFAULT '[]', interval_seconds INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, dispatch_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
  UNIQUE(owner_uid,idempotency)
);
CREATE INDEX IF NOT EXISTS import_jobs_owner ON import_jobs(owner_uid,created_at DESC);
CREATE INDEX IF NOT EXISTS import_jobs_pending ON import_jobs(status,dispatch_at);
CREATE INDEX IF NOT EXISTS import_jobs_retention ON import_jobs(created_at);
CREATE TRIGGER IF NOT EXISTS import_job_guard BEFORE INSERT ON import_jobs BEGIN
  SELECT RAISE(ABORT,'IMPORT_KEY_CHANGED') WHERE NOT EXISTS (SELECT 1 FROM import_keys WHERE uid=NEW.owner_uid AND hash=NEW.key_hash
    AND fingerprint=NEW.fingerprint AND expires_at>NEW.created_at);
  SELECT RAISE(ABORT,'IMPORT_COOLDOWN') WHERE EXISTS (SELECT 1 FROM import_limits WHERE uid=NEW.owner_uid AND next_allowed>NEW.created_at);
  SELECT RAISE(ABORT,'IMPORT_ACTIVE') WHERE EXISTS (SELECT 1 FROM import_jobs WHERE owner_uid=NEW.owner_uid AND status IN ('queued','processing'));
  SELECT RAISE(ABORT,'IMPORT_BUSY') WHERE (SELECT COUNT(*) FROM import_jobs WHERE status IN ('queued','processing'))>=100;
  SELECT RAISE(ABORT,'IMPORT_BUDGET') WHERE EXISTS (SELECT 1 FROM import_daily WHERE day=date(NEW.created_at,'unixepoch') AND
    (items+NEW.total>5000 OR jobs>=100));
END;
CREATE TRIGGER IF NOT EXISTS import_job_reserved AFTER INSERT ON import_jobs BEGIN
  INSERT INTO import_limits(uid,next_allowed) VALUES(NEW.owner_uid,NEW.created_at+NEW.interval_seconds)
    ON CONFLICT(uid) DO UPDATE SET next_allowed=excluded.next_allowed;
  INSERT INTO import_daily(day,items,jobs) VALUES(date(NEW.created_at,'unixepoch'),NEW.total,1)
    ON CONFLICT(day) DO UPDATE SET items=items+NEW.total,jobs=jobs+1;
END;

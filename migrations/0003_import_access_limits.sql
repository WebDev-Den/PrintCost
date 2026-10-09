ALTER TABLE import_daily ADD COLUMN admin_access_checks INTEGER NOT NULL DEFAULT 0 CHECK(admin_access_checks>=0);
CREATE TABLE IF NOT EXISTS import_access_daily (
  day TEXT NOT NULL, uid TEXT NOT NULL, checks INTEGER NOT NULL DEFAULT 0 CHECK(checks>=0),
  limit_checks INTEGER NOT NULL CHECK(limit_checks>0),
  PRIMARY KEY(day,uid)
);

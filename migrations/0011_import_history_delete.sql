ALTER TABLE import_jobs ADD COLUMN history_deleted INTEGER NOT NULL DEFAULT 0 CHECK(history_deleted IN (0,1));
CREATE INDEX import_jobs_visible_owner ON import_jobs(owner_uid,created_at DESC) WHERE history_deleted=0;
CREATE INDEX import_jobs_visible_created ON import_jobs(created_at DESC) WHERE history_deleted=0;

ALTER TABLE import_jobs ADD COLUMN succeeded INTEGER NOT NULL DEFAULT 0 CHECK(succeeded>=0);
ALTER TABLE import_jobs ADD COLUMN failed INTEGER NOT NULL DEFAULT 0 CHECK(failed>=0);
UPDATE import_jobs SET (succeeded,failed) = (
  SELECT COUNT(CASE WHEN json_extract(r.value,'$.success') THEN 1 END),
    COUNT(CASE WHEN NOT COALESCE(json_extract(r.value,'$.success'),0) THEN 1 END)
  FROM json_each(import_jobs.results) r
);
CREATE TRIGGER import_job_result_counts_insert AFTER INSERT ON import_jobs WHEN NEW.results<>'[]' BEGIN
  UPDATE import_jobs SET (succeeded,failed) = (
    SELECT COUNT(CASE WHEN json_extract(r.value,'$.success') THEN 1 END),
      COUNT(CASE WHEN NOT COALESCE(json_extract(r.value,'$.success'),0) THEN 1 END)
    FROM json_each(NEW.results) r
  ) WHERE id=NEW.id;
END;
CREATE TRIGGER import_job_result_counts_update AFTER UPDATE OF results ON import_jobs WHEN NEW.results IS NOT OLD.results BEGIN
  UPDATE import_jobs SET (succeeded,failed) = (
    SELECT COUNT(CASE WHEN json_extract(r.value,'$.success') THEN 1 END),
      COUNT(CASE WHEN NOT COALESCE(json_extract(r.value,'$.success'),0) THEN 1 END)
    FROM json_each(NEW.results) r
  ) WHERE id=NEW.id;
END;

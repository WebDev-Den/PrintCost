CREATE TABLE analytics_report_budget (
  day TEXT PRIMARY KEY,
  checks INTEGER NOT NULL DEFAULT 0 CHECK(checks BETWEEN 0 AND 1500),
  reserved_reads INTEGER NOT NULL DEFAULT 0 CHECK(reserved_reads BETWEEN 0 AND 1000000)
) WITHOUT ROWID;

-- Legacy maintenance rows represent completed daily cleanups.
-- New incomplete rows retain the raw-delete progress until rollup cleanup commits.
ALTER TABLE maintenance ADD COLUMN complete INTEGER NOT NULL DEFAULT 1 CHECK(complete IN(0,1));

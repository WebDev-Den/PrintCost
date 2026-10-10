CREATE TABLE catalog_seo_daily (
  day TEXT PRIMARY KEY,
  queries INTEGER NOT NULL DEFAULT 0,
  reserved_reads INTEGER NOT NULL DEFAULT 0
);

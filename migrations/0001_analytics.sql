-- WITHOUT ROWID avoids a second implicit index write for each text primary key.
CREATE TABLE events (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  day TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('search','filter','no_results','impression','details','seller_click','add_material')),
  company_id TEXT NOT NULL DEFAULT '',
  offer_id TEXT NOT NULL DEFAULT '',
  offer_name TEXT NOT NULL DEFAULT '' CHECK(length(offer_name) <= 400),
  material_type TEXT NOT NULL DEFAULT 'all',
  packaging TEXT NOT NULL DEFAULT 'all',
  stock TEXT NOT NULL DEFAULT 'all',
  has_search INTEGER NOT NULL CHECK(has_search IN (0,1)),
  result_count INTEGER CHECK(result_count BETWEEN 0 AND 100000)
) WITHOUT ROWID;
CREATE INDEX events_retention ON events(utc_day);

CREATE TABLE day_budget (
  day TEXT PRIMARY KEY,
  accepted INTEGER NOT NULL CHECK(accepted BETWEEN 0 AND 4000)
) WITHOUT ROWID;

CREATE TABLE daily_totals (
  company_id TEXT NOT NULL,
  day TEXT NOT NULL,
  search INTEGER NOT NULL DEFAULT 0,
  filter INTEGER NOT NULL DEFAULT 0,
  no_results INTEGER NOT NULL DEFAULT 0,
  impression INTEGER NOT NULL DEFAULT 0,
  details INTEGER NOT NULL DEFAULT 0,
  seller_click INTEGER NOT NULL DEFAULT 0,
  add_material INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(company_id, day)
) WITHOUT ROWID;
CREATE INDEX totals_retention ON daily_totals(day);

CREATE TABLE daily_metrics (
  company_id TEXT NOT NULL,
  day TEXT NOT NULL,
  offer_id TEXT NOT NULL CHECK(length(offer_id) > 0),
  offer_name TEXT NOT NULL DEFAULT '' CHECK(length(offer_name) <= 400),
  search INTEGER NOT NULL DEFAULT 0,
  filter INTEGER NOT NULL DEFAULT 0,
  no_results INTEGER NOT NULL DEFAULT 0,
  impression INTEGER NOT NULL DEFAULT 0,
  details INTEGER NOT NULL DEFAULT 0,
  seller_click INTEGER NOT NULL DEFAULT 0,
  add_material INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(company_id, day, offer_id)
) WITHOUT ROWID;
CREATE INDEX metrics_retention ON daily_metrics(day);

CREATE TABLE daily_filters (
  company_id TEXT NOT NULL,
  day TEXT NOT NULL,
  material_type TEXT NOT NULL,
  packaging TEXT NOT NULL,
  stock TEXT NOT NULL,
  has_search INTEGER NOT NULL,
  search INTEGER NOT NULL DEFAULT 0,
  filter INTEGER NOT NULL DEFAULT 0,
  no_results INTEGER NOT NULL DEFAULT 0,
  impression INTEGER NOT NULL DEFAULT 0,
  details INTEGER NOT NULL DEFAULT 0,
  seller_click INTEGER NOT NULL DEFAULT 0,
  add_material INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(company_id, day, material_type, packaging, stock, has_search)
) WITHOUT ROWID;
CREATE INDEX filters_retention ON daily_filters(day);

CREATE TABLE maintenance (day TEXT PRIMARY KEY) WITHOUT ROWID;

-- This check and all rollups run in the same D1 write transaction as the event.
CREATE TRIGGER events_budget BEFORE INSERT ON events
WHEN (SELECT accepted FROM day_budget WHERE day = NEW.utc_day) >= 4000
  AND NOT EXISTS(SELECT 1 FROM events WHERE id = NEW.id)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER events_rollup AFTER INSERT ON events
BEGIN
  INSERT INTO day_budget(day, accepted) VALUES(NEW.utc_day, 1)
    ON CONFLICT(day) DO UPDATE SET accepted = accepted + 1;

  INSERT INTO daily_totals(company_id, day, search, filter, no_results, impression, details, seller_click, add_material)
  VALUES('', NEW.day, NEW.type='search', NEW.type='filter', NEW.type='no_results', NEW.type='impression', NEW.type='details', NEW.type='seller_click', NEW.type='add_material')
  ON CONFLICT(company_id, day) DO UPDATE SET
    search=search+excluded.search, filter=filter+excluded.filter, no_results=no_results+excluded.no_results,
    impression=impression+excluded.impression, details=details+excluded.details,
    seller_click=seller_click+excluded.seller_click, add_material=add_material+excluded.add_material;

  INSERT INTO daily_totals(company_id, day, search, filter, no_results, impression, details, seller_click, add_material)
  SELECT NEW.company_id, NEW.day, NEW.type='search', NEW.type='filter', NEW.type='no_results', NEW.type='impression', NEW.type='details', NEW.type='seller_click', NEW.type='add_material'
  WHERE NEW.company_id <> ''
  ON CONFLICT(company_id, day) DO UPDATE SET
    search=search+excluded.search, filter=filter+excluded.filter, no_results=no_results+excluded.no_results,
    impression=impression+excluded.impression, details=details+excluded.details,
    seller_click=seller_click+excluded.seller_click, add_material=add_material+excluded.add_material;

  INSERT INTO daily_metrics(company_id, day, offer_id, offer_name, search, filter, no_results, impression, details, seller_click, add_material)
  SELECT NEW.company_id, NEW.day, NEW.offer_id, NEW.offer_name, NEW.type='search', NEW.type='filter', NEW.type='no_results', NEW.type='impression', NEW.type='details', NEW.type='seller_click', NEW.type='add_material'
  WHERE NEW.offer_id <> ''
  ON CONFLICT(company_id, day, offer_id) DO UPDATE SET
    offer_name=excluded.offer_name,
    search=search+excluded.search, filter=filter+excluded.filter, no_results=no_results+excluded.no_results,
    impression=impression+excluded.impression, details=details+excluded.details,
    seller_click=seller_click+excluded.seller_click, add_material=add_material+excluded.add_material;

  INSERT INTO daily_filters(company_id, day, material_type, packaging, stock, has_search, search, filter, no_results, impression, details, seller_click, add_material)
  VALUES('', NEW.day, NEW.material_type, NEW.packaging, NEW.stock, NEW.has_search, NEW.type='search', NEW.type='filter', NEW.type='no_results', NEW.type='impression', NEW.type='details', NEW.type='seller_click', NEW.type='add_material')
  ON CONFLICT(company_id, day, material_type, packaging, stock, has_search) DO UPDATE SET
    search=search+excluded.search, filter=filter+excluded.filter, no_results=no_results+excluded.no_results,
    impression=impression+excluded.impression, details=details+excluded.details,
    seller_click=seller_click+excluded.seller_click, add_material=add_material+excluded.add_material;

  INSERT INTO daily_filters(company_id, day, material_type, packaging, stock, has_search, search, filter, no_results, impression, details, seller_click, add_material)
  SELECT NEW.company_id, NEW.day, NEW.material_type, NEW.packaging, NEW.stock, NEW.has_search, NEW.type='search', NEW.type='filter', NEW.type='no_results', NEW.type='impression', NEW.type='details', NEW.type='seller_click', NEW.type='add_material'
  WHERE NEW.company_id <> ''
  ON CONFLICT(company_id, day, material_type, packaging, stock, has_search) DO UPDATE SET
    search=search+excluded.search, filter=filter+excluded.filter, no_results=no_results+excluded.no_results,
    impression=impression+excluded.impression, details=details+excluded.details,
    seller_click=seller_click+excluded.seller_click, add_material=add_material+excluded.add_material;
END;

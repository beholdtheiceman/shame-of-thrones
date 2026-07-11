CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
ALTER TABLE thrones ADD COLUMN location geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED;
--> statement-breakpoint
CREATE FUNCTION forbid_influence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'influence_events is append-only';
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER influence_events_append_only BEFORE UPDATE OR DELETE ON influence_events FOR EACH ROW EXECUTE FUNCTION forbid_influence_mutation();

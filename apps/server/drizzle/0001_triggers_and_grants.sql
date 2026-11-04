-- Custom migration (drizzle-kit generate --custom): what Drizzle's schema DSL cannot say.
-- Postgres 17 features only (Supabase runs 17; PGlite in tests is 18).

-- Immutable rows (charting/meals "Tray proof stored with the meal", "Meal amendment history"): SQLSTATE P0001.
CREATE FUNCTION "meniscus"."refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%', TG_ARGV[0] USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
-- UPDATE OF fires only when a statement's SET names one of the two columns, so voiding (media_id, voided_*) is unaffected.
CREATE TRIGGER "meal_evidence_fixed" BEFORE UPDATE OF "evidence", "proof" ON "meniscus"."meal"
  FOR EACH ROW EXECUTE FUNCTION "meniscus"."refuse_change"('meal evidence and proof cannot change');
--> statement-breakpoint
-- SQLite's two meal_event triggers (meal_event_fixed on UPDATE, meal_event_kept on DELETE) as one.
CREATE TRIGGER "meal_event_kept" BEFORE UPDATE OR DELETE ON "meniscus"."meal_event"
  FOR EACH ROW EXECUTE FUNCTION "meniscus"."refuse_change"('meal_event rows are kept as written');
--> statement-breakpoint
-- Closed to Supabase's Data API (server/storage "Tables closed to Supabase's APIs"): RLS on with no policy, nothing
-- granted to the API roles. The roles exist on Supabase only, so the revoke is guarded (PGlite has none of them).
DO $$
DECLARE
  t record;
  r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'meniscus' LOOP
    EXECUTE format('ALTER TABLE meniscus.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA meniscus FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA meniscus FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA meniscus FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA meniscus FROM %I', r);
    END IF;
  END LOOP;
END
$$;

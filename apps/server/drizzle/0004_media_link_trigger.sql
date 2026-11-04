-- Custom migration (drizzle-kit generate --custom): `media.linked_at` (0003) set by the database, not by each write.
-- When an entry, level or meal first names a media row in one of its media columns, that row gets `linked_at`, so
-- expiry reads only never-linked media through the partial index `media_unlinked` (charting/media "Unlinked media
-- expires"). The trigger's arguments are the row's media columns. No new table: RLS and grants are unchanged.
CREATE FUNCTION "meniscus"."mark_media_linked"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids bigint[];
BEGIN
  SELECT array_agg((to_jsonb(NEW) ->> c)::bigint) INTO ids
    FROM unnest(TG_ARGV) AS c
    WHERE to_jsonb(NEW) ->> c IS NOT NULL;
  IF ids IS NOT NULL THEN
    UPDATE "meniscus"."media" SET "linked_at" = now() WHERE "id" = ANY (ids) AND "linked_at" IS NULL;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "entry_media_linked" AFTER INSERT OR UPDATE OF "media_id", "labeled_media_id" ON "meniscus"."entry"
  FOR EACH ROW EXECUTE FUNCTION "meniscus"."mark_media_linked"('media_id', 'labeled_media_id');
--> statement-breakpoint
CREATE TRIGGER "level_media_linked" AFTER INSERT OR UPDATE OF "media_id", "proof_media_id", "labeled_media_id" ON "meniscus"."level"
  FOR EACH ROW EXECUTE FUNCTION "meniscus"."mark_media_linked"('media_id', 'proof_media_id', 'labeled_media_id');
--> statement-breakpoint
CREATE TRIGGER "meal_media_linked" AFTER INSERT OR UPDATE OF "media_id", "served_media_id", "labeled_media_id" ON "meniscus"."meal"
  FOR EACH ROW EXECUTE FUNCTION "meniscus"."mark_media_linked"('media_id', 'served_media_id', 'labeled_media_id');
--> statement-breakpoint
-- Backfill: every row linked today (the NOT EXISTS checks 0002's expiry used) keeps living, so nothing linked expires.
UPDATE "meniscus"."media" AS m SET "linked_at" = m."created_at"
WHERE m."linked_at" IS NULL AND (
  EXISTS (SELECT 1 FROM "meniscus"."entry" e WHERE e."media_id" = m."id" OR e."labeled_media_id" = m."id")
  OR EXISTS (SELECT 1 FROM "meniscus"."level" l WHERE l."media_id" = m."id" OR l."proof_media_id" = m."id" OR l."labeled_media_id" = m."id")
  OR EXISTS (SELECT 1 FROM "meniscus"."meal" x WHERE x."media_id" = m."id" OR x."served_media_id" = m."id" OR x."labeled_media_id" = m."id")
);

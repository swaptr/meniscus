ALTER TABLE "meniscus"."entry" ADD COLUMN "labeled_media_id" integer;--> statement-breakpoint
ALTER TABLE "meniscus"."level" ADD COLUMN "labeled_media_id" integer;--> statement-breakpoint
ALTER TABLE "meniscus"."meal" ADD COLUMN "labeled_media_id" integer;--> statement-breakpoint
ALTER TABLE "meniscus"."entry" ADD CONSTRAINT "entry_labeled_media_id_media_id_fk" FOREIGN KEY ("labeled_media_id") REFERENCES "meniscus"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meniscus"."level" ADD CONSTRAINT "level_labeled_media_id_media_id_fk" FOREIGN KEY ("labeled_media_id") REFERENCES "meniscus"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meniscus"."meal" ADD CONSTRAINT "meal_labeled_media_id_media_id_fk" FOREIGN KEY ("labeled_media_id") REFERENCES "meniscus"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_labeled_media" ON "meniscus"."entry" USING btree ("labeled_media_id");--> statement-breakpoint
CREATE INDEX "level_labeled_media" ON "meniscus"."level" USING btree ("labeled_media_id");--> statement-breakpoint
CREATE INDEX "meal_labeled_media" ON "meniscus"."meal" USING btree ("labeled_media_id");
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"group_slug" varchar(32) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"company" text,
	"blog" text,
	"location" text,
	"country" varchar(64),
	"city" varchar(96),
	"followers" integer DEFAULT 0 NOT NULL,
	"public_repos" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "discovery_shards" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic" varchar(96) NOT NULL,
	"stars_lo" integer NOT NULL,
	"stars_hi" integer NOT NULL,
	"created_from" date,
	"created_to" date,
	"total_count" integer,
	"fetched" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error" text,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"node_id" text,
	"full_name" text NOT NULL,
	"owner_login" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"homepage" text,
	"language" text,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"license_spdx_id" varchar(64),
	"license_name" text,
	"stars" integer DEFAULT 0 NOT NULL,
	"forks" integer DEFAULT 0 NOT NULL,
	"open_issues" integer DEFAULT 0 NOT NULL,
	"watchers" integer DEFAULT 0 NOT NULL,
	"size_kb" integer DEFAULT 0 NOT NULL,
	"default_branch" text,
	"is_fork" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"owner_type" varchar(32),
	"owner_avatar_url" text,
	"owner_location" text,
	"owner_country" varchar(64),
	"github_created_at" timestamp with time zone,
	"github_pushed_at" timestamp with time zone,
	"github_updated_at" timestamp with time zone,
	"latest_release_tag" text,
	"latest_release_at" timestamp with time zone,
	"releases_last_year" integer,
	"contributors_count" integer,
	"top_contributor_share" real,
	"readme_excerpt" text,
	"readme_length" integer,
	"stars_day" integer DEFAULT 0 NOT NULL,
	"stars_week" integer DEFAULT 0 NOT NULL,
	"stars_month" integer DEFAULT 0 NOT NULL,
	"trend_score" real DEFAULT 0 NOT NULL,
	"trend_velocity" real DEFAULT 0 NOT NULL,
	"quality_score" integer,
	"quality_grade" varchar(1),
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"etag" text,
	"last_synced_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discovery_source" varchar(64),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("repositories"."full_name", '')), 'A') || setweight(to_tsvector('english', coalesce("repositories"."description", '')), 'B')) STORED
);
--> statement-breakpoint
CREATE TABLE "repository_categories" (
	"repository_id" bigint NOT NULL,
	"category_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"source" varchar(16) DEFAULT 'rule' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_categories_pk" PRIMARY KEY("repository_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "repository_contributors" (
	"repository_id" bigint NOT NULL,
	"contributor_id" bigint NOT NULL,
	"contributions" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	CONSTRAINT "repository_contributors_pk" PRIMARY KEY("repository_id","contributor_id")
);
--> statement-breakpoint
CREATE TABLE "repository_metrics" (
	"repository_id" bigint NOT NULL,
	"recorded_on" date NOT NULL,
	"stars" integer NOT NULL,
	"forks" integer NOT NULL,
	"open_issues" integer NOT NULL,
	"watchers" integer DEFAULT 0 NOT NULL,
	"contributors_count" integer,
	CONSTRAINT "repository_metrics_pk" PRIMARY KEY("repository_id","recorded_on")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"full_name" text,
	"note" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" varchar(32) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"stats" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "repository_categories" ADD CONSTRAINT "repository_categories_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_categories" ADD CONSTRAINT "repository_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_contributors" ADD CONSTRAINT "repository_contributors_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_contributors" ADD CONSTRAINT "repository_contributors_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_metrics" ADD CONSTRAINT "repository_metrics_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uq" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_group_idx" ON "categories" USING btree ("group_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_github_id_uq" ON "contributors" USING btree ("github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_login_uq" ON "contributors" USING btree ("login");--> statement-breakpoint
CREATE INDEX "contributors_country_idx" ON "contributors" USING btree ("country");--> statement-breakpoint
CREATE INDEX "contributors_followers_idx" ON "contributors" USING btree ("followers" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_shards_uq" ON "discovery_shards" USING btree ("topic","stars_lo","stars_hi","created_from","created_to");--> statement-breakpoint
CREATE INDEX "discovery_shards_status_idx" ON "discovery_shards" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_github_id_uq" ON "repositories" USING btree ("github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_full_name_uq" ON "repositories" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "repositories_search_idx" ON "repositories" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "repositories_stars_idx" ON "repositories" USING btree ("stars" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repositories_trend_idx" ON "repositories" USING btree ("trend_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repositories_quality_idx" ON "repositories" USING btree ("quality_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repositories_stars_day_idx" ON "repositories" USING btree ("stars_day" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repositories_stars_week_idx" ON "repositories" USING btree ("stars_week" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repositories_created_idx" ON "repositories" USING btree ("github_created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repositories_pushed_idx" ON "repositories" USING btree ("github_pushed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repositories_language_idx" ON "repositories" USING btree ("language");--> statement-breakpoint
CREATE INDEX "repositories_owner_country_idx" ON "repositories" USING btree ("owner_country");--> statement-breakpoint
CREATE INDEX "repositories_sync_queue_idx" ON "repositories" USING btree ("status","last_synced_at");--> statement-breakpoint
CREATE INDEX "repository_categories_category_idx" ON "repository_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "repository_categories_primary_idx" ON "repository_categories" USING btree ("category_id") WHERE "repository_categories"."is_primary";--> statement-breakpoint
CREATE INDEX "repository_contributors_contributor_idx" ON "repository_contributors" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "repository_contributors_contributions_idx" ON "repository_contributors" USING btree ("contributions" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repository_metrics_repo_date_idx" ON "repository_metrics" USING btree ("repository_id","recorded_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repository_metrics_date_idx" ON "repository_metrics" USING btree ("recorded_on");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "submissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_url_uq" ON "submissions" USING btree ("url");--> statement-breakpoint
CREATE INDEX "sync_runs_job_idx" ON "sync_runs" USING btree ("job","started_at" DESC NULLS LAST);
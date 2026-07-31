/**
 * Database schema.
 *
 * Written for drizzle-orm 0.45.x (the stable line, Relations v1). Two things
 * differ from what the Drizzle docs site currently shows, because the docs
 * default to the unreleased 1.0 RC:
 *   - the pgTable third argument returns an ARRAY of bare builders
 *   - relations use `relations(table, ({ one, many }) => ...)` with
 *     `fields`/`references`, not `defineRelations` with `from`/`to`
 */

import { relations, sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/** Drizzle has no native tsvector type; dataType() is what drizzle-kit diffs on. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ---------------------------------------------------------------------------
// repositories
// ---------------------------------------------------------------------------

export const repositories = pgTable(
  'repositories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    /** GitHub's numeric REST id — the only identifier stable across renames. */
    githubId: bigint('github_id', { mode: 'number' }).notNull(),
    /** GraphQL global node id, used to batch-fetch via nodes(ids: [...]). */
    nodeId: text('node_id'),

    /** "owner/name". Mutable — repos get renamed and transferred. */
    fullName: text('full_name').notNull(),
    ownerLogin: text('owner_login').notNull(),
    name: text('name').notNull(),

    description: text('description'),
    homepage: text('homepage'),
    language: text('language'),
    topics: jsonb('topics').$type<string[]>().notNull().default([]),

    licenseSpdxId: varchar('license_spdx_id', { length: 64 }),
    licenseName: text('license_name'),

    stars: integer('stars').notNull().default(0),
    forks: integer('forks').notNull().default(0),
    openIssues: integer('open_issues').notNull().default(0),
    watchers: integer('watchers').notNull().default(0),
    sizeKb: integer('size_kb').notNull().default(0),

    defaultBranch: text('default_branch'),
    isFork: boolean('is_fork').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    isTemplate: boolean('is_template').notNull().default(false),

    ownerType: varchar('owner_type', { length: 32 }),
    ownerAvatarUrl: text('owner_avatar_url'),
    /** Free-text, as the owner typed it. Normalised into country/city below. */
    ownerLocation: text('owner_location'),
    ownerCountry: varchar('owner_country', { length: 64 }),

    githubCreatedAt: timestamp('github_created_at', { withTimezone: true }),
    githubPushedAt: timestamp('github_pushed_at', { withTimezone: true }),
    githubUpdatedAt: timestamp('github_updated_at', { withTimezone: true }),

    latestReleaseTag: text('latest_release_tag'),
    latestReleaseAt: timestamp('latest_release_at', { withTimezone: true }),
    releasesLastYear: integer('releases_last_year'),

    contributorsCount: integer('contributors_count'),
    /** 0..1 share of commits held by the single top contributor (bus factor). */
    topContributorShare: real('top_contributor_share'),

    /** Head of the README only — enough to classify and preview, not to mirror. */
    readmeExcerpt: text('readme_excerpt'),
    readmeLength: integer('readme_length'),

    /**
     * Denormalised deltas derived from repository_metrics. Kept on the row so
     * "sort by stars gained today" is a plain index scan instead of a
     * self-join against the snapshot table on every page load.
     */
    starsDay: integer('stars_day').notNull().default(0),
    starsWeek: integer('stars_week').notNull().default(0),
    starsMonth: integer('stars_month').notNull().default(0),

    trendScore: real('trend_score').notNull().default(0),
    trendVelocity: real('trend_velocity').notNull().default(0),
    qualityScore: integer('quality_score'),
    qualityGrade: varchar('quality_grade', { length: 1 }),
    qualityFlags: jsonb('quality_flags').$type<string[]>().notNull().default([]),

    /**
     * When classification last ATTEMPTED this repo, successful or not.
     *
     * Separate from the assignment rows because a repo the classifier cannot
     * place writes no rows at all — ordering the work queue by the assignments
     * meant those repos kept a NULL key, sorted first forever, and were re-sent
     * to the LLM on every single run.
     */
    classifiedAt: timestamp('classified_at', { withTimezone: true }),

    /** REST ETag. A 304 on the next refresh costs no rate-limit quota. */
    etag: text('etag'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    discoverySource: varchar('discovery_source', { length: 64 }),

    /** 'active' | 'rejected' — rejected repos stay so we stop re-discovering them. */
    status: varchar('status', { length: 16 }).notNull().default('active'),

    /**
     * The slash in "owner/name" is replaced by a space on purpose: Postgres'
     * parser treats a path as ONE token, so `begin0808/LiveCaption` indexed as
     * the single lexeme 'begin0808/livecaption' and searching "livecaption"
     * matched nothing. Splitting it makes owner and name independently
     * searchable, and the stemmer folds LiveCaptions onto the same stem.
     *
     * Topics carry weight C — they are the author's own keywords.
     */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', replace(coalesce(${repositories.fullName}, ''), '/', ' ')), 'A') || setweight(to_tsvector('english', coalesce(${repositories.description}, '')), 'B') || setweight(to_tsvector('english', coalesce(${repositories.topics}::text, '')), 'C')`,
    ),
  },
  (t) => [
    uniqueIndex('repositories_github_id_uq').on(t.githubId),
    uniqueIndex('repositories_full_name_uq').on(t.fullName),
    index('repositories_search_idx').using('gin', t.searchVector),
    index('repositories_stars_idx').on(t.stars.desc()),
    index('repositories_trend_idx').on(t.trendScore.desc()),
    index('repositories_quality_idx').on(t.qualityScore.desc()),
    index('repositories_stars_day_idx').on(t.starsDay.desc()),
    index('repositories_stars_week_idx').on(t.starsWeek.desc()),
    index('repositories_created_idx').on(t.githubCreatedAt.desc()),
    index('repositories_pushed_idx').on(t.githubPushedAt.desc()),
    index('repositories_language_idx').on(t.language),
    index('repositories_owner_country_idx').on(t.ownerCountry),
    // The sync worker's work queue: oldest-synced active repos first.
    index('repositories_sync_queue_idx').on(t.status, t.lastSyncedAt),
    // The classifier's work queue: least-recently-attempted first.
    index('repositories_classify_queue_idx').on(t.classifiedAt),
  ],
);

// ---------------------------------------------------------------------------
// repository_metrics — the daily snapshots
// ---------------------------------------------------------------------------

/**
 * One row per repo per day. GitHub only ever reports *current* values, so this
 * table is the only way to answer "how fast is this growing" — and it cannot be
 * backfilled after the fact. It is the most valuable thing the project owns.
 */
export const repositoryMetrics = pgTable(
  'repository_metrics',
  {
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    recordedOn: date('recorded_on', { mode: 'string' }).notNull(),

    stars: integer('stars').notNull(),
    forks: integer('forks').notNull(),
    openIssues: integer('open_issues').notNull(),
    watchers: integer('watchers').notNull().default(0),
    contributorsCount: integer('contributors_count'),
  },
  (t) => [
    primaryKey({ name: 'repository_metrics_pk', columns: [t.repositoryId, t.recordedOn] }),
    // Serves the per-repo history chart and the delta computation.
    index('repository_metrics_repo_date_idx').on(t.repositoryId, t.recordedOn.desc()),
    index('repository_metrics_date_idx').on(t.recordedOn),
  ],
);

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: text('name').notNull(),
    groupSlug: varchar('group_slug', { length: 32 }).notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('categories_slug_uq').on(t.slug),
    index('categories_group_idx').on(t.groupSlug),
  ],
);

export const repositoryCategories = pgTable(
  'repository_categories',
  {
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    confidence: real('confidence').notNull().default(0),
    /** 'rule' | 'llm' | 'manual' — manual assignments are never overwritten. */
    source: varchar('source', { length: 16 }).notNull().default('rule'),
    /** Which topics/keywords fired, so a bad classification is debuggable. */
    evidence: jsonb('evidence').$type<string[]>().notNull().default([]),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'repository_categories_pk',
      columns: [t.repositoryId, t.categoryId],
    }),
    index('repository_categories_category_idx').on(t.categoryId),
    // Category landing pages read primary assignments only.
    index('repository_categories_primary_idx')
      .on(t.categoryId)
      .where(sql`${t.isPrimary}`),
  ],
);

// ---------------------------------------------------------------------------
// contributors
// ---------------------------------------------------------------------------

export const contributors = pgTable(
  'contributors',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    githubId: bigint('github_id', { mode: 'number' }).notNull(),
    login: text('login').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    company: text('company'),
    blog: text('blog'),
    /** Raw self-reported location string, e.g. "Berlin, Germany 🇩🇪". */
    location: text('location'),
    country: varchar('country', { length: 64 }),
    city: varchar('city', { length: 96 }),
    followers: integer('followers').notNull().default(0),
    publicRepos: integer('public_repos').notNull().default(0),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('contributors_github_id_uq').on(t.githubId),
    uniqueIndex('contributors_login_uq').on(t.login),
    index('contributors_country_idx').on(t.country),
    index('contributors_followers_idx').on(t.followers.desc()),
  ],
);

export const repositoryContributors = pgTable(
  'repository_contributors',
  {
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    contributorId: bigint('contributor_id', { mode: 'number' })
      .notNull()
      .references(() => contributors.id, { onDelete: 'cascade' }),
    contributions: integer('contributions').notNull().default(0),
    rank: integer('rank'),
  },
  (t) => [
    primaryKey({
      name: 'repository_contributors_pk',
      columns: [t.repositoryId, t.contributorId],
    }),
    index('repository_contributors_contributor_idx').on(t.contributorId),
    index('repository_contributors_contributions_idx').on(t.contributions.desc()),
  ],
);

// ---------------------------------------------------------------------------
// operational tables
// ---------------------------------------------------------------------------

/**
 * Resumable state for the two-axis search sharding. Search is capped at 30
 * requests/minute and 1,000 results per query, so a full discovery sweep spans
 * many minutes and must survive a crash without redoing completed shards.
 */
export const discoveryShards = pgTable(
  'discovery_shards',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    topic: varchar('topic', { length: 96 }).notNull(),
    starsLo: integer('stars_lo').notNull(),
    starsHi: integer('stars_hi').notNull(),
    createdFrom: date('created_from', { mode: 'string' }),
    createdTo: date('created_to', { mode: 'string' }),
    totalCount: integer('total_count'),
    fetched: integer('fetched').notNull().default(0),
    /** 'pending' | 'done' | 'split' | 'error' */
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    error: text('error'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('discovery_shards_uq').on(
      t.topic,
      t.starsLo,
      t.starsHi,
      t.createdFrom,
      t.createdTo,
    ),
    index('discovery_shards_status_idx').on(t.status),
  ],
);

export const submissions = pgTable(
  'submissions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    url: text('url').notNull(),
    fullName: text('full_name'),
    note: text('note'),
    /** 'pending' | 'accepted' | 'rejected' | 'duplicate' */
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    index('submissions_status_idx').on(t.status),
    uniqueIndex('submissions_url_uq').on(t.url),
  ],
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    job: varchar('job', { length: 32 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** 'running' | 'ok' | 'error' */
    status: varchar('status', { length: 16 }).notNull().default('running'),
    stats: jsonb('stats').$type<Record<string, number | string>>(),
    error: text('error'),
  },
  (t) => [index('sync_runs_job_idx').on(t.job, t.startedAt.desc())],
);

// ---------------------------------------------------------------------------
// relations (v1 API — required for db.query.*)
// ---------------------------------------------------------------------------

export const repositoriesRelations = relations(repositories, ({ many }) => ({
  metrics: many(repositoryMetrics),
  categories: many(repositoryCategories),
  contributors: many(repositoryContributors),
}));

export const repositoryMetricsRelations = relations(repositoryMetrics, ({ one }) => ({
  repository: one(repositories, {
    fields: [repositoryMetrics.repositoryId],
    references: [repositories.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  repositories: many(repositoryCategories),
}));

export const repositoryCategoriesRelations = relations(repositoryCategories, ({ one }) => ({
  repository: one(repositories, {
    fields: [repositoryCategories.repositoryId],
    references: [repositories.id],
  }),
  category: one(categories, {
    fields: [repositoryCategories.categoryId],
    references: [categories.id],
  }),
}));

export const contributorsRelations = relations(contributors, ({ many }) => ({
  repositories: many(repositoryContributors),
}));

export const repositoryContributorsRelations = relations(
  repositoryContributors,
  ({ one }) => ({
    repository: one(repositories, {
      fields: [repositoryContributors.repositoryId],
      references: [repositories.id],
    }),
    contributor: one(contributors, {
      fields: [repositoryContributors.contributorId],
      references: [contributors.id],
    }),
  }),
);

// ---------------------------------------------------------------------------
// inferred types
// ---------------------------------------------------------------------------

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type RepositoryMetric = typeof repositoryMetrics.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Contributor = typeof contributors.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type DiscoveryShard = typeof discoveryShards.$inferSelect;

/**
 * Contributor backfill — the people, not just the count.
 *
 * `sync` records how MANY contributors a repo has (and the top author's share)
 * but never who they are, so the `contributors` / `repository_contributors`
 * tables stayed empty and the whole geography/people view had nothing to read.
 * This module fills them:
 *
 *   backfillContributors     per repo: top contributors -> people + link rows,
 *                            plus the count/bus-factor share on the repo
 *   enrichContributorProfiles  one /users call each for the people who rank
 *                            highest, which is what supplies country + followers
 *   backfillOwnerCountries   normalise repositories.owner_location -> owner_country
 *
 * Star-prioritised throughout: contributor data costs a REST call per repo, so
 * the repos people actually open are filled first.
 */

import { and, asc, desc, eq, gte, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { contributors, db, repositories, repositoryContributors } from '@/db';
import { github } from '@/lib/github';
import { countryFromLocation, normalizeLocation } from '@/lib/geo';
import { chunk, mapLimit } from '@/lib/utils';

const WRITE_CHUNK = 500;

/** People stored per repository. Bounds link-table growth; the tail of a
 * 500-contributor repo is not what anyone browses. */
const PEOPLE_PER_REPO = 30;

export interface BackfillContributorsOptions {
  /** Only repos with at least this many stars. */
  minStars?: number;
  /** Cap on repos processed this run (each is 1-2 REST calls). */
  limit?: number;
  concurrency?: number;
  /** Re-fetch repos that already have contributor rows. */
  force?: boolean;
  log?: (message: string) => void;
}

export interface BackfillContributorsStats extends Record<string, number | string> {
  considered: number;
  refreshed: number;
  empty: number;
  errors: number;
  peopleWritten: number;
  linksWritten: number;
}

interface Person {
  githubId: number;
  login: string;
  avatarUrl: string | null;
}

interface RepoPeople {
  repositoryId: number;
  count: number;
  share: number | null;
  people: { person: Person; contributions: number; rank: number }[];
}

export async function backfillContributors(
  options: BackfillContributorsOptions = {},
): Promise<BackfillContributorsStats> {
  const log = options.log ?? ((message: string) => console.log(`  ${message}`));
  const minStars = options.minStars ?? 500;
  const limit = options.limit ?? 4_000;
  const concurrency = options.concurrency ?? 6;
  const force = options.force ?? false;

  const stats: BackfillContributorsStats = {
    considered: 0,
    refreshed: 0,
    empty: 0,
    errors: 0,
    peopleWritten: 0,
    linksWritten: 0,
  };

  // Repos with no contributor ROWS yet (not merely no count) — that is the gap
  // this job exists to close. `force` re-walks everything above the threshold.
  const alreadyHasPeople = sql`exists (
    select 1 from repository_contributors rc where rc.repository_id = ${repositories.id}
  )`;

  const targets = await db
    .select({ id: repositories.id, fullName: repositories.fullName, stars: repositories.stars })
    .from(repositories)
    .where(
      and(
        eq(repositories.status, 'active'),
        gte(repositories.stars, minStars),
        ...(force ? [] : [sql`not ${alreadyHasPeople}`]),
      ),
    )
    .orderBy(desc(repositories.stars))
    .limit(limit);

  stats.considered = targets.length;
  if (targets.length === 0) {
    log(`no repos with >= ${minStars} stars are missing contributor rows`);
    return stats;
  }

  log(`fetching contributors for ${targets.length} repo(s) with >= ${minStars} stars`);

  const collected: RepoPeople[] = [];
  let done = 0;

  await mapLimit(targets, concurrency, async (repo) => {
    try {
      const top = await github.getTopContributors(repo.fullName, 100);
      if (top.length === 0) {
        stats.empty++;
        return;
      }

      let count = top.length;
      if (top.length >= 100) {
        // Only now is the Link-header trick worth a second request. Its answer
        // saturates around 300, so treat it as a lower bound, never an exact.
        const measured = await github.getContributorCount(repo.fullName);
        count = measured.count ?? top.length;
      }

      const totalKnown = top.reduce((sum, person) => sum + person.contributions, 0);
      const share =
        totalKnown > 0 ? Number((top[0]!.contributions / totalKnown).toFixed(4)) : null;

      collected.push({
        repositoryId: repo.id,
        count,
        share,
        people: top.slice(0, PEOPLE_PER_REPO).map((person, index) => ({
          person: { githubId: person.id, login: person.login, avatarUrl: person.avatarUrl },
          contributions: person.contributions,
          rank: index + 1,
        })),
      });
      stats.refreshed++;
    } catch (error) {
      stats.errors++;
      log(
        `contributor fetch failed for ${repo.fullName}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      done++;
      if (done % 200 === 0) log(`progress ${done}/${targets.length}`);
    }
  });

  // ----------------------------------------------------------------- write --
  const written = await persistPeople(collected);
  stats.peopleWritten = written.people;
  stats.linksWritten = written.links;

  await writeRepoAggregates(collected);

  log(
    `repos ${stats.refreshed}, people ${stats.peopleWritten}, links ${stats.linksWritten}, ` +
      `empty ${stats.empty}, errors ${stats.errors}`,
  );
  return stats;
}

/**
 * Upsert the people, then the repo↔person links.
 *
 * `contributors` is unique on BOTH github_id and login. A login can move to a
 * different account, so any row holding a login that a different github_id is
 * about to claim gets its login tombstoned first — otherwise the whole chunk
 * fails on the login index rather than just that row.
 */
async function persistPeople(collected: RepoPeople[]): Promise<{ people: number; links: number }> {
  const byGithubId = new Map<number, Person>();
  for (const entry of collected) {
    for (const { person } of entry.people) {
      if (person.githubId > 0) byGithubId.set(person.githubId, person);
    }
  }

  const people = [...byGithubId.values()];
  if (people.length === 0) return { people: 0, links: 0 };

  const idByGithubId = new Map<number, number>();

  for (const batch of chunk(people, WRITE_CHUNK)) {
    const logins = batch.map((person) => person.login);
    const ids = batch.map((person) => person.githubId);

    await db.execute(sql`
      update contributors
      set login = login || ':' || github_id::text
      where login in ${logins} and github_id not in ${ids}
    `);

    const rows = await db
      .insert(contributors)
      .values(
        batch.map((person) => ({
          githubId: person.githubId,
          login: person.login,
          avatarUrl: person.avatarUrl,
        })),
      )
      .onConflictDoUpdate({
        target: contributors.githubId,
        set: {
          login: sql`excluded.login`,
          avatarUrl: sql`coalesce(excluded.avatar_url, contributors.avatar_url)`,
        },
      })
      .returning({ id: contributors.id, githubId: contributors.githubId });

    for (const row of rows) idByGithubId.set(row.githubId, row.id);
  }

  // Link rows. Resolved through idByGithubId, never zipped by position.
  const links = collected.flatMap((entry) =>
    entry.people.flatMap(({ person, contributions, rank }) => {
      const contributorId = idByGithubId.get(person.githubId);
      if (contributorId === undefined) return [];
      return [{ repositoryId: entry.repositoryId, contributorId, contributions, rank }];
    }),
  );

  let linkCount = 0;
  for (const batch of chunk(links, WRITE_CHUNK)) {
    await db
      .insert(repositoryContributors)
      .values(batch)
      .onConflictDoUpdate({
        target: [repositoryContributors.repositoryId, repositoryContributors.contributorId],
        set: { contributions: sql`excluded.contributions`, rank: sql`excluded.rank` },
      });
    linkCount += batch.length;
  }

  return { people: idByGithubId.size, links: linkCount };
}

/** The count and bus-factor share still live on the repository row. */
async function writeRepoAggregates(collected: RepoPeople[]): Promise<void> {
  for (const batch of chunk(collected, WRITE_CHUNK)) {
    const values = sql.join(
      batch.map(
        (entry) =>
          sql`(${entry.repositoryId}::bigint, ${entry.count}::integer, ${
            entry.share === null ? sql`null::real` : sql`${entry.share}::real`
          })`,
      ),
      sql`, `,
    );

    await db.execute(sql`
      update repositories r
      set contributors_count = v.count,
          top_contributor_share = v.share
      from (values ${values}) as v(id, count, share)
      where r.id = v.id
    `);
  }
}

// ---------------------------------------------------------------------------
// Profile enrichment
// ---------------------------------------------------------------------------

export interface EnrichStats extends Record<string, number | string> {
  considered: number;
  enriched: number;
  errors: number;
}

/**
 * Fill in name / company / location / followers for the people who rank highest,
 * one `/users/{login}` call each. The country filter on the contributors page
 * reads `contributors.country`, so without this pass the geography view is empty
 * no matter how many link rows exist.
 */
export async function enrichContributorProfiles(
  options: { limit?: number; concurrency?: number; log?: (message: string) => void } = {},
): Promise<EnrichStats> {
  const log = options.log ?? ((message: string) => console.log(`  ${message}`));
  const limit = options.limit ?? 2_000;
  const concurrency = options.concurrency ?? 6;

  const stats: EnrichStats = { considered: 0, enriched: 0, errors: 0 };

  // Never-synced people first, ordered by how many indexed repos they touch —
  // the same ranking the page uses, so the visible rows fill in first.
  const repoCount = sql<number>`count(*)`;
  const targets = await db
    .select({ id: contributors.id, login: contributors.login, repos: repoCount.mapWith(Number) })
    .from(contributors)
    .innerJoin(repositoryContributors, eq(repositoryContributors.contributorId, contributors.id))
    .where(isNull(contributors.lastSyncedAt))
    .groupBy(contributors.id)
    .orderBy(desc(repoCount))
    .limit(limit);

  stats.considered = targets.length;
  if (targets.length === 0) {
    log('every contributor already has a profile');
    return stats;
  }

  log(`enriching ${targets.length} contributor profile(s)`);

  const updates: {
    id: number;
    name: string | null;
    company: string | null;
    blog: string | null;
    location: string | null;
    country: string | null;
    city: string | null;
    followers: number;
    publicRepos: number;
  }[] = [];

  let done = 0;
  await mapLimit(targets, concurrency, async (target) => {
    try {
      const user = await github.getUser(target.login);
      if (!user) return;
      const place = normalizeLocation(user.location);
      updates.push({
        id: target.id,
        name: user.name,
        company: user.company,
        blog: user.blog,
        location: user.location,
        country: place.country,
        city: place.city,
        followers: user.followers,
        publicRepos: user.publicRepos,
      });
      stats.enriched++;
    } catch (error) {
      stats.errors++;
      log(
        `profile fetch failed for ${target.login}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      done++;
      if (done % 250 === 0) log(`progress ${done}/${targets.length}`);
    }
  });

  for (const batch of chunk(updates, WRITE_CHUNK)) {
    const values = sql.join(
      batch.map(
        (u) =>
          sql`(${u.id}::bigint, ${u.name}::text, ${u.company}::text, ${u.blog}::text, ${u.location}::text, ${u.country}::varchar, ${u.city}::varchar, ${u.followers}::integer, ${u.publicRepos}::integer)`,
      ),
      sql`, `,
    );

    await db.execute(sql`
      update contributors c
      set name = v.name,
          company = v.company,
          blog = v.blog,
          location = v.location,
          country = v.country,
          city = v.city,
          followers = v.followers,
          public_repos = v.public_repos,
          last_synced_at = now()
      from (values ${values}) as v(id, name, company, blog, location, country, city, followers, public_repos)
      where c.id = v.id
    `);
  }

  log(`enriched ${stats.enriched}, errors ${stats.errors}`);
  return stats;
}

// ---------------------------------------------------------------------------
// Owner countries
// ---------------------------------------------------------------------------

export interface OwnerCountryStats extends Record<string, number | string> {
  considered: number;
  resolved: number;
  unresolved: number;
}

/**
 * Normalise the owner's free-text location into `owner_country`.
 *
 * Costs no API calls — `owner_location` is already stored by sync; this is pure
 * string work, which is why it can run over the whole table every time.
 */
export async function backfillOwnerCountries(
  options: { log?: (message: string) => void } = {},
): Promise<OwnerCountryStats> {
  const log = options.log ?? ((message: string) => console.log(`  ${message}`));

  const rows = await db
    .select({ id: repositories.id, location: repositories.ownerLocation })
    .from(repositories)
    .where(and(isNotNull(repositories.ownerLocation), or(isNull(repositories.ownerCountry), sql`true`)))
    .orderBy(asc(repositories.id));

  const stats: OwnerCountryStats = { considered: rows.length, resolved: 0, unresolved: 0 };
  log(`normalising ${rows.length} owner location(s)`);

  const resolved: { id: number; country: string }[] = [];
  for (const row of rows) {
    const country = countryFromLocation(row.location);
    if (country) resolved.push({ id: row.id, country });
    else stats.unresolved++;
  }

  for (const batch of chunk(resolved, WRITE_CHUNK)) {
    const values = sql.join(
      batch.map((entry) => sql`(${entry.id}::bigint, ${entry.country}::varchar)`),
      sql`, `,
    );
    await db.execute(sql`
      update repositories r
      set owner_country = v.country
      from (values ${values}) as v(id, country)
      where r.id = v.id
    `);
    stats.resolved += batch.length;
  }

  log(`resolved ${stats.resolved}, unresolved ${stats.unresolved}`);
  return stats;
}

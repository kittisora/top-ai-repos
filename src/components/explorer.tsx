import { loadCategoryStats, query } from '@/components/data';
import { ActiveFilters, FilterSidebar } from '@/components/filter-sidebar';
import { Pagination } from '@/components/pagination';
import { RepoList } from '@/components/repo-list';
import { SearchInput } from '@/components/search-input';
import { SetupNotice } from '@/components/setup-notice';
import { SortSelect } from '@/components/sort-select';
import { repoListQuerySchema, type RepoListQuery } from '@/lib/api/validation';
import type { RepoSort } from '@/lib/queries';

/**
 * The repository explorer: filter sidebar, search, sort, results, pagination.
 *
 * Shared by /repos and /categories/[slug] because they are the same view with
 * one filter pinned — duplicating it would guarantee the two drift apart the
 * first time a filter is added.
 *
 * All state is read from the URL and nothing is written to it here, which is
 * what keeps this a server component despite being the most interactive screen
 * in the app.
 */

/**
 * A hand-edited URL should degrade, not 500. Bad params are dropped and named
 * in a notice, and the rest of the query still runs — silently ignoring them
 * would show results the user did not ask for with no way to tell.
 */
function parseQuery(raw: Record<string, string>): { params: RepoListQuery; ignored: string[] } {
  const parsed = repoListQuerySchema.safeParse(raw);
  if (parsed.success) return { params: parsed.data, ignored: [] };

  const ignored: string[] = [];
  const cleaned = { ...raw };
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key !== 'string') continue;
    ignored.push(`${key} ${issue.message}`);
    delete cleaned[key];
  }

  const retry = repoListQuerySchema.safeParse(cleaned);
  return { params: retry.success ? retry.data : {}, ignored };
}

export async function RepoExplorer({
  pathname,
  searchParams,
  lockedCategory,
}: {
  /** Where filter forms and pagination links point. */
  pathname: string;
  searchParams: Record<string, string>;
  /** Slug fixed by the route, e.g. on /categories/[slug]. */
  lockedCategory?: string;
}) {
  const { params, ignored } = parseQuery(searchParams);

  // getCategoryStats goes through the request-scoped memo because
  // /categories/[slug] renders this component *and* reads the same aggregate
  // for its own header — without it the page would run that query twice.
  const [result, categories] = await Promise.all([
    query(async (q) => {
      const [repos, stats, languages, countries] = await Promise.all([
        q.listRepositories({
          ...params,
          ...(lockedCategory ? { category: lockedCategory } : {}),
        }),
        q.getGlobalStats(),
        q.getLanguages(),
        q.getCountryStats(),
      ]);
      return { repos, stats, languages, countries };
    }),
    loadCategoryStats(),
  ]);

  if (result.error) return <SetupNotice error={result.error} />;

  const { repos, stats, languages, countries } = result.data;
  const groups = categories.data ?? [];
  const sort: RepoSort = params.sort ?? 'trending';

  // The sidebar's selects and the search box are uncontrolled, so a client-side
  // navigation (removing a filter chip, hitting back) would re-render them with
  // new defaults that the DOM ignores. Keying on the query string remounts them
  // whenever the URL — the single source of truth — changes.
  const urlKey = new URLSearchParams(searchParams).toString();

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Sticks below the floating header while the results scroll. The offset is
          measured, not guessed: the pill's lower edge sits at 76px, so top-26
          (104px) leaves a 28px gap — matching the grid's own gap-6 rhythm. Lower
          values (top-20/22) pin the panel ~12px under the pill and the two read
          as one stuck-together block. */}
      <aside aria-label="Filters" className="lg:sticky lg:top-22 lg:self-start">
        <FilterSidebar
          key={urlKey}
          action={pathname}
          params={searchParams}
          groups={groups}
          languages={languages}
          countries={countries}
          lockedCategory={lockedCategory}
        />
      </aside>

      <div className="min-w-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            key={searchParams.q ?? ''}
            className="min-w-0 flex-1"
            target={pathname}
            defaultValue={searchParams.q ?? ''}
          />
          <SortSelect value={sort} pathname={pathname} />
        </div>

        {ignored.length > 0 ? (
          <p
            role="status"
            className="mt-3 rounded-md border border-warning/40 bg-warning/8 px-3 py-2 text-xs text-tertiary"
          >
            Ignored {ignored.length === 1 ? 'an invalid filter' : 'invalid filters'}:{' '}
            {ignored.join('; ')}.
          </p>
        ) : null}

        <div className="mt-3">
          <ActiveFilters
            pathname={pathname}
            params={searchParams}
            exclude={lockedCategory ? ['category'] : []}
            countLabel={`${repos.total.toLocaleString()} ${
              repos.total === 1 ? 'result' : 'results'
            }`}
          />
        </div>

        <div className="mt-3">
          <RepoList
            repos={repos.items}
            trendWindow="this week"
            indexEmpty={stats.repositories === 0}
            emptyTitle={
              lockedCategory
                ? 'No repositories in this category match these filters'
                : 'No repositories match these filters'
            }
          />
        </div>

        <Pagination
          page={repos.page}
          totalPages={repos.totalPages}
          total={repos.total}
          perPage={repos.perPage}
          pathname={pathname}
          params={searchParams}
        />

        {stats.repositories === 0 ? null : (
          <p className="num text-center text-xs text-quaternary">
            {stats.repositories.toLocaleString()} repositories in the index in total.
          </p>
        )}
      </div>
    </div>
  );
}

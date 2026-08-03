import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { ContributorFilters } from '@/components/contributor-filters';
import { query } from '@/components/data';
import { Pagination } from '@/components/pagination';
import { toQueryRecord, type RawSearchParams } from '@/components/search-params';
import { EmptyIndexNotice, SetupNotice } from '@/components/setup-notice';
import { EmptyState, LinkButton } from '@/components/ui';
import { contributorsQuerySchema } from '@/lib/api/validation';
import type { TopContributor } from '@/lib/queries';
import { cn, formatCompact } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Top contributors',
  description:
    'The people building open-source AI, ranked by how many indexed repositories they ' +
    'contribute to. Filterable by country and by category.',
  // Country/category filters live in the query string; they are all views of this
  // same ranking, so they consolidate here rather than competing with it.
  alternates: { canonical: '/contributors' },
};

export default async function ContributorsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = toQueryRecord(await searchParams);
  // Unknown or malformed filters fall back to the unfiltered ranking rather
  // than erroring — this page has no required input.
  const parsed = contributorsQuerySchema.safeParse(raw);
  const params = parsed.success ? parsed.data : {};

  const result = await query(async (q) => {
    const [people, countries, groups] = await Promise.all([
      q.getTopContributors(params),
      q.getCountryStats(),
      q.getCategoryStats(),
    ]);
    return { people, countries, groups };
  });

  if (result.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <SetupNotice error={result.error} />
      </div>
    );
  }

  const { people, countries, groups } = result.data;
  const filtered = Boolean(params.country || params.category || params.group);

  return (
    <div className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Top contributors</h1>
        <p className="mt-1 max-w-2xl text-sm text-tertiary">
          Ranked by how many indexed repositories a person contributes to, and only then by
          commit count — breadth across distinct projects says more than a single large
          codemod.
        </p>
      </header>

      <ContributorFilters
        // Remount on any URL change so the controls reflect the URL after a
        // client-side navigation (e.g. the Clear button).
        key={new URLSearchParams(raw).toString()}
        countries={countries}
        groups={groups}
        country={raw.country}
        category={raw.category}
        total={people.total}
      />

      {people.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No contributors match these filters"
            action={<LinkButton href="/contributors">Clear filters</LinkButton>}
          >
            Contributor country is derived from the profile location, which many people leave
            blank.
          </EmptyState>
        ) : (
          <EmptyIndexNotice what="contributors" />
        )
      ) : (
        <>
          <ContributorTable
            people={people.items}
            startRank={(people.page - 1) * people.perPage + 1}
          />
          <Pagination
            page={people.page}
            totalPages={people.totalPages}
            total={people.total}
            perPage={people.perPage}
            pathname="/contributors"
            params={raw}
          />
        </>
      )}
    </div>
  );
}

/**
 * Wide table on a phone is fine as long as it scrolls inside its own box — the
 * page body must never scroll sideways.
 */
function ContributorTable({
  people,
  startRank,
}: {
  people: TopContributor[];
  startRank: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-secondary bg-primary">
      <table className="w-full min-w-[46rem] text-sm">
        <caption className="sr-only">
          Contributors ranked by number of indexed repositories
        </caption>
        <thead>
          <tr className="border-b border-secondary text-left text-xs uppercase tracking-wider text-quaternary">
            <th scope="col" className="w-12 px-3 py-2 text-right font-medium">
              #
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Person
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Company
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Location
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Repos
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Commits
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Stars reached
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Followers
            </th>
          </tr>
        </thead>
        <tbody>
          {people.map((person, index) => (
            <tr key={person.id} className="border-b border-secondary last:border-0 hover:bg-secondary">
              <td className="num px-3 py-2 text-right text-xs text-quaternary">
                {startRank + index}
              </td>
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <div className="flex items-center gap-2">
                  {person.avatarUrl ? (
                    <Image
                      src={person.avatarUrl}
                      alt=""
                      width={24}
                      height={24}
                      className="size-6 shrink-0 rounded-full border border-secondary bg-secondary"
                      unoptimized
                    />
                  ) : (
                    <span className="size-6 shrink-0 rounded-full border border-secondary bg-secondary" />
                  )}
                  <span className="min-w-0">
                    <a
                      href={`https://github.com/${person.login}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate font-medium hover:text-brand-secondary"
                    >
                      {person.login}
                    </a>
                    {person.name ? (
                      <span className="block truncate text-xs text-quaternary">{person.name}</span>
                    ) : null}
                  </span>
                </div>
              </th>
              <td className="max-w-40 truncate px-3 py-2 text-xs text-tertiary">
                {person.company ?? '—'}
              </td>
              <td className="max-w-40 truncate px-3 py-2 text-xs text-tertiary">
                {person.country ? (
                  <Link
                    href={`/contributors?country=${encodeURIComponent(person.country)}`}
                    className="hover:text-primary"
                  >
                    {person.city ? `${person.city}, ${person.country}` : person.country}
                  </Link>
                ) : (
                  (person.location ?? '—')
                )}
              </td>
              <td className="num px-3 py-2 text-right font-medium">{person.repoCount}</td>
              <td className="num px-3 py-2 text-right text-tertiary">
                {formatCompact(person.contributions)}
              </td>
              <td className="num px-3 py-2 text-right text-tertiary">
                {formatCompact(person.starsReached)}
              </td>
              <td className="num px-3 py-2 text-right text-tertiary">
                {formatCompact(person.followers)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

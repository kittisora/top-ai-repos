import type { Metadata } from 'next';

import { RepoExplorer } from '@/components/explorer';
import { toQueryRecord, type RawSearchParams } from '@/components/search-params';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Explore repositories',
  description:
    'Filter open-source AI repositories by category, language, licence, country, star count ' +
    'and quality score, sorted by momentum or by adoption risk.',
};

export default async function ReposPage({
  searchParams,
}: {
  // Promises in Next 16 — the synchronous compatibility shim from 15 is gone.
  searchParams: Promise<RawSearchParams>;
}) {
  const params = toQueryRecord(await searchParams);

  return (
    <div className="mx-auto max-w-[100rem] px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Explore repositories</h1>
        <p className="mt-1 text-sm text-tertiary">
          Every filter lives in the URL, so any view you build here is a link you can share.
        </p>
      </div>

      <RepoExplorer pathname="/repos" searchParams={params} />
    </div>
  );
}

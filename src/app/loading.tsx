import { Skeleton } from '@/components/ui';
import { env } from '@/lib/env';

/**
 * The homepage's loading state — the one route that was missing one.
 *
 * Every other data-backed route had a loading.tsx, so navigating *to* them showed
 * a skeleton and felt responsive. Coming back to `/` — by clicking the logo, which
 * is the most obvious way home — showed nothing at all until the server finished.
 * The homepage is the heaviest read in the app (six queries: global stats, four
 * ranked lists and the category tree) and it is `force-dynamic`, so that silence
 * lasted the better part of two seconds and read as a dead click.
 *
 * The hero is rendered for real rather than skeletonised. The heading and its
 * paragraph are static text that depend on no data, so there is no reason to hide
 * them behind grey boxes: showing them immediately confirms the click landed and
 * says which page is arriving. Only the parts that genuinely wait on the database
 * shimmer.
 *
 * Shapes mirror the real layout — same grid, same 8 rows per list, same bordered
 * tiles — so content swapping in does not move anything.
 */
export default function LoadingHome() {
  return (
    <div className="mx-auto max-w-[100rem] px-4 py-8 sm:px-6">
      {/* Real hero: identical markup to page.tsx, so nothing shifts when the
          actual page replaces this fallback. */}
      <section className="mx-auto max-w-3xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {env.siteName} — open-source AI, indexed and scored
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-tertiary sm:text-base">
          {env.siteName} tracks AI repositories on GitHub and answers two different questions
          about each one: is it moving right now, and would you bet a product on it.
        </p>
        {/* h-11 is the  `md` input height, which is what SearchInput
            renders. Deliberately NOT the real <SearchInput>: it holds its own
            input state, and swapping the fallback out would discard anything the
            visitor had already typed. */}
        <Skeleton className="mx-auto mt-6 h-11 max-w-xl" />
        <Skeleton className="mx-auto mt-3 h-3 w-72 max-w-full" />
      </section>

      {/* Five stat tiles. The bordered shell is real and only its text is
          skeletonised, which keeps the height exact without hard-coding it. */}
      <section aria-label="Index statistics" className="mt-10">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="rounded-xl border border-secondary bg-primary px-3.5 py-3 shadow-xs"
            >
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="mt-1.5 h-7 w-16" />
              <Skeleton className="mt-1.5 h-3 w-20" />
            </div>
          ))}
        </div>
      </section>

      {/* Trending today / this week / newly discovered / highest quality. */}
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, section) => (
          <section key={section}>
            <div className="mb-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="mt-2 h-3 w-64 max-w-full" />
              </div>
              <Skeleton className="h-8 w-20 shrink-0" />
            </div>

            <div className="overflow-hidden rounded-lg border border-secondary">
              {Array.from({ length: 8 }, (_, row) => (
                <div
                  key={row}
                  className="flex gap-3 border-b border-secondary px-3.5 py-3 last:border-0"
                >
                  <Skeleton className="size-7 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-4 w-12 shrink-0" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Browse by category: three group panels. */}
      <section className="mt-14">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-2 h-3 w-72 max-w-full" />
          </div>
          <Skeleton className="h-8 w-28 shrink-0" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-64" />
          ))}
        </div>
      </section>

      {/*
        `role="status"` announces the wait to a screen reader, which the shimmer
        alone cannot. Every Skeleton is aria-hidden, so this is the only thing
        assistive technology sees here.
      */}
      <span className="sr-only" role="status">
        Loading the homepage
      </span>
    </div>
  );
}

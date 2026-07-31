import { Skeleton } from '@/components/ui';

/**
 * The explorer runs five queries against a few thousand rows; on a cold pool
 * that is a visible pause. The skeleton mirrors the real layout so the content
 * does not jump when it lands.
 */
export default function LoadingRepos() {
  return (
    <div className="mx-auto max-w-[100rem] px-4 py-6 sm:px-6">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />

      <div className="mt-5 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
        <Skeleton className="hidden h-[32rem] lg:block" />

        <div className="min-w-0">
          <div className="flex gap-3">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-44" />
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-secondary">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="flex gap-3 border-b border-secondary px-3.5 py-3 last:border-0">
                <Skeleton className="size-7 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-4 w-12 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">
        Loading repositories
      </span>
    </div>
  );
}

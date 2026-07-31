import { Skeleton } from '@/components/ui';

export default function LoadingCategory() {
  return (
    <div className="mx-auto max-w-[100rem] px-4 py-6 sm:px-6">
      <Skeleton className="h-3 w-56" />
      <Skeleton className="mt-4 h-6 w-64" />
      <Skeleton className="mt-2 h-4 w-full max-w-2xl" />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
        <Skeleton className="hidden h-96 lg:block" />
        <div className="space-y-3">
          <Skeleton className="h-9" />
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
      </div>
      <span className="sr-only" role="status">
        Loading category
      </span>
    </div>
  );
}

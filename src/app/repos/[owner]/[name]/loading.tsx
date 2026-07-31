import { Skeleton } from '@/components/ui';

export default function LoadingRepository() {
  return (
    <div className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6">
      <Skeleton className="h-3 w-48" />
      <div className="mt-4 flex gap-4">
        <Skeleton className="size-12 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-72 max-w-full" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-[4.5rem]" />
            ))}
          </div>
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-48" />
        </div>
      </div>
      <span className="sr-only" role="status">
        Loading repository
      </span>
    </div>
  );
}

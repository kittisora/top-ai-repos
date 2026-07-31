import { Skeleton } from '@/components/ui';

export default function LoadingContributors() {
  return (
    <div className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
      <Skeleton className="mt-5 h-16" />
      <div className="mt-4 space-y-px overflow-hidden rounded-lg border border-secondary">
        {Array.from({ length: 12 }, (_, index) => (
          <Skeleton key={index} className="h-11 rounded-none" />
        ))}
      </div>
      <span className="sr-only" role="status">
        Loading contributors
      </span>
    </div>
  );
}

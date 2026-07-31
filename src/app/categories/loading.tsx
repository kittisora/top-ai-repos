import { Skeleton } from '@/components/ui';

export default function LoadingCategories() {
  return (
    <div className="mx-auto max-w-[100rem] px-4 py-6 sm:px-6">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-2 h-4 w-full max-w-2xl" />

      {Array.from({ length: 3 }, (_, group) => (
        <section key={group} className="mt-10">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="mt-2 h-4 w-full max-w-xl" />
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, card) => (
              <Skeleton key={card} className="h-32" />
            ))}
          </div>
        </section>
      ))}
      <span className="sr-only" role="status">
        Loading categories
      </span>
    </div>
  );
}

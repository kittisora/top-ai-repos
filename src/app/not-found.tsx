import Link from 'next/link';

import { LinkButton } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center sm:px-6">
      <p className="num text-sm font-medium text-brand-secondary">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Not in the index</h1>
      <p className="mt-2 text-sm text-tertiary">
        Either this page does not exist, or the repository has not been discovered yet.
        Discovery crawls GitHub by topic and by search, so newly created or untagged projects
        can take a while to show up.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <LinkButton href="/repos" variant="primary">
          Explore repositories
        </LinkButton>
        <LinkButton href="/submit">Submit a missing repository</LinkButton>
      </div>

      <p className="mt-6 text-xs text-quaternary">
        Or start from{' '}
        <Link href="/categories" className="text-brand-secondary hover:underline">
          the category index
        </Link>
        .
      </p>
    </div>
  );
}

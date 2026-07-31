import Link from 'next/link';

import { env } from '@/lib/env';
import { GROUPS } from '@/lib/taxonomy';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-secondary bg-secondary">
      <div className="mx-auto grid max-w-[100rem] gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="text-sm font-semibold">{env.siteName}</p>
          <p className="mt-1.5 max-w-sm text-sm text-tertiary">
            An index of open-source AI repositories on GitHub, scored on momentum and on
            adoption risk — two questions that ranking by stars answers neither of.
          </p>
        </div>

        <nav aria-labelledby="footer-browse">
          <p id="footer-browse" className="text-xs font-medium uppercase tracking-wider text-quaternary">
            Browse
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {GROUPS.map((group) => (
              <li key={group.slug}>
                <Link
                  href={`/repos?group=${group.slug}`}
                  className="text-tertiary hover:text-primary"
                >
                  {group.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/categories" className="text-tertiary hover:text-primary">
                All categories
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-labelledby="footer-more">
          <p id="footer-more" className="text-xs font-medium uppercase tracking-wider text-quaternary">
            More
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li>
              <Link href="/submit" className="text-tertiary hover:text-primary">
                Submit a repository
              </Link>
            </li>
            <li>
              <Link href="/contributors" className="text-tertiary hover:text-primary">
                Top contributors
              </Link>
            </li>
            <li>
              <Link href="/api/stats" className="text-tertiary hover:text-primary">
                JSON API
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-secondary">
        <p className="mx-auto max-w-[100rem] px-4 py-4 text-xs text-quaternary sm:px-6">
          Data from the GitHub REST and GraphQL APIs. Star counts and rankings reflect the last
          completed sync, not live GitHub state.
        </p>
      </div>
    </footer>
  );
}

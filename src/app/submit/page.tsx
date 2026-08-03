import type { Metadata } from 'next';

import { SubmitForm } from '@/components/submit-form';
import { Code, Panel } from '@/components/ui';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Submit a repository',
  description:
    'Suggest an open-source AI repository that is missing from the index. Submissions are ' +
    'queued for review and picked up by the next ingestion run.',
  alternates: { canonical: '/submit' },
};

/**
 * The only page in the app that reads nothing, so it is also the only one that
 * can be statically rendered — the form talks to /api/submissions from the
 * browser.
 */
export default function SubmitPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Submit a repository</h1>
      <p className="mt-1.5 text-sm text-tertiary">
        Discovery crawls GitHub by topic and by search, which misses projects that are new,
        oddly tagged or simply untagged. If something is missing, put it in the queue.
      </p>

      <div className="mt-6 rounded-lg border border-secondary bg-primary p-5">
        <SubmitForm />
      </div>

      <Panel className="mt-6 p-4 text-sm text-tertiary">
        <h2 className="text-sm font-semibold text-primary">What happens next</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>The URL is normalised to <Code>owner/name</Code> and checked for duplicates.</li>
          <li>
            The next ingestion run fetches it from the GitHub API, along with its contributors
            and README.
          </li>
          <li>
            It is classified against the taxonomy, scored for momentum and quality, and appears
            in the explorer.
          </li>
        </ol>
        <p className="mt-3 text-xs text-quaternary">
          {env.siteName} only indexes repositories above the star threshold configured in{' '}
          <Code>MIN_STARS</Code>. Anything below it stays in the queue rather than being
          indexed.
        </p>
      </Panel>
    </div>
  );
}

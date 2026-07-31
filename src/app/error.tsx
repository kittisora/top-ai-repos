'use client';

import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/base/buttons/button';

/**
 * Route-level error boundary.
 *
 * Most database failures never get here — pages read through `query()`, which
 * turns them into a setup notice. What lands here is the genuinely unexpected:
 * a render-time bug, or a module that failed to evaluate. The digest is the
 * only handle on the server-side stack in production, so it is shown.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ailist] unhandled render error:', error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center sm:px-6">
      <TriangleAlert className="size-7 text-warning-primary" aria-hidden="true" />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Something broke</h1>
      <p className="mt-2 text-sm text-tertiary">
        This page failed to render. Retrying re-runs the request; if it keeps failing, the
        server console has the full stack.
      </p>

      {error.digest ? (
        <p className="num mt-3 rounded border border-secondary bg-primary px-2 py-1 font-mono text-xs text-quaternary">
          digest {error.digest}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button color="primary" onClick={reset}>
          Try again
        </Button>
        <Button href="/" color="secondary">
          Go home
        </Button>
      </div>
    </div>
  );
}

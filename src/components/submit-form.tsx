'use client';

import { CircleCheck, Send, TriangleAlert } from 'lucide-react';
import { useActionState, useState } from 'react';

import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { TextArea } from '@/components/base/textarea/textarea';

/**
 * Submit a missing repository.
 *
 * Posts to the existing `/api/submissions` route rather than duplicating the
 * insert in a Server Action: the route already does URL normalisation, the
 * duplicate check and the race-free upsert, and a second code path would drift.
 *
 * `useActionState` is doing real work here — it gives the pending flag and
 * survives the submit without a `useEffect`, and the action is a plain async
 * function so all the response-shape handling stays in one place.
 */

interface SubmitState {
  status: 'idle' | 'success' | 'error';
  message: string;
  /** Per-field messages from the API's zod validation. */
  fieldErrors?: Record<string, string>;
  submitted?: { fullName: string; url: string };
  /** Kept so a failed submit does not wipe what the user typed. */
  values?: { url: string; note: string };
}

const INITIAL: SubmitState = { status: 'idle', message: '' };

interface ApiErrorBody {
  error?: string;
  issues?: { field: string; message: string }[];
}

async function submit(_previous: SubmitState, formData: FormData): Promise<SubmitState> {
  const url = String(formData.get('url') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  const values = { url, note };

  if (url === '') {
    return {
      status: 'error',
      message: 'Enter a GitHub repository URL.',
      fieldErrors: { url: 'A repository URL is required.' },
      values,
    };
  }

  let response: Response;
  try {
    response = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(note ? { url, note } : { url }),
    });
  } catch {
    return {
      status: 'error',
      message: 'Could not reach the server. Check your connection and try again.',
      values,
    };
  }

  if (response.ok) {
    const created = (await response.json()) as { fullName: string; url: string };
    return {
      status: 'success',
      message: 'Submitted for review.',
      submitted: created,
    };
  }

  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  const fieldErrors: Record<string, string> = {};
  for (const issue of body.issues ?? []) {
    fieldErrors[issue.field] = issue.message;
  }

  return {
    status: 'error',
    message:
      body.error ??
      (response.status === 409
        ? 'That repository has already been submitted.'
        : 'The submission was rejected.'),
    fieldErrors,
    values,
  };
}

/**
 * `useActionState` has no reset, so "submit another" bumps a key and remounts
 * the inner form. Navigating to /submit again would not work — the route is
 * already current, so nothing unmounts and the success panel would stick.
 */
export function SubmitForm() {
  const [instance, setInstance] = useState(0);
  return <SubmitFormInstance key={instance} onReset={() => setInstance((n) => n + 1)} />;
}

function SubmitFormInstance({ onReset }: { onReset: () => void }) {
  const [state, formAction, isPending] = useActionState(submit, INITIAL);

  if (state.status === 'success' && state.submitted) {
    return (
      <div
        role="status"
        className="rounded-lg border border-secondary bg-success-secondary px-5 py-6 text-center"
      >
        <CircleCheck className="mx-auto size-6 text-success-primary" aria-hidden="true" />
        <h2 className="mt-2 text-sm font-semibold">
          {state.submitted.fullName} is queued for review
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-tertiary">
          It will be fetched, classified and scored on the next ingestion run. Submissions are
          checked against the star threshold before they are indexed.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button href="/repos" color="secondary">
            Back to the explorer
          </Button>
          <Button color="tertiary" onClick={onReset}>
            Submit another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* UUI Input/TextArea render real named inputs, so the Server Action still
          reads `url` and `note` straight off the FormData. */}
      <Input
        name="url"
        type="text"
        label="Repository URL"
        isRequired
        defaultValue={state.values?.url ?? ''}
        placeholder="https://github.com/owner/name"
        isInvalid={Boolean(state.fieldErrors?.url)}
        hint={
          state.fieldErrors?.url ?? 'A full URL, an SSH remote or just owner/name.'
        }
        inputClassName="font-mono"
        autoComplete="off"
        // react-aria types this as the HTML attribute, i.e. a string.
        spellCheck="false"
        maxLength={300}
      />

      <TextArea
        name="note"
        label="Note (optional)"
        rows={3}
        maxLength={2000}
        defaultValue={state.values?.note ?? ''}
        placeholder="Anything the reviewer should know — what it does, why it belongs here."
        isInvalid={Boolean(state.fieldErrors?.note)}
        hint={state.fieldErrors?.note}
      />

      {state.status === 'error' ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-error bg-error-primary px-3 py-2 text-sm text-tertiary"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-error-primary" aria-hidden="true" />
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" isDisabled={isPending} color="primary" iconLeading={Send}>
          {isPending ? 'Submitting…' : 'Submit repository'}
        </Button>
        <p aria-live="polite" className="text-xs text-quaternary">
          {isPending ? 'Checking the URL and the queue…' : null}
        </p>
      </div>
    </form>
  );
}

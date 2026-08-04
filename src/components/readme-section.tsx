'use client';

import { Code2, Eye } from 'lucide-react';
import { useState } from 'react';

import { cn, formatNumber } from '@/lib/utils';

// Route-scoped rather than global: this pulls in github-markdown-css, which is
// only meaningful where a README is rendered. See the note in the file itself.
import '@/styles/readme.css';

type ReadmeMode = 'preview' | 'source';

export function ReadmeSection({
  fullName,
  excerpt,
  readmeLength,
  renderedHtml,
}: {
  fullName: string;
  excerpt: string;
  readmeLength: number | null;
  renderedHtml: string | null;
}) {
  const [mode, setMode] = useState<ReadmeMode>(renderedHtml ? 'preview' : 'source');

  const footer = `Excerpt of ${formatNumber(readmeLength)} characters`;

  return (
    <section aria-labelledby="readme-heading">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 id="readme-heading" className="text-sm font-semibold">
          From the README
        </h2>

        <div
          className="inline-flex rounded-md border border-secondary bg-secondary p-0.5"
          role="group"
          aria-label="README display mode"
        >
          <ModeButton
            active={mode === 'preview'}
            onClick={() => setMode('preview')}
            label="Preview"
            Icon={Eye}
            disabled={!renderedHtml}
          />
          <ModeButton
            active={mode === 'source'}
            onClick={() => setMode('source')}
            label="Source"
            Icon={Code2}
          />
        </div>
      </div>

      <div className="github-readme-shell rounded-lg border p-4 sm:p-6 lg:p-8">
        {mode === 'preview' && renderedHtml ? (
          <div
            className="readme-preview overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-7 text-tertiary">
            {excerpt}
          </pre>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-secondary pt-3 text-xs text-quaternary">
          <p>
            {mode === 'preview' ? 'Rendered by GitHub from the current README' : footer}
          </p>
          <a
            href={`https://github.com/${fullName}#readme`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-secondary hover:underline"
          >
            Read on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  Icon,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  Icon: typeof Eye;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary shadow-sm' : 'text-tertiary hover:text-primary',
        disabled && 'cursor-not-allowed opacity-40',
      )}
      title={disabled ? 'GitHub-rendered preview is temporarily unavailable' : label}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

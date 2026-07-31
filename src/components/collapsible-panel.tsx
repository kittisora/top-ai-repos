'use client';

import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Mobile disclosure for the filter sidebar.
 *
 * Only the *visibility* is client state — the filters themselves live in the
 * URL, so nothing here can get out of sync with what is on screen. Implemented
 * with useState rather than <details> because the newer `::details-content`
 * behaviour cannot be forced open from CSS at the lg breakpoint.
 */
export function CollapsiblePanel({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-secondary',
          'bg-primary px-3 py-2 text-sm font-medium hover:border-primary lg:hidden',
        )}
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-quaternary" aria-hidden="true" />
          {label}
        </span>
        <ChevronDown
          className={cn('size-4 text-quaternary transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      <div id={panelId} className={cn('lg:block', open ? 'mt-2 block' : 'hidden')}>
        {children}
      </div>
    </div>
  );
}

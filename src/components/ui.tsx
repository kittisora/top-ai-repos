import Link from 'next/link';
import type { FC, ReactNode } from 'react';

import { Button } from '@/components/base/buttons/button';
import { cn } from '@/lib/utils';

type ButtonIcon = FC<{ className?: string }> | ReactNode;

/**
 * The small shared vocabulary every page is built from, styled with the
 * Untitled UI design tokens (text-primary/secondary/tertiary, bg-primary/
 * secondary, border-secondary, bg-brand-solid, …). Deliberately one file: these
 * are twenty-line presentational pieces and splitting them across a dozen
 * modules would cost more in import noise than it buys.
 */

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Panel({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'aside';
}) {
  return (
    <Tag className={cn('rounded-xl border border-secondary bg-primary shadow-xs', className)}>
      {children}
    </Tag>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
  id,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight text-primary">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-sm text-tertiary">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons and links
// ---------------------------------------------------------------------------

const BUTTON_BASE =
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-semibold ' +
  'transition duration-100 ease-linear disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Untitled UI button looks as plain className strings, because most call sites
 * apply them to native <button>/<Link> elements (and add sizing like `h-8`).
 */
export const buttonStyles = {
  primary: cn(
    BUTTON_BASE,
    'bg-brand-solid px-3.5 py-2 text-white shadow-xs ring-1 ring-transparent hover:bg-brand-solid_hover',
  ),
  secondary: cn(
    BUTTON_BASE,
    'bg-primary px-3.5 py-2 text-secondary shadow-xs ring-1 ring-inset ring-primary hover:bg-primary_hover',
  ),
  ghost: cn(
    BUTTON_BASE,
    'bg-transparent px-2.5 py-1.5 text-tertiary hover:bg-primary_hover hover:text-secondary',
  ),
} as const;

/** Our three variants map onto Untitled UI Button colours. */
const VARIANT_COLOR = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'tertiary',
} as const;

export function LinkButton({
  href,
  children,
  variant = 'secondary',
  size = 'md',
  iconLeading,
  iconTrailing,
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof buttonStyles;
  size?: 'sm' | 'md' | 'lg';
  /** Icons go through the Button's slots, never as children — raw icon
   * children break the Button's inline layout (they stack). */
  iconLeading?: ButtonIcon;
  iconTrailing?: ButtonIcon;
  className?: string;
}) {
  const external = href.startsWith('http');
  return (
    <Button
      href={href}
      color={VARIANT_COLOR[variant]}
      size={size}
      iconLeading={iconLeading}
      iconTrailing={iconTrailing}
      className={className}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  hint,
  href,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  emphasis?: boolean;
}) {
  const body = (
    <>
      <dt className="text-[0.6875rem] font-medium uppercase tracking-wider text-quaternary">
        {label}
      </dt>
      <dd
        className={cn(
          'num mt-1 text-2xl font-semibold tracking-tight text-primary',
          emphasis && 'text-brand-secondary',
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="mt-0.5 text-xs text-tertiary">{hint}</dd> : null}
    </>
  );

  const className = 'block rounded-xl border border-secondary bg-primary px-3.5 py-3 shadow-xs transition';

  return href ? (
    <Link href={href} className={cn(className, 'hover:border-primary hover:bg-secondary')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

// ---------------------------------------------------------------------------
// Empty / error states
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-primary bg-secondary px-6 py-12 text-center">
      <h3 className="text-sm font-semibold text-primary">{title}</h3>
      {children ? (
        <div className="mx-auto mt-2 max-w-prose text-sm text-tertiary">{children}</div>
      ) : null}
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-secondary bg-secondary px-1.5 py-0.5 font-mono text-[0.8125em] text-secondary">
      {children}
    </code>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-secondary', className)} aria-hidden="true" />;
}

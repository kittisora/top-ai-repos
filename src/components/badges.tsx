import Link from 'next/link';

import { Badge } from '@/components/base/badges/badges';
import { cn, formatDelta } from '@/lib/utils';
import type { LicenseClass } from '@/lib/scoring';

// ---------------------------------------------------------------------------
// QualityBadge
// ---------------------------------------------------------------------------

/** The A–F ramp mapped onto Untitled UI badge colours. */
const GRADE_COLOR: Record<string, 'success' | 'blue' | 'warning' | 'orange' | 'error'> = {
  A: 'success',
  B: 'blue',
  C: 'warning',
  D: 'orange',
  F: 'error',
};

const GRADE_MEANING: Record<string, string> = {
  A: 'Actively maintained, broad contributor base, clear licensing',
  B: 'Solid — a weak spot or two',
  C: 'Usable but with real gaps',
  D: 'Several adoption risks',
  F: 'Stale, undocumented or legally awkward',
};

/**
 * Colour is never the only signal: the letter is always printed (and the score
 * at `md`), so a red/green-blind reader loses nothing.
 */
export function QualityBadge({
  grade,
  score,
  size = 'sm',
  className,
}: {
  grade: string | null;
  score: number | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  if (!grade || score === null) {
    return (
      <span title="Not scored yet — quality is computed after the first full sync">
        <Badge type="pill-color" color="gray" size={size}>
          <span className="num">—</span>
        </Badge>
      </span>
    );
  }

  const letter = grade.toUpperCase();

  return (
    <span
      title={`Quality ${letter} · ${score}/100 — ${GRADE_MEANING[letter] ?? 'quality grade'}`}
      className={cn('inline-flex', className)}
    >
      <Badge type="pill-color" color={GRADE_COLOR[letter] ?? 'gray'} size={size}>
        <span aria-hidden="true">{letter}</span>
        {size === 'md' ? <span className="num ml-1 opacity-80">{score}</span> : null}
        <span className="sr-only">
          quality grade {letter}, {score} out of 100
        </span>
      </Badge>
    </span>
  );
}

// ---------------------------------------------------------------------------
// TrendBadge — a signed star delta over a named window (text, not a pill)
// ---------------------------------------------------------------------------

export function TrendBadge({
  value,
  window,
  className,
}: {
  value: number;
  window: 'today' | 'this week' | 'this month';
  className?: string;
}) {
  const moved = value !== 0;
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 whitespace-nowrap text-xs',
        moved ? (value > 0 ? 'text-success-primary' : 'text-error-primary') : 'text-quaternary',
        className,
      )}
    >
      <span className="num font-semibold">{formatDelta(value)}</span>
      <span className="text-quaternary">{window}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// CategoryPill
// ---------------------------------------------------------------------------

export function CategoryPill({
  name,
  href,
  primary = false,
  count,
  className,
}: {
  name: string;
  href?: string;
  /** The repo's primary category is filled brand; secondaries are grey. */
  primary?: boolean;
  count?: number;
  className?: string;
}) {
  const badge = (
    <Badge type="pill-color" color={primary ? 'brand' : 'gray'} size="sm">
      <span className="truncate">{name}</span>
      {count !== undefined ? <span className="num ml-1 opacity-70">{count}</span> : null}
    </Badge>
  );

  return href ? (
    <Link href={href} className={cn('inline-flex max-w-full', className)}>
      {badge}
    </Link>
  ) : (
    <span className={cn('inline-flex max-w-full', className)}>{badge}</span>
  );
}

// ---------------------------------------------------------------------------
// License
// ---------------------------------------------------------------------------

const LICENSE_LABEL: Record<LicenseClass, string> = {
  permissive: 'Permissive',
  'weak-copyleft': 'Weak copyleft',
  'strong-copyleft': 'Strong copyleft',
  'non-commercial': 'Non-commercial',
  other: 'Other licence',
  none: 'No licence',
};

/** Plain-English answer to "can I ship this?", which the SPDX id alone is not. */
const LICENSE_HINT: Record<LicenseClass, string> = {
  permissive: 'Usable in commercial products with attribution',
  'weak-copyleft': 'File-level copyleft — changes to the library must be shared',
  'strong-copyleft': 'Derivative works must be released under the same licence',
  'non-commercial': 'Commercial use is restricted by the licence',
  other: 'Licence terms need review before adoption',
  none: 'No licence file — default copyright applies, all rights reserved',
};

const LICENSE_COLOR: Record<LicenseClass, 'success' | 'blue' | 'warning' | 'orange' | 'gray' | 'error'> = {
  permissive: 'success',
  'weak-copyleft': 'blue',
  'strong-copyleft': 'warning',
  'non-commercial': 'orange',
  other: 'gray',
  none: 'error',
};

export function LicenseBadge({
  licenseClass,
  spdxId,
  className,
}: {
  licenseClass: LicenseClass;
  spdxId?: string | null;
  className?: string;
}) {
  return (
    <span title={LICENSE_HINT[licenseClass]} className={cn('inline-flex', className)}>
      <Badge type="color" color={LICENSE_COLOR[licenseClass]} size="sm">
        {spdxId?.trim() ? spdxId : LICENSE_LABEL[licenseClass]}
      </Badge>
    </span>
  );
}

export { LICENSE_LABEL, LICENSE_HINT };

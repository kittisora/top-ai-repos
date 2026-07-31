import type { RepoMetricPoint } from '@/lib/queries';
import { cn, formatDelta, formatNumber } from '@/lib/utils';

/**
 * 90-day star history, hand-rolled as inline SVG in a server component.
 *
 * No charting library: none is installed, and a sparkline is ~30 lines of
 * arithmetic. The SVG carries only the geometry - every label is real HTML
 * around it, because the chart uses `preserveAspectRatio="none"` to stretch to
 * the container width and text inside would be squashed with it.
 *
 * A freshly-ingested repo has zero or one snapshot. That is the normal case for
 * the first week of a new index, so it gets an explicit "collecting history"
 * state rather than an axis drawn through a single point.
 */

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 32;

export function StarHistoryChart({
  points,
  className,
  label = 'Star history, last 90 days',
}: {
  points: RepoMetricPoint[];
  className?: string;
  label?: string;
}) {
  if (points.length < 2) {
    return (
      <div
        className={cn(
          'flex h-32 flex-col items-center justify-center gap-1 rounded-md border',
          'border-dashed border-primary bg-secondary text-center',
          className,
        )}
      >
        <p className="text-sm font-medium">Collecting history</p>
        <p className="max-w-xs text-xs text-tertiary">
          {points.length === 1
            ? 'One daily snapshot so far. The chart appears once there are at least two.'
            : 'Daily snapshots start with the next sync run.'}
        </p>
      </div>
    );
  }

  const values = points.map((point) => point.stars);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A repo that gained nothing in 90 days has min === max; without this the
  // normalisation divides by zero and every point lands at NaN.
  const span = max - min || 1;
  const flat = max === min;

  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * VIEW_WIDTH;
    const y = flat
      ? VIEW_HEIGHT / 2
      : VIEW_HEIGHT - ((point.stars - min) / span) * (VIEW_HEIGHT - 2) - 1;
    return `${x.toFixed(3)},${y.toFixed(3)}`;
  });

  const line = coords.join(' ');
  const area = `${VIEW_WIDTH},${VIEW_HEIGHT} 0,${VIEW_HEIGHT}`;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const gained = last.stars - first.stars;
  const gradientId = `star-history-${first.recordedOn}-${points.length}`;

  return (
    <figure className={cn('rounded-md border border-secondary bg-primary p-3', className)}>
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-xs font-medium text-tertiary">{label}</span>
        <span className="num text-xs">
          <span className={gained > 0 ? 'text-success-primary' : 'text-quaternary'}>
            {formatDelta(gained)}
          </span>{' '}
          <span className="text-quaternary">over {points.length} snapshots</span>
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-28 w-full text-brand-secondary"
        role="img"
        aria-label={`${label}: ${formatNumber(first.stars)} stars on ${first.recordedOn} rising to ${formatNumber(last.stars)} on ${last.recordedOn}.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Mid gridline. `vector-effect` keeps every stroke 1px wide despite the
            non-uniform scaling that makes the chart fill its container. */}
        <line
          x1="0"
          y1={VIEW_HEIGHT / 2}
          x2={VIEW_WIDTH}
          y2={VIEW_HEIGHT / 2}
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />

        <polygon points={`${line} ${area}`} fill={`url(#${gradientId})`} />

        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-2 flex items-end justify-between text-xs text-quaternary">
        <span className="num">
          {first.recordedOn} {'\u00B7'} {formatNumber(first.stars)}
        </span>
        <span className="num">
          {last.recordedOn} {'\u00B7'}{' '}
          <span className="text-primary">{formatNumber(last.stars)}</span>
        </span>
      </div>

      {/* The visual is decorative for a screen reader; the numbers are not. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Stars</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.recordedOn}>
              <td>{point.recordedOn}</td>
              <td>{point.stars}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

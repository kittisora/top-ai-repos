/**
 * The ingestion pipeline.
 *
 * Stage order matters and is not arbitrary:
 *
 *   discover → sync → metrics → snapshot → classify → score
 *
 * `sync` fills in the metadata `snapshot` records, `snapshot` computes the star
 * deltas `score` consumes, and `classify` needs the README that `sync` fetched.
 * Running `score` before `snapshot` produces a table full of zeroed trend
 * scores that look plausible and are wrong.
 *
 * `metrics` is the late addition and sits where it does for one reason: `sync`
 * only reaches a rotation's worth of repos per run, so the star counts it leaves
 * behind are up to eight days old, and `snapshot` records whatever is on the row
 * at the moment it runs. Refreshing the four volatile counters across the WHOLE
 * table first is what makes the recorded history daily rather than weekly.
 */

export { classify } from './classify';
export type { ClassifyOptions, ClassifyStats } from './classify';
export {
  backfillContributors,
  backfillOwnerCountries,
  enrichContributorProfiles,
} from './contributors';
export type {
  BackfillContributorsOptions,
  BackfillContributorsStats,
  EnrichStats,
  OwnerCountryStats,
} from './contributors';
export { discover, splitShard } from './discover';
export type { DiscoverOptions, DiscoverStats } from './discover';
export { refreshMetrics } from './metrics';
export type { RefreshMetricsOptions, RefreshMetricsStats } from './metrics';
export { parseDate, releaseConflictingFullNames } from './repos';
export { withRun } from './run';
export type { JobContext, JobStats } from './run';
export { score } from './score';
export type { ScoreOptions, ScoreStats } from './score';
export { snapshot } from './snapshot';
export type { SnapshotOptions, SnapshotStats } from './snapshot';
export { sync } from './sync';
export type { SyncOptions, SyncStats } from './sync';

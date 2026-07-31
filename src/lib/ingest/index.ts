/**
 * The ingestion pipeline.
 *
 * Stage order matters and is not arbitrary:
 *
 *   discover → sync → snapshot → classify → score
 *
 * `sync` fills in the metadata `snapshot` records, `snapshot` computes the star
 * deltas `score` consumes, and `classify` needs the README that `sync` fetched.
 * Running `score` before `snapshot` produces a table full of zeroed trend
 * scores that look plausible and are wrong.
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
export { parseDate, releaseConflictingFullNames } from './repos';
export { withRun } from './run';
export type { JobContext, JobStats } from './run';
export { score } from './score';
export type { ScoreOptions, ScoreStats } from './score';
export { snapshot } from './snapshot';
export type { SnapshotOptions, SnapshotStats } from './snapshot';
export { sync } from './sync';
export type { SyncOptions, SyncStats } from './sync';

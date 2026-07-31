/**
 * Trend and quality scoring.
 *
 * Two different questions, two different scores — conflating them is the main
 * failure mode of every "AI list" site:
 *
 *   trendScore   — "is this moving right now?"  Unbounded, comparative, resets
 *                  as momentum fades. Answers: what should I look at today.
 *   qualityScore — "would I bet a product on this?"  Bounded 0..100, slow
 *                  moving. Answers: is this safe to adopt.
 *
 * A repo can be high-trend and low-quality (a demo that hit the front page) or
 * low-trend and high-quality (a boring, essential library). Ranking by stars
 * alone finds neither.
 *
 * Everything here is a pure function of already-fetched data, so it is cheap
 * to recompute for the whole table after each sync and trivial to unit test.
 */

const DAY_MS = 86_400_000;

function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / DAY_MS;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Maps 0..Infinity onto 0..1 with diminishing returns; `mid` scores 0.5. */
function saturate(value: number, mid: number): number {
  if (value <= 0) return 0;
  return value / (value + mid);
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export interface TrendInput {
  stars: number;
  /** Stars gained in the last ~24h, from the metrics snapshots. */
  starsDay: number;
  /** Stars gained in the last ~7d. */
  starsWeek: number;
  /** Contributors gained in the last ~7d. May be 0 if not tracked yet. */
  contributorsWeek?: number;
  /** When the most recent release was published. */
  latestReleaseAt?: Date | null;
  /** Last push to the default branch. */
  pushedAt?: Date | null;
  createdAt?: Date | null;
  isArchived?: boolean;
  /** Defaults to now; injectable so tests and batch runs are deterministic. */
  now?: Date;
}

export interface TrendBreakdown {
  score: number;
  /** Growth relative to existing size — surfaces small fast risers. */
  velocity: number;
  components: {
    daily: number;
    weekly: number;
    contributors: number;
    release: number;
    inactivityPenalty: number;
    noveltyBonus: number;
  };
}

/**
 * Momentum score. Deliberately unbounded — it is only ever used to sort
 * against other repos in the same time window, never displayed as an absolute.
 */
export function computeTrendScore(input: TrendInput): TrendBreakdown {
  const now = input.now ?? new Date();

  // An archived repo has no momentum worth surfacing, whatever the numbers say.
  if (input.isArchived) {
    return {
      score: 0,
      velocity: 0,
      components: {
        daily: 0,
        weekly: 0,
        contributors: 0,
        release: 0,
        inactivityPenalty: 0,
        noveltyBonus: 0,
      },
    };
  }

  // Snapshots can go backwards (stars get removed, or a backfill lands late).
  // Negative growth is real but shouldn't produce negative momentum.
  const starsDay = Math.max(0, input.starsDay);
  const starsWeek = Math.max(0, input.starsWeek);
  const contributorsWeek = Math.max(0, input.contributorsWeek ?? 0);

  // Today is weighted heavily: it is the freshest signal we have.
  const daily = starsDay * 4;
  const weekly = starsWeek;
  // A new contributor is a much rarer event than a star, so it is worth more.
  const contributors = contributorsWeek * 10;

  // A recent release means the project is shipping, not just accumulating stars.
  let release = 0;
  if (input.latestReleaseAt) {
    const age = daysBetween(now, input.latestReleaseAt);
    if (age <= 7) release = 60;
    else if (age <= 30) release = 35;
    else if (age <= 90) release = 15;
    else if (age <= 180) release = 5;
  }

  // Stars keep arriving for a while after a project goes quiet. Discount them.
  let inactivityPenalty = 0;
  if (input.pushedAt) {
    const idle = daysBetween(now, input.pushedAt);
    if (idle > 365) inactivityPenalty = 250;
    else if (idle > 180) inactivityPenalty = 120;
    else if (idle > 90) inactivityPenalty = 50;
    else if (idle > 30) inactivityPenalty = 15;
  }

  // A repo three weeks old gaining 200 stars/day is a bigger story than a
  // five-year-old repo doing the same. Scale the bonus by actual momentum so
  // this can't be farmed by creating empty repos.
  let noveltyBonus = 0;
  if (input.createdAt) {
    const age = daysBetween(now, input.createdAt);
    if (age <= 90 && starsWeek > 0) {
      noveltyBonus = starsWeek * (1 - age / 90) * 1.5;
    }
  }

  const score = Math.max(
    0,
    daily + weekly + contributors + release + noveltyBonus - inactivityPenalty,
  );

  // Velocity is the growth rate net of existing size: weekly stars over the
  // base the repo already had. Sorting by this finds the risers that raw
  // counts bury under the incumbents.
  const base = Math.max(50, input.stars - starsWeek);
  const velocity = Number((starsWeek / base).toFixed(5));

  return {
    score: Number(score.toFixed(2)),
    velocity,
    components: {
      daily,
      weekly,
      contributors,
      release,
      inactivityPenalty,
      noveltyBonus: Number(noveltyBonus.toFixed(2)),
    },
  };
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

/**
 * SPDX identifiers grouped by what they mean for someone adopting the code.
 * "Can I ship this in a commercial product without legal review?" is the real
 * question, and it is the one most directory sites refuse to answer.
 */
const PERMISSIVE = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Unlicense',
  'CC0-1.0',
  '0BSD',
  'MIT-0',
  'BSL-1.0',
  'Zlib',
  'PostgreSQL',
  'Python-2.0',
]);

const WEAK_COPYLEFT = new Set([
  'MPL-2.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'LGPL-2.1-only',
  'LGPL-3.0-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-or-later',
  'EPL-2.0',
  'CDDL-1.0',
]);

const STRONG_COPYLEFT = new Set([
  'GPL-2.0',
  'GPL-3.0',
  'GPL-2.0-only',
  'GPL-3.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-or-later',
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
]);

export type LicenseClass =
  | 'permissive'
  | 'weak-copyleft'
  | 'strong-copyleft'
  | 'non-commercial'
  | 'other'
  | 'none';

export function classifyLicense(spdxId?: string | null): LicenseClass {
  // Covers null, undefined and '' — all mean "we have no license identifier".
  if (!spdxId) return 'none';
  const id = spdxId.trim();
  if (id === '') return 'none';
  // GitHub returns this for repos with a LICENSE file it can't identify.
  if (id === 'NOASSERTION') return 'other';
  if (PERMISSIVE.has(id)) return 'permissive';
  if (WEAK_COPYLEFT.has(id)) return 'weak-copyleft';
  if (STRONG_COPYLEFT.has(id)) return 'strong-copyleft';
  // Creative-Commons NC/ND and the various "open weights, no commercial use"
  // licenses are a genuine adoption blocker and deserve their own flag.
  if (/^CC-BY(-SA)?-/.test(id)) return 'other';
  if (/NC|ND/.test(id)) return 'non-commercial';
  return 'other';
}

export interface QualityInput {
  stars: number;
  forks: number;
  openIssues: number;
  contributorsCount?: number | null;
  /** Contributions by the single most active contributor, if known. */
  topContributorShare?: number | null;
  pushedAt?: Date | null;
  createdAt?: Date | null;
  latestReleaseAt?: Date | null;
  releasesLastYear?: number | null;
  licenseSpdxId?: string | null;
  readmeLength?: number | null;
  hasHomepage?: boolean;
  hasDescription?: boolean;
  topicsCount?: number;
  isArchived?: boolean;
  isFork?: boolean;
  now?: Date;
}

export interface QualityBreakdown {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  licenseClass: LicenseClass;
  /** Each 0..1, before weighting — good for a radar chart on the detail page. */
  dimensions: {
    maintenance: number;
    releases: number;
    community: number;
    responsiveness: number;
    documentation: number;
    licensing: number;
  };
  /** Plain-language reasons, shown directly in the UI. */
  flags: string[];
}

/** Weights sum to 100. Maintenance dominates because staleness kills adoption. */
const WEIGHTS = {
  maintenance: 26,
  releases: 14,
  community: 20,
  responsiveness: 14,
  documentation: 14,
  licensing: 12,
} as const;

export function computeQualityScore(input: QualityInput): QualityBreakdown {
  const now = input.now ?? new Date();
  const flags: string[] = [];

  // --- maintenance: how recently was this actually touched -----------------
  let maintenance = 0;
  if (input.pushedAt) {
    const idle = daysBetween(now, input.pushedAt);
    if (idle <= 7) maintenance = 1;
    else if (idle <= 30) maintenance = 0.9;
    else if (idle <= 90) maintenance = 0.7;
    else if (idle <= 180) maintenance = 0.45;
    else if (idle <= 365) maintenance = 0.2;
    else maintenance = 0.05;

    if (idle > 365) flags.push('No commits in over a year');
    else if (idle > 180) flags.push('No commits in 6+ months');
  } else {
    flags.push('Unknown last-commit date');
  }

  // --- releases: is it shipping versioned artifacts ------------------------
  let releases = 0;
  if (input.latestReleaseAt) {
    const age = daysBetween(now, input.latestReleaseAt);
    const recency =
      age <= 30 ? 1 : age <= 90 ? 0.85 : age <= 180 ? 0.6 : age <= 365 ? 0.35 : 0.15;
    const cadence = saturate(input.releasesLastYear ?? 1, 4);
    releases = 0.65 * recency + 0.35 * cadence;
    if (age > 365) flags.push('No release in over a year');
  } else {
    // Plenty of excellent libraries never cut GitHub releases, so this is a
    // soft signal, not a zero.
    releases = 0.25;
    flags.push('No tagged releases');
  }

  // --- community: how many people, and how concentrated --------------------
  const contributors = input.contributorsCount ?? 0;
  const breadth = saturate(contributors, 12);
  let concentration = 0.5;
  if (input.topContributorShare != null && contributors > 0) {
    // A single author writing 100% of the commits is a real bus-factor risk.
    concentration = clamp(1 - (input.topContributorShare - 0.4) / 0.55, 0, 1);
    if (input.topContributorShare >= 0.9 && contributors > 1) {
      flags.push('Bus factor of 1 — one contributor dominates');
    }
  } else if (contributors === 1) {
    concentration = 0.15;
    flags.push('Single contributor');
  }
  const community = 0.6 * breadth + 0.4 * concentration;

  // --- responsiveness: is the issue tracker under control ------------------
  // Absolute open-issue counts are meaningless without scale, so compare the
  // backlog to the size of the audience.
  let responsiveness = 0.5;
  if (input.stars > 0) {
    const ratio = input.openIssues / Math.max(1, input.stars);
    responsiveness =
      ratio <= 0.01 ? 1 : ratio <= 0.03 ? 0.85 : ratio <= 0.06 ? 0.6 : ratio <= 0.12 ? 0.35 : 0.15;
    if (ratio > 0.12 && input.openIssues > 100) {
      flags.push('Large open-issue backlog relative to audience');
    }
  }

  // --- documentation: can someone actually get started ---------------------
  const readmeLength = input.readmeLength ?? 0;
  let documentation = saturate(readmeLength, 3000);
  if (input.hasHomepage) documentation = Math.min(1, documentation + 0.15);
  if (input.hasDescription) documentation = Math.min(1, documentation + 0.05);
  if ((input.topicsCount ?? 0) >= 3) documentation = Math.min(1, documentation + 0.05);
  if (readmeLength < 500) flags.push('Minimal or missing README');

  // --- licensing: can you legally use it -----------------------------------
  const licenseClass = classifyLicense(input.licenseSpdxId);
  const licensing = {
    permissive: 1,
    'weak-copyleft': 0.8,
    'strong-copyleft': 0.55,
    other: 0.35,
    'non-commercial': 0.15,
    none: 0,
  }[licenseClass];

  if (licenseClass === 'none') {
    flags.push('No license — all rights reserved by default, not safe to reuse');
  } else if (licenseClass === 'non-commercial') {
    flags.push('License restricts commercial use');
  } else if (licenseClass === 'strong-copyleft') {
    flags.push('Copyleft license — derivative works must be open-sourced');
  }

  const dimensions = {
    maintenance,
    releases,
    community,
    responsiveness,
    documentation,
    licensing,
  };

  let score =
    dimensions.maintenance * WEIGHTS.maintenance +
    dimensions.releases * WEIGHTS.releases +
    dimensions.community * WEIGHTS.community +
    dimensions.responsiveness * WEIGHTS.responsiveness +
    dimensions.documentation * WEIGHTS.documentation +
    dimensions.licensing * WEIGHTS.licensing;

  // Hard states that no amount of dimension scoring should paper over.
  if (input.isArchived) {
    score *= 0.35;
    flags.push('Archived by the owner — read-only');
  }
  if (input.isFork) {
    score *= 0.8;
    flags.push('Fork of another repository');
  }

  const rounded = Math.round(clamp(score, 0, 100));
  const grade: QualityBreakdown['grade'] =
    rounded >= 80 ? 'A' : rounded >= 65 ? 'B' : rounded >= 50 ? 'C' : rounded >= 35 ? 'D' : 'F';

  return { score: rounded, grade, licenseClass, dimensions, flags };
}

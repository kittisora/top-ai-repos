import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyLicense,
  computeQualityScore,
  computeTrendScore,
} from './scoring.ts';

/** Fixed clock so every expectation is deterministic. */
const NOW = new Date('2026-07-24T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('computeTrendScore', () => {
  it('scores an actively growing repo above a flat one', () => {
    const hot = computeTrendScore({
      stars: 5_000,
      starsDay: 300,
      starsWeek: 1_500,
      pushedAt: daysAgo(1),
      now: NOW,
    });
    const flat = computeTrendScore({
      stars: 5_000,
      starsDay: 1,
      starsWeek: 4,
      pushedAt: daysAgo(1),
      now: NOW,
    });
    assert.ok(hot.score > flat.score * 50);
  });

  it('zeroes out archived repositories regardless of growth', () => {
    const result = computeTrendScore({
      stars: 40_000,
      starsDay: 900,
      starsWeek: 5_000,
      pushedAt: daysAgo(1),
      isArchived: true,
      now: NOW,
    });
    assert.equal(result.score, 0);
    assert.equal(result.velocity, 0);
  });

  it('penalises repos that have gone quiet', () => {
    const base = {
      stars: 10_000,
      starsDay: 20,
      starsWeek: 100,
      now: NOW,
    };
    const active = computeTrendScore({ ...base, pushedAt: daysAgo(2) });
    const stale = computeTrendScore({ ...base, pushedAt: daysAgo(400) });
    assert.ok(stale.score < active.score);
    assert.equal(stale.components.inactivityPenalty, 250);
    assert.equal(active.components.inactivityPenalty, 0);
  });

  it('never returns a negative score', () => {
    const result = computeTrendScore({
      stars: 900,
      starsDay: 0,
      starsWeek: 1,
      pushedAt: daysAgo(900),
      now: NOW,
    });
    assert.ok(result.score >= 0);
  });

  it('treats snapshot regressions as zero growth, not negative', () => {
    const result = computeTrendScore({
      stars: 1_000,
      starsDay: -50,
      starsWeek: -120,
      pushedAt: daysAgo(1),
      now: NOW,
    });
    assert.ok(result.score >= 0);
    assert.equal(result.components.daily, 0);
    assert.equal(result.components.weekly, 0);
  });

  it('rewards a brand-new riser over an old repo with identical growth', () => {
    const shared = { stars: 2_000, starsDay: 100, starsWeek: 600, pushedAt: daysAgo(1), now: NOW };
    const fresh = computeTrendScore({ ...shared, createdAt: daysAgo(10) });
    const old = computeTrendScore({ ...shared, createdAt: daysAgo(2_000) });
    assert.ok(fresh.score > old.score);
    assert.ok(fresh.components.noveltyBonus > 0);
    assert.equal(old.components.noveltyBonus, 0);
  });

  it('does not hand a novelty bonus to a new repo with no traction', () => {
    const result = computeTrendScore({
      stars: 0,
      starsDay: 0,
      starsWeek: 0,
      createdAt: daysAgo(2),
      pushedAt: daysAgo(1),
      now: NOW,
    });
    assert.equal(result.components.noveltyBonus, 0);
  });

  it('surfaces small fast risers via velocity even when raw counts are small', () => {
    const small = computeTrendScore({
      stars: 400,
      starsDay: 40,
      starsWeek: 200,
      pushedAt: daysAgo(1),
      now: NOW,
    });
    const large = computeTrendScore({
      stars: 60_000,
      starsDay: 40,
      starsWeek: 200,
      pushedAt: daysAgo(1),
      now: NOW,
    });
    assert.ok(
      small.velocity > large.velocity * 100,
      `${small.velocity} vs ${large.velocity}`,
    );
  });

  it('credits a fresh release', () => {
    const withRelease = computeTrendScore({
      stars: 1_000,
      starsDay: 10,
      starsWeek: 50,
      pushedAt: daysAgo(1),
      latestReleaseAt: daysAgo(3),
      now: NOW,
    });
    assert.equal(withRelease.components.release, 60);
  });
});

describe('classifyLicense', () => {
  it('classifies the common families', () => {
    assert.equal(classifyLicense('MIT'), 'permissive');
    assert.equal(classifyLicense('Apache-2.0'), 'permissive');
    assert.equal(classifyLicense('MPL-2.0'), 'weak-copyleft');
    assert.equal(classifyLicense('GPL-3.0'), 'strong-copyleft');
    assert.equal(classifyLicense('AGPL-3.0'), 'strong-copyleft');
  });

  it('treats a missing license as "none", not as permissive', () => {
    assert.equal(classifyLicense(null), 'none');
    assert.equal(classifyLicense(undefined), 'none');
    assert.equal(classifyLicense(''), 'none');
    assert.equal(classifyLicense('   '), 'none');
  });

  it('flags GitHub\'s unidentifiable-license marker', () => {
    assert.equal(classifyLicense('NOASSERTION'), 'other');
  });

  it('flags non-commercial licenses', () => {
    assert.equal(classifyLicense('CC-BY-NC-4.0'), 'other');
    assert.equal(classifyLicense('SomeModel-NC-1.0'), 'non-commercial');
  });
});

describe('computeQualityScore', () => {
  const healthy = {
    stars: 20_000,
    forks: 2_000,
    openIssues: 150,
    contributorsCount: 400,
    topContributorShare: 0.15,
    pushedAt: daysAgo(1),
    createdAt: daysAgo(900),
    latestReleaseAt: daysAgo(10),
    releasesLastYear: 24,
    licenseSpdxId: 'Apache-2.0',
    readmeLength: 12_000,
    hasHomepage: true,
    hasDescription: true,
    topicsCount: 8,
    now: NOW,
  };

  it('grades a healthy flagship project highly', () => {
    const result = computeQualityScore(healthy);
    assert.ok(result.score >= 80, `expected A, got ${result.score}`);
    assert.equal(result.grade, 'A');
    assert.equal(result.licenseClass, 'permissive');
  });

  it('grades an abandoned unlicensed repo poorly and says why', () => {
    const result = computeQualityScore({
      stars: 3_000,
      forks: 200,
      openIssues: 600,
      contributorsCount: 1,
      pushedAt: daysAgo(800),
      latestReleaseAt: null,
      licenseSpdxId: null,
      readmeLength: 200,
      now: NOW,
    });
    assert.ok(result.score < 35, `expected F, got ${result.score}`);
    assert.equal(result.grade, 'F');
    assert.ok(result.flags.some((f) => f.includes('No license')));
    assert.ok(result.flags.some((f) => f.includes('over a year')));
    assert.ok(result.flags.some((f) => f.includes('README')));
  });

  it('keeps the score inside 0..100 for every dimension extreme', () => {
    const best = computeQualityScore({
      ...healthy,
      topContributorShare: 0.05,
      openIssues: 0,
      readmeLength: 500_000,
      releasesLastYear: 500,
    });
    const worst = computeQualityScore({
      stars: 0,
      forks: 0,
      openIssues: 99_999,
      contributorsCount: 0,
      pushedAt: daysAgo(5_000),
      licenseSpdxId: null,
      readmeLength: 0,
      isArchived: true,
      isFork: true,
      now: NOW,
    });
    for (const r of [best, worst]) {
      assert.ok(r.score >= 0 && r.score <= 100, `score out of range: ${r.score}`);
      for (const [k, v] of Object.entries(r.dimensions)) {
        assert.ok(v >= 0 && v <= 1, `dimension ${k} out of range: ${v}`);
      }
    }
  });

  it('heavily discounts archived repositories', () => {
    const live = computeQualityScore(healthy);
    const archived = computeQualityScore({ ...healthy, isArchived: true });
    assert.ok(archived.score < live.score * 0.5);
    assert.ok(archived.flags.some((f) => f.includes('Archived')));
  });

  it('flags a bus factor of one', () => {
    const result = computeQualityScore({
      ...healthy,
      contributorsCount: 3,
      topContributorShare: 0.96,
    });
    assert.ok(result.flags.some((f) => f.includes('Bus factor')));
  });

  it('judges the issue backlog relative to audience size, not absolutely', () => {
    // 500 open issues is healthy at 100k stars and alarming at 2k stars.
    const big = computeQualityScore({ ...healthy, stars: 100_000, openIssues: 500 });
    const small = computeQualityScore({ ...healthy, stars: 2_000, openIssues: 500 });
    assert.ok(big.dimensions.responsiveness > small.dimensions.responsiveness);
    assert.ok(small.flags.some((f) => f.includes('backlog')));
  });

  it('does not zero out a good library merely for having no tagged releases', () => {
    const result = computeQualityScore({ ...healthy, latestReleaseAt: null, releasesLastYear: 0 });
    assert.ok(result.score >= 65, `expected B or better, got ${result.score}`);
    assert.ok(result.flags.some((f) => f.includes('No tagged releases')));
  });

  it('ranks license classes in the right order, all else equal', () => {
    const at = (spdx: string | null) =>
      computeQualityScore({ ...healthy, licenseSpdxId: spdx }).dimensions.licensing;
    assert.ok(at('MIT') > at('MPL-2.0'));
    assert.ok(at('MPL-2.0') > at('GPL-3.0'));
    assert.ok(at('GPL-3.0') > at(null));
    assert.equal(at(null), 0);
  });
});

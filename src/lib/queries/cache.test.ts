import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { memoize } from './cache.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * These are the guarantees the site's read cost now depends on, so they are
 * asserted rather than assumed. Timings use a short TTL with a wide margin
 * (30ms window, 80ms wait) so the test is not sensitive to scheduler jitter.
 */
describe('memoize', () => {
  it('calls the loader once and reuses the value inside the window', async () => {
    let calls = 0;
    const load = memoize(async () => ++calls, 60_000);

    assert.equal(await load(), 1);
    assert.equal(await load(), 1);
    assert.equal(await load(), 1);
    assert.equal(calls, 1, 'loader should have run exactly once');
  });

  it('reloads after the window expires', async () => {
    let calls = 0;
    const load = memoize(async () => ++calls, 30);

    assert.equal(await load(), 1);
    await sleep(80);
    assert.equal(await load(), 2);
    assert.equal(calls, 2);
  });

  /**
   * The important one. A crawler burst or a cold deploy sends many concurrent
   * requests at an empty cache; without a shared in-flight promise each would
   * fire its own full-table scan, which is the exact IO spike this exists to
   * prevent.
   */
  it('collapses concurrent callers onto a single in-flight load', async () => {
    let calls = 0;
    const load = memoize(async () => {
      calls++;
      await sleep(20);
      return 'value';
    }, 60_000);

    const results = await Promise.all(Array.from({ length: 25 }, () => load()));

    assert.equal(calls, 1, '25 concurrent callers should share one query');
    assert.deepEqual(new Set(results), new Set(['value']));
  });

  it('does not cache a rejection, and retries on the next call', async () => {
    let calls = 0;
    const load = memoize(async () => {
      calls++;
      if (calls === 1) throw new Error('database unreachable');
      return 'recovered';
    }, 60_000);

    await assert.rejects(load, /database unreachable/);
    // A poisoned cache here would keep the site broken for the whole window.
    assert.equal(await load(), 'recovered');
    assert.equal(calls, 2);
  });

  it('rejects every concurrent caller when the shared load fails', async () => {
    let calls = 0;
    const load = memoize(async () => {
      calls++;
      await sleep(10);
      throw new Error('boom');
    }, 60_000);

    const settled = await Promise.allSettled([load(), load(), load()]);

    assert.equal(calls, 1);
    assert.deepEqual(
      settled.map((r) => r.status),
      ['rejected', 'rejected', 'rejected'],
    );
  });

  it('treats a zero TTL as "no caching", which is what the env override means', async () => {
    let calls = 0;
    const load = memoize(async () => ++calls, 0);

    assert.equal(await load(), 1);
    assert.equal(await load(), 2);
    assert.equal(calls, 2);
  });

  it('keeps separate memos independent', async () => {
    const a = memoize(async () => 'a', 60_000);
    const b = memoize(async () => 'b', 60_000);

    assert.equal(await a(), 'a');
    assert.equal(await b(), 'b');
  });
});

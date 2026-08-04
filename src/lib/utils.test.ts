import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { githubAvatarUrl } from './utils.ts';

/**
 * The interesting cases are all about the query string GitHub already puts on
 * these URLs — every real avatar arrives with `?v=4`, and profile pictures that
 * have been changed also carry a `u=` cache-buster. Appending rather than setting
 * would produce a duplicate `s=` that GitHub resolves in favour of the first,
 * silently reverting the whole optimisation.
 */
describe('githubAvatarUrl', () => {
  it('adds a size to the common ?v=4 form', () => {
    const out = githubAvatarUrl('https://avatars.githubusercontent.com/u/24270415?v=4', 56);
    const url = new URL(out);
    assert.equal(url.searchParams.get('s'), '56');
    assert.equal(url.searchParams.get('v'), '4', 'must not drop the existing params');
  });

  it('preserves the u= cache-buster on changed profile pictures', () => {
    const out = githubAvatarUrl(
      'https://avatars.githubusercontent.com/u/4921183?u=93c523908528108bd544b43ab2c50509725c7b87&v=4',
      48,
    );
    const url = new URL(out);
    assert.equal(url.searchParams.get('s'), '48');
    assert.equal(url.searchParams.get('u'), '93c523908528108bd544b43ab2c50509725c7b87');
    assert.equal(url.searchParams.get('v'), '4');
  });

  it('replaces an existing size rather than appending a second one', () => {
    const out = githubAvatarUrl('https://avatars.githubusercontent.com/u/1?v=4&s=460', 56);
    assert.equal(out.match(/[?&]s=/g)?.length, 1, 'exactly one s= parameter');
    assert.equal(new URL(out).searchParams.get('s'), '56');
  });

  it('adds a query string when there is none', () => {
    const out = githubAvatarUrl('https://avatars.githubusercontent.com/u/1', 96);
    assert.equal(out, 'https://avatars.githubusercontent.com/u/1?s=96');
  });

  it('rounds a fractional size, because GitHub wants an integer', () => {
    assert.equal(
      new URL(githubAvatarUrl('https://avatars.githubusercontent.com/u/1', 28 * 1.5)).searchParams.get(
        's',
      ),
      '42',
    );
  });

  it('leaves non-GitHub hosts completely alone', () => {
    const other = 'https://example.com/avatar.png?v=4';
    assert.equal(githubAvatarUrl(other, 56), other);
    // Guard against a sloppy substring check matching a lookalike host.
    const lookalike = 'https://avatars.githubusercontent.com.evil.test/u/1?v=4';
    assert.equal(githubAvatarUrl(lookalike, 56), lookalike);
  });

  it('returns unparseable input unchanged instead of throwing', () => {
    // A malformed value in the database must degrade to a broken image, not a
    // 500 on the whole listing.
    assert.equal(githubAvatarUrl('not a url', 56), 'not a url');
    assert.equal(githubAvatarUrl('', 56), '');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countryFromLocation, normalizeLocation } from './geo.ts';

describe('countryFromLocation', () => {
  it('reads plain country names', () => {
    assert.equal(countryFromLocation('Germany'), 'Germany');
    assert.equal(countryFromLocation('japan'), 'Japan');
    assert.equal(countryFromLocation('  France  '), 'France');
  });

  it('reads "City, Country" from the trailing segment', () => {
    assert.equal(countryFromLocation('Berlin, Germany'), 'Germany');
    assert.equal(countryFromLocation('Tokyo, Japan'), 'Japan');
    assert.equal(countryFromLocation('Bengaluru, India'), 'India');
  });

  it('maps well-known cities with no country given', () => {
    assert.equal(countryFromLocation('San Francisco'), 'United States');
    assert.equal(countryFromLocation('London'), 'United Kingdom');
    assert.equal(countryFromLocation('Shanghai'), 'China');
  });

  it('disambiguates same-named cities by their trailing segment', () => {
    assert.equal(countryFromLocation('Cambridge, MA'), 'United States');
    assert.equal(countryFromLocation('Cambridge, UK'), 'United Kingdom');
  });

  it('handles country codes and punctuated forms', () => {
    assert.equal(countryFromLocation('USA'), 'United States');
    assert.equal(countryFromLocation('U.S.A.'), 'United States');
    assert.equal(countryFromLocation('UK'), 'United Kingdom');
  });

  it('reads a flag emoji, which is the most explicit signal', () => {
    assert.equal(countryFromLocation('🇩🇪'), 'Germany');
    assert.equal(countryFromLocation('🇯🇵 Tokyo'), 'Japan');
    // The flag wins even when the text is unrecognisable.
    assert.equal(countryFromLocation('somewhere nice 🇧🇷'), 'Brazil');
  });

  it('strips decoration around an otherwise valid location', () => {
    assert.equal(countryFromLocation('Berlin, Germany 🇩🇪'), 'Germany');
    assert.equal(countryFromLocation('(Amsterdam)'), 'Netherlands');
    assert.equal(countryFromLocation('**Seoul**'), 'South Korea');
  });

  it('takes the current location from a "moved from -> to" string', () => {
    assert.equal(countryFromLocation('Berlin -> San Francisco'), 'United States');
    assert.equal(countryFromLocation('India → Canada'), 'Canada');
  });

  it('reads non-Latin names', () => {
    assert.equal(countryFromLocation('北京'), 'China');
    assert.equal(countryFromLocation('東京'), 'Japan');
    assert.equal(countryFromLocation('서울'), 'South Korea');
  });

  it('returns null for joke and non-place values rather than guessing', () => {
    for (const value of [
      'Remote',
      'worldwide',
      'The Internet',
      '127.0.0.1',
      '/dev/null',
      'your heart',
      'Mars',
      'unknown',
    ]) {
      assert.equal(countryFromLocation(value), null, `${value} should not resolve`);
    }
  });

  it('returns null for empty and missing input', () => {
    assert.equal(countryFromLocation(null), null);
    assert.equal(countryFromLocation(undefined), null);
    assert.equal(countryFromLocation(''), null);
    assert.equal(countryFromLocation('   '), null);
  });

  it('returns null for a genuinely unknown place instead of a wrong country', () => {
    assert.equal(countryFromLocation('Zzyzx Hollow'), null);
  });
});

describe('normalizeLocation city extraction', () => {
  it('extracts the city from "City, Country"', () => {
    assert.deepEqual(normalizeLocation('Berlin, Germany'), {
      country: 'Germany',
      city: 'Berlin',
    });
  });

  it('does not report the country as its own city', () => {
    const result = normalizeLocation('Germany');
    assert.equal(result.country, 'Germany');
    assert.equal(result.city, null);
  });

  it('does not duplicate a city that resolved on its own', () => {
    const result = normalizeLocation('San Francisco');
    assert.equal(result.country, 'United States');
    assert.equal(result.city, null);
  });
});

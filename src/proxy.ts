import { NextResponse, type NextRequest } from 'next/server';

import { OWNED_DOMAINS } from '@/lib/domains';
import { env } from '@/lib/env';

/**
 * Canonical-domain redirect (Next 16's `proxy`, formerly `middleware`).
 *
 * We own several domains that all point here. Serving the same content on all
 * of them splits SEO ranking and risks a duplicate-content penalty, so every
 * non-canonical owned domain — and any `www.` variant — is 301'd to the single
 * canonical host (whatever NEXT_PUBLIC_SITE_URL points at), preserving the path
 * and query string. Combined with the canonical <link> tags, this consolidates
 * all ranking onto one domain.
 *
 * In local dev the canonical host is localhost, which is in neither the owned
 * list nor a www variant, so this is a no-op — nothing redirects.
 */

const CANONICAL_HOST = new URL(env.siteUrl).host;
const OWNED = new Set<string>(OWNED_DOMAINS);

export function proxy(request: NextRequest): NextResponse {
  const host = (request.headers.get('host') ?? '').toLowerCase();
  const bare = host.replace(/^www\./, '');

  const isOwnedAlternate = OWNED.has(bare) && bare !== CANONICAL_HOST;
  const isWwwOfCanonical = host === `www.${CANONICAL_HOST}`;

  if (isOwnedAlternate || isWwwOfCanonical) {
    const url = request.nextUrl.clone();
    url.host = CANONICAL_HOST;
    url.protocol = 'https';
    url.port = '';
    // 308 = permanent redirect that preserves the method; Google treats it the
    // same as a 301 for ranking consolidation.
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  // Run on page routes; skip Next internals and anything with a file extension
  // (static assets don't need canonicalising and it keeps the redirect cheap).
  matcher: ['/((?!_next/|api/|.*\\.[^/]+$).*)'],
};

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Deliberately NOT enabling `cacheComponents`. It makes every route
  // dynamic-by-default and turns any un-Suspended data read into a build-time
  // error. This is a database-backed dashboard where nearly every page is a
  // fresh query — the caching model would be pure friction. Revisit once the
  // read patterns settle.
  //
  // `pg` is already in Next's auto-externalized list, so no
  // `serverExternalPackages` entry is needed.
  images: {
    remotePatterns: [
      // GitHub avatars for repo owners and contributors.
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
  experimental: {
    // The deployed tree is mounted read-only (see deploy/top-ai-repos.service),
    // but `next start` tries to flush the ISR prerender cache into
    // `.next/server/app/repos/<owner>/`, which fails on every single repo page —
    // it logged a "Failed to update prerender cache" error per request, hundreds
    // per hour, and never cached anything.
    //
    // Turning the disk flush off costs nothing measurable: the repeat-hit speedup
    // (~0.30s -> ~0.02s) comes from the in-memory ISR cache, which is unaffected.
    // The alternative — making `.next/server/app` writable — would hand the app
    // process write access to its own compiled page bundles, which is a far worse
    // trade than a cache that starts cold after a restart.
    isrFlushToDisk: false,
  },
};

export default nextConfig;

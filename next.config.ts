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
};

export default nextConfig;

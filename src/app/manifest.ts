import type { MetadataRoute } from 'next';

import { env } from '@/lib/env';

/**
 * Served at /manifest.webmanifest, and Next adds the <link rel="manifest">
 * automatically. Replaces the favicon.io site.webmanifest, which shipped with
 * an empty name and icon paths that pointed at the web root while the files
 * lived in a subfolder — i.e. it 404'd.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${env.siteName} — open-source AI repository discovery`,
    short_name: env.siteName,
    description:
      'Discover, compare and track open-source AI repositories on GitHub, ranked by ' +
      'momentum and scored on adoption risk.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0d12',
    theme_color: '#0b0d12',
    icons: [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { THEME_INIT_SCRIPT } from '@/components/theme-toggle';
import { env } from '@/lib/env';
import { SITE_DESCRIPTION, SITE_KEYWORDS, websiteJsonLd } from '@/lib/seo';

import './globals.css';

/**
 * next/font downloads and self-hosts these at build time and emits a CSS
 * variable, so the browser never talks to fonts.googleapis.com and there is no
 * render-blocking stylesheet. The variable names are what globals.css maps onto
 * --font-sans / --font-mono inside `@theme inline`.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

const TITLE = `${env.siteName} — open-source AI repositories, ranked`;

export const metadata: Metadata = {
  // Absolute base for every canonical and OG/Twitter URL. Without it Next emits
  // relative URLs that Google and social scrapers cannot resolve. Set
  // NEXT_PUBLIC_SITE_URL to the production domain before deploying.
  metadataBase: new URL(env.siteUrl),
  title: {
    default: TITLE,
    template: `%s · ${env.siteName}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: env.siteName,
  keywords: SITE_KEYWORDS,
  /**
   * Deliberately NO `alternates.canonical` here.
   *
   * Next merges metadata down the tree, so a canonical set on the root layout is
   * inherited by every page that does not set its own — which pointed /repos,
   * /categories, /contributors and /submit all at `/`, telling Google they were
   * duplicates of the homepage and should not be indexed separately. Each route
   * declares its own canonical instead (the homepage in ./page.tsx), so the
   * failure mode for a page that forgets is *no* canonical, which Google handles
   * by self-canonicalising — harmless — rather than a wrong one, which is not.
   */
  openGraph: {
    type: 'website',
    url: '/',
    siteName: env.siteName,
    title: TITLE,
    description: SITE_DESCRIPTION,
    locale: 'en_US',
    // Images are supplied automatically by app/opengraph-image.tsx.
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: SITE_DESCRIPTION,
  },
  // favicon.ico + PNGs live at the web root; the 192px icon is a multiple of
  // 48px, which is what Google requires to render a favicon in search results.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
      { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
      { url: '/android-chrome-192x192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#16181f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-scroll-behavior` restores instant scroll-to-top on navigation:
    // Next 16 no longer overrides a global `scroll-behavior: smooth` itself.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Runs before first paint so the dark theme never flashes light.
            It only toggles a class, so there is nothing user-controlled in it. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Site-level structured data: WebSite + sitelinks SearchAction and the
            publishing Organization. Static, server-serialised — safe to inline. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd()) }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} min-h-screen font-sans antialiased`}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-secondary focus:bg-primary focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>

        <div className="flex min-h-screen flex-col">
          <Header />
          {/* The header is a fixed floating pill (out of flow), so main pads its
              own top by the header's full height to clear it. Each page adds its
              own py-* on top of this, which supplies the visual gap. */}
          <main id="main" className="flex-1 pt-20">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { env } from '@/lib/env';

/**
 * The 1200x630 card shown when the site is shared or previewed in search.
 * Next wires it into both og:image and twitter:image automatically, so no
 * manual image URLs are needed in the metadata.
 *
 * Node runtime because it reads the logo off disk to embed as a data URI —
 * Satori cannot fetch a relative URL during static generation.
 */
export const runtime = 'nodejs';
export const alt = `${env.siteName} — discover and track open-source AI repositories on GitHub`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), 'public', 'logo.png'));
  const logoSrc = `data:image/png;base64,${logo.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #0b0d12 0%, #161a24 100%)',
          color: '#e6e8ee',
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          <img src={logoSrc} width={104} height={104} alt="" style={{ borderRadius: '22px' }} />
          <span style={{ fontSize: 64, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {env.siteName}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <span style={{ fontSize: 52, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            Discover, compare &amp; track open-source AI on GitHub
          </span>
          <span style={{ fontSize: 30, color: '#98a2b3', lineHeight: 1.3 }}>
            Ranked by momentum, scored on adoption risk — not just stars.
          </span>
        </div>

        <div style={{ display: 'flex', gap: '16px' }}>
          {['AI agents', 'LLMs', 'RAG', 'inference', 'vector DBs'].map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 24,
                color: '#c7cdd9',
                border: '1px solid #2b313d',
                borderRadius: '999px',
                padding: '8px 22px',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}

import 'server-only';

const API_VERSION = '2022-11-28';
const README_REVALIDATE_SECONDS = 6 * 60 * 60;
const REPOSITORY_PART = /^[a-z0-9_.-]+$/i;

/**
 * Fetch GitHub's own rendered README instead of trying to reproduce GFM.
 * GitHub sanitizes this HTML and resolves relative assets in repository context.
 */
export async function getRenderedReadme(fullName: string): Promise<string | null> {
  const [owner, repo, extra] = fullName.split('/');
  if (
    extra !== undefined ||
    !owner ||
    !repo ||
    !REPOSITORY_PART.test(owner) ||
    !REPOSITORY_PART.test(repo)
  ) {
    return null;
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.html+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'top-ai-repos/1.0',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
      {
        headers,
        next: { revalidate: README_REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) return null;

    const html = await response.text();
    if (!html.includes('class="markdown-body')) return null;
    // GitHub's rendered HTML keeps REPO-relative asset paths relative
    // (e.g. `assets/monty.svg`). On our origin those 404, so resolve them to
    // absolute GitHub URLs the way github.com's own frontend does.
    return absolutizeRelativeUrls(html, owner, repo);
  } catch {
    // The Source view remains available if GitHub is temporarily unreachable.
    return null;
  }
}

/** Already-absolute, in-page, or non-http schemes that must be left untouched. */
const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i;

function toRepoRootPath(url: string): string {
  // README relative paths are resolved from the repo root; `./x` and `/x` both
  // mean `x` at the root on GitHub.
  return url.replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Rewrite relative `src` / `srcset` / `href` in GitHub's README HTML to
 * absolute URLs: images to raw.githubusercontent.com (so they load as files),
 * links to the blob view. Uses the `HEAD` ref so it always tracks the default
 * branch. External URLs (incl. camo-proxied badges) and `#` anchors are left
 * alone. Regex is acceptable here because the input is GitHub-sanitised HTML.
 */
function absolutizeRelativeUrls(html: string, owner: string, repo: string): string {
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`;
  const blobBase = `https://github.com/${owner}/${repo}/blob/HEAD/`;

  const rewriteSrc = (attr: string, url: string) =>
    ABSOLUTE_URL.test(url) ? `${attr}="${url}"` : `${attr}="${rawBase}${toRepoRootPath(url)}"`;

  return html
    .replace(/\b(src|poster)="([^"]*)"/gi, (_m, attr: string, url: string) => rewriteSrc(attr, url))
    .replace(/\bsrcset="([^"]*)"/gi, (_m, value: string) => {
      const rewritten = value
        .split(',')
        .map((candidate) => {
          const parts = candidate.trim().split(/\s+/);
          if (parts[0] && !ABSOLUTE_URL.test(parts[0])) {
            parts[0] = `${rawBase}${toRepoRootPath(parts[0])}`;
          }
          return parts.join(' ');
        })
        .join(', ');
      return `srcset="${rewritten}"`;
    })
    .replace(/\bhref="([^"]*)"/gi, (_m, url: string) =>
      ABSOLUTE_URL.test(url) ? `href="${url}"` : `href="${blobBase}${toRepoRootPath(url)}"`,
    );
}

/**
 * Tailwind CSS v4. Note two things that break if you follow older guides:
 *   - do NOT add `autoprefixer`; @tailwindcss/postcss vendors via Lightning CSS
 *   - do NOT use the `tailwindcss` package itself as a PostCSS plugin
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;

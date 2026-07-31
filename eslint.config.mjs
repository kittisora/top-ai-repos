import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// eslint-config-next 16 ships flat config directly via subpath exports, so no
// FlatCompat/@eslint/eslintrc shim is needed.
//
// Note: `next lint` was removed in Next 16 and `next build` no longer runs the
// linter. This only runs via `npm run lint`.
const config = [
  {
    // A standalone ignore object applies globally to every imported flat
    // config, including eslint-config-next's React rules.
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'next-env.d.ts',
      'src/components/base/**',
      'src/components/application/**',
    ],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    // These directories are upstream Untitled UI source kept verbatim. Lint
    // the product components that consume them, but do not make releases
    // depend on rewriting vendored internals for each React lint-rule update.
    rules: {
      // These effects deliberately synchronize uncontrolled browser/UI state
      // after navigation, media-query changes, or localStorage hydration.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;

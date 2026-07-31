import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// eslint-config-next 16 ships flat config directly via subpath exports, so no
// FlatCompat/@eslint/eslintrc shim is needed.
//
// Note: `next lint` was removed in Next 16 and `next build` no longer runs the
// linter. This only runs via `npm run lint`.
export default [
  ...coreWebVitals,
  ...nextTypescript,
  {
    ignores: ['.next/**', 'node_modules/**', 'drizzle/**', 'next-env.d.ts'],
  },
];

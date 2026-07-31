/**
 * Barrel for the read layer. Route handlers and server components should import
 * from '@/lib/queries' rather than reaching into the individual modules, so the
 * file layout can change without touching call sites.
 */

export {
  getRepositoryByFullName,
  getTrendingRepositories,
  listRepositories,
  type CategoryAssignment,
  type CategoryRef,
  type RepoContributor,
  type RepoListItem,
  type RepoListParams,
  type RepoListResult,
  type RepoMetricPoint,
  type RepoSort,
  type RepositoryDetail,
  type TrendingWindow,
} from './repositories';

export {
  getCategoryStats,
  type CategoryGroupStats,
  type CategoryStat,
} from './categories';

export {
  getTopContributors,
  type TopContributor,
  type TopContributorsParams,
  type TopContributorsResult,
} from './contributors';

export {
  getCountryStats,
  getGlobalStats,
  getLanguages,
  type CountryStat,
  type GlobalStats,
  type LanguageStat,
} from './stats';

/**
 * Classify — assign taxonomy categories to repositories.
 *
 * Rules first, LLM only where the rules are genuinely unsure. `classifyByRules`
 * scores author-declared GitHub topics 10x higher than prose matches, so for
 * the majority of repos it is both free and more trustworthy than a model — a
 * repo that declares `topic:vllm` is not ambiguous.
 *
 * The LLM path exists for the long tail: repos with no topics and a one-line
 * description, where the rule scorer returns two near-tied categories. That is
 * what a confidence below 0.5 means here — not "low score", but "the winner did
 * not separate from the runner-up".
 *
 * Two invariants this module must never break:
 *   - a row whose source is 'manual' is never overwritten or deleted;
 *   - a repo whose inputs have not changed is never re-classified, which is
 *     what makes a nightly run cost ~$0 instead of ~$3.
 */

import { createHash } from 'node:crypto';

import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import { categories, db, repositories, repositoryCategories } from '@/db';
import { env } from '@/lib/env';
import { CATEGORIES, classifyByRules } from '@/lib/taxonomy';
import { chunk, mapLimit, sleep } from '@/lib/utils';

/** Below this the rule classifier is guessing between near-tied categories. */
const LLM_THRESHOLD = 0.5;

/** Rows are 6 columns; 1,000 per statement is 6,000 bind params. */
const ASSIGNMENT_CHUNK = 1_000;

/** How many repos share one delete+insert transaction. */
const WRITE_CHUNK = 500;

const MAX_SECONDARY = 3;

// ---------------------------------------------------------------------------
// Structured output schema
// ---------------------------------------------------------------------------

/**
 * The enum is BUILT FROM THE TAXONOMY, never hand-copied. A duplicated list
 * drifts the first time someone adds a category, and the model then confidently
 * returns a slug that has no row in `categories`.
 *
 * Structured Outputs currently allow up to 1,000 enum values, so the whole
 * taxonomy fits many times over.
 */
const CATEGORY_SLUGS = CATEGORIES.map((category) => category.slug) as [string, ...string[]];

/**
 * Strict mode forbids validation keywords entirely: `.min()`, `.max()`,
 * `.regex()` and friends emit `minimum`/`maximum`/`pattern`, and the request
 * 400s. It also has no optional properties — `.nullable()` is the only way to
 * express "may be absent", and the key still appears in `required`.
 *
 * Property order is output order, so `evidence` comes FIRST: the model writes
 * its justification before committing to a label, which conditions the label on
 * the reasoning rather than the reverse.
 */
const RepoClassification = z.object({
  evidence: z.string().nullable(),
  primary_category: z.enum(CATEGORY_SLUGS),
  secondary_categories: z.array(z.enum(CATEGORY_SLUGS)),
  confidence: z.number(),
  is_ai_related: z.boolean(),
});

type RepoClassificationOutput = z.infer<typeof RepoClassification>;

/** Hoisted: one identical format object reused across every call in the run. */
const FORMAT = zodTextFormat(RepoClassification, 'repo_classification');

const INSTRUCTIONS = [
  'You categorise open-source AI/ML repositories for a directory.',
  'Choose exactly one primary category — the one a developer looking for this',
  'project would browse. Add secondary categories only when the project genuinely',
  'spans them; an empty list is the normal answer.',
  'If the repository is not AI/ML related at all, set is_ai_related to false.',
  'Put the concrete signal you used (topics, described purpose) in evidence.',
].join(' ');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassifyOptions {
  /** How many repos to consider this run. */
  limit?: number;
  /** Parallel OpenAI calls. Tier 1 keys should stay near 8. */
  concurrency?: number;
  /** Re-classify even when the input fingerprint is unchanged. */
  force?: boolean;
  log?: (message: string) => void;
}

export interface ClassifyStats extends Record<string, number | string> {
  considered: number;
  cached: number;
  ruleClassified: number;
  llmClassified: number;
  llmFailed: number;
  unclassified: number;
  assignmentsWritten: number;
  manualPreserved: number;
}

interface Candidate {
  id: number;
  fullName: string;
  name: string;
  description: string | null;
  topics: string[];
  language: string | null;
  readmeExcerpt: string | null;
}

interface Assignment {
  repositoryId: number;
  categoryId: number;
  isPrimary: boolean;
  confidence: number;
  source: string;
  evidence: string[];
}

// ---------------------------------------------------------------------------
// Fingerprinting — the classification cache
// ---------------------------------------------------------------------------

/**
 * A stable hash of everything the classifiers actually read. Stored as the
 * first element of `evidence`, which means the cache lives alongside the row it
 * describes and needs no extra column: if the stored fingerprint matches the
 * one we just computed, nothing the classifier looks at has changed and there
 * is no work to do.
 *
 * Topics are sorted because GitHub returns them in insertion order, which
 * shuffles for reasons that have nothing to do with the repo's meaning.
 */
function fingerprint(candidate: Candidate): string {
  const payload = JSON.stringify([
    candidate.name,
    candidate.description ?? '',
    [...candidate.topics].sort(),
    candidate.language ?? '',
    // Only the head of the README is ever scored, so only the head belongs in
    // the fingerprint — otherwise a changed footer forces a pointless re-run.
    (candidate.readmeExcerpt ?? '').slice(0, 4_000),
  ]);
  return `fp:${createHash('sha1').update(payload).digest('hex').slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

let client: OpenAI | null = null;

function openai(): OpenAI {
  // maxRetries: 0 because the backoff below is the only retrier — leaving the
  // SDK default of 2 gives 2xN multiplicative retries and worsens throttling.
  client ??= new OpenAI({ apiKey: env.openaiApiKey, maxRetries: 0, timeout: 60_000 });
  return client;
}

/**
 * Reasoning tokens bill at the OUTPUT rate and are invisible in the response, so
 * effort is pinned as low as the model allows for what is a labelling task.
 *
 * 'minimal', NOT 'none': gpt-5-mini rejects 'none' outright with
 * `Unsupported value: 'none' is not supported with the 'gpt-5-mini' model.
 * Supported values are: 'minimal', 'low', 'medium', and 'high'.` — every request
 * 400s. Non-reasoning models reject the parameter entirely, hence the family
 * check, and the flag below drops it for the rest of the run if the API still
 * disagrees.
 */
const REASONING_EFFORT = 'minimal' as const;

let reasoningSupported = /^(gpt-5|o[134])/.test(env.openaiModel);

async function classifyWithLlm(candidate: Candidate): Promise<RepoClassificationOutput | null> {
  const input = [
    `repo: ${candidate.fullName}`,
    `language: ${candidate.language ?? 'unknown'}`,
    `topics: ${candidate.topics.join(', ') || 'none'}`,
    `description: ${candidate.description ?? ''}`,
    `readme: ${(candidate.readmeExcerpt ?? '').slice(0, 2_000)}`,
  ].join('\n');

  const response = await withBackoff(async () => {
    try {
      return await openai().responses.parse({
        model: env.openaiModel,
        instructions: INSTRUCTIONS,
        input,
        max_output_tokens: 300,
        text: { format: FORMAT },
        ...(reasoningSupported ? { reasoning: { effort: REASONING_EFFORT } } : {}),
      });
    } catch (error) {
      if (reasoningSupported && isUnsupportedReasoning(error)) {
        reasoningSupported = false;
        return openai().responses.parse({
          model: env.openaiModel,
          instructions: INSTRUCTIONS,
          input,
          max_output_tokens: 300,
          text: { format: FORMAT },
        });
      }
      throw error;
    }
  });

  // A structurally valid parse can still be missing: truncation shows up as
  // status 'incomplete', and a safety refusal never reaches output_parsed.
  if (response.status === 'incomplete') {
    throw new Error(`incomplete response: ${response.incomplete_details?.reason ?? 'unknown'}`);
  }
  return response.output_parsed ?? null;
}

/**
 * Does this 400 mean "drop the reasoning parameter and retry"?
 *
 * Matching only on the word "reasoning" was not enough: the real rejection reads
 * `Unsupported value: 'none' is not supported with the 'gpt-5-mini' model.
 * Supported values are: 'minimal', 'low', ...` and never mentions reasoning at
 * all, so the retry never fired and every single request failed. Match the
 * effort-value shape too.
 */
function isUnsupportedReasoning(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError) || error.status !== 400) return false;
  return (
    /reasoning/i.test(error.message) ||
    /unsupported value[^]*\b(minimal|low|medium|high)\b/i.test(error.message)
  );
}

/** Random exponential backoff, the shape OpenAI's own reference implementation uses. */
async function withBackoff<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      const retryable =
        error instanceof OpenAI.APIConnectionError ||
        status === 408 ||
        status === 409 ||
        status === 429 ||
        (status !== undefined && status >= 500);

      if (!retryable || attempt === attempts - 1) throw error;
      await sleep(Math.min(60_000, 1_000 * 2 ** attempt) * (0.5 + Math.random()));
    }
  }
  throw new Error('unreachable');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function classify(options: ClassifyOptions = {}): Promise<ClassifyStats> {
  const log = options.log ?? ((message: string) => console.log(`  ${message}`));
  const limit = options.limit ?? 5_000;
  const concurrency = options.concurrency ?? 8;
  const force = options.force ?? false;

  const stats: ClassifyStats = {
    considered: 0,
    cached: 0,
    ruleClassified: 0,
    llmClassified: 0,
    llmFailed: 0,
    unclassified: 0,
    assignmentsWritten: 0,
    manualPreserved: 0,
  };

  const categoryRows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);

  if (categoryRows.length === 0) {
    throw new Error('categories table is empty — run `npm run seed` first');
  }
  const categoryIdBySlug = new Map(categoryRows.map((row) => [row.slug, row.id]));

  // Least-recently-classified first, never-classified before everything.
  //
  // The README is truncated IN SQL, not in JS: excerpts are 8,000 characters
  // and the rule scorer only ever reads the first 4,000, so selecting the full
  // column would drag ~120 MB across the wire for a 15,000-repo table to throw
  // half of it away.
  //
  // Caveat worth knowing: a repo that no classifier can place writes no rows,
  // so it sorts first again next run. If `unclassified` ever approaches the
  // limit, later repos are being starved and the taxonomy needs a look.
  const candidates: Candidate[] = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      name: repositories.name,
      description: repositories.description,
      topics: repositories.topics,
      language: repositories.language,
      readmeExcerpt: sql<string | null>`substring(${repositories.readmeExcerpt} from 1 for 4000)`,
    })
    .from(repositories)
    .where(eq(repositories.status, 'active'))
    // Least-recently-ATTEMPTED first (indexed), never-attempted before all.
    // Deliberately not "least recently assigned": a repo the classifier cannot
    // place writes no assignment rows, so that ordering left its key permanently
    // NULL and re-sent it to the LLM on every single run.
    .orderBy(sql`${repositories.classifiedAt} asc nulls first, ${repositories.id} asc`)
    .limit(limit);

  stats.considered = candidates.length;
  if (candidates.length === 0) {
    log('nothing to classify');
    return stats;
  }

  // Existing assignments, for the cache check and the manual-row guard.
  const existing = new Map<number, { categoryId: number; source: string; evidence: string[] }[]>();
  for (const batch of chunk(candidates, 2_000)) {
    const rows = await db
      .select({
        repositoryId: repositoryCategories.repositoryId,
        categoryId: repositoryCategories.categoryId,
        source: repositoryCategories.source,
        evidence: repositoryCategories.evidence,
      })
      .from(repositoryCategories)
      .where(
        inArray(
          repositoryCategories.repositoryId,
          batch.map((candidate) => candidate.id),
        ),
      );
    for (const row of rows) {
      const list = existing.get(row.repositoryId) ?? [];
      list.push({ categoryId: row.categoryId, source: row.source, evidence: row.evidence });
      existing.set(row.repositoryId, list);
    }
  }

  // ------------------------------------------------------------ cache pass --
  const pending: { candidate: Candidate; fp: string; manual: Set<number> }[] = [];

  for (const candidate of candidates) {
    const rows = existing.get(candidate.id) ?? [];
    const manual = new Set(rows.filter((row) => row.source === 'manual').map((r) => r.categoryId));
    const automatic = rows.filter((row) => row.source !== 'manual');

    if (manual.size > 0) stats.manualPreserved += manual.size;

    // A repo curated entirely by hand is never touched, whatever the rules say.
    if (rows.length > 0 && automatic.length === 0) {
      stats.cached++;
      continue;
    }

    const fp = fingerprint(candidate);
    const unchanged =
      !force && automatic.length > 0 && automatic.every((row) => row.evidence.includes(fp));

    if (unchanged) {
      stats.cached++;
      continue;
    }

    pending.push({ candidate, fp, manual });
  }

  log(`${pending.length} to classify, ${stats.cached} cached`);

  // ------------------------------------------------------------ rules pass --
  const assignments: Assignment[] = [];
  const escalate: { candidate: Candidate; fp: string; manual: Set<number> }[] = [];

  for (const item of pending) {
    const result = classifyByRules({
      name: item.candidate.name,
      description: item.candidate.description,
      topics: item.candidate.topics,
      readme: item.candidate.readmeExcerpt,
      language: item.candidate.language,
    });

    if (result.primary && result.confidence >= LLM_THRESHOLD) {
      pushRuleAssignments(assignments, item, result, categoryIdBySlug);
      stats.ruleClassified++;
      continue;
    }

    if (env.enableLlmClassify) {
      escalate.push(item);
      continue;
    }

    // No LLM available: a low-confidence rule answer still beats nothing, and
    // the stored confidence tells the UI (and a future reviewer) not to trust it.
    if (result.primary) {
      pushRuleAssignments(assignments, item, result, categoryIdBySlug);
      stats.ruleClassified++;
    } else {
      stats.unclassified++;
    }
  }

  // -------------------------------------------------------------- llm pass --
  if (escalate.length > 0) {
    log(`escalating ${escalate.length} ambiguous repo(s) to ${env.openaiModel}`);
    let done = 0;

    await mapLimit(escalate, concurrency, async (item) => {
      try {
        const result = await classifyWithLlm(item.candidate);
        if (!result || !result.is_ai_related) {
          stats.unclassified++;
          return;
        }

        const primaryId = categoryIdBySlug.get(result.primary_category);
        if (primaryId === undefined) {
          // The enum makes this impossible unless the taxonomy and the
          // categories table have drifted — which is exactly when we want to
          // know rather than silently drop the answer.
          throw new Error(`unknown category slug ${result.primary_category}`);
        }

        const evidence = [item.fp, `llm:${result.evidence ?? 'no evidence given'}`.slice(0, 500)];
        const confidence = Number.isFinite(result.confidence)
          ? Math.min(1, Math.max(0, result.confidence))
          : 0.5;

        if (!item.manual.has(primaryId)) {
          assignments.push({
            repositoryId: item.candidate.id,
            categoryId: primaryId,
            isPrimary: true,
            confidence,
            source: 'llm',
            evidence,
          });
        }

        for (const slug of result.secondary_categories.slice(0, MAX_SECONDARY)) {
          const id = categoryIdBySlug.get(slug);
          if (id === undefined || id === primaryId || item.manual.has(id)) continue;
          assignments.push({
            repositoryId: item.candidate.id,
            categoryId: id,
            isPrimary: false,
            confidence: confidence * 0.6,
            source: 'llm',
            evidence,
          });
        }

        stats.llmClassified++;
      } catch (error) {
        // One refusal, timeout or exhausted-retry must not lose the other 4,999.
        stats.llmFailed++;
        log(
          `llm failed for ${item.candidate.fullName}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      } finally {
        done++;
        if (done % 100 === 0) log(`llm progress ${done}/${escalate.length}`);
      }
    });
  }

  // ----------------------------------------------------------------- write --
  /**
   * Deduplicate on (repository, category) BEFORE the insert.
   *
   * `ON CONFLICT DO UPDATE` cannot touch the same row twice inside one
   * statement — Postgres raises 21000, "ON CONFLICT DO UPDATE command cannot
   * affect row a second time" — and it fails the WHOLE batch, not the offending
   * row. Nothing for those repos persists, so they stay uncategorised, sort
   * first again on the next run (no rows means no assigned_at) and get re-sent
   * to the LLM forever. That loop burned ~11,700 calls to produce 1,023 labels.
   *
   * The duplicate comes from the model: `secondary_categories` is a plain enum
   * array, so it can legitimately repeat a slug or echo the primary back. Rules
   * never hit this because their secondaries come from distinct score entries.
   * First write wins, which keeps the primary (it is pushed first).
   */
  const seenPair = new Set<string>();
  const deduped: Assignment[] = [];
  for (const row of assignments) {
    const key = `${row.repositoryId}:${row.categoryId}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    deduped.push(row);
  }
  if (deduped.length !== assignments.length) {
    log(`dropped ${assignments.length - deduped.length} duplicate category assignment(s)`);
  }

  const touched = [...new Set(deduped.map((row) => row.repositoryId))];
  const byRepo = new Map<number, Assignment[]>();
  for (const row of deduped) {
    const list = byRepo.get(row.repositoryId) ?? [];
    list.push(row);
    byRepo.set(row.repositoryId, list);
  }

  for (const repoBatch of chunk(touched, WRITE_CHUNK)) {
    const rows = repoBatch.flatMap((id) => byRepo.get(id) ?? []);

    await db.transaction(async (tx) => {
      // Replace, don't merge: a category the classifier no longer believes in
      // must disappear, or every re-run leaves the old label behind forever.
      // `ne(source, 'manual')` is what keeps curated rows out of the blast radius.
      await tx
        .delete(repositoryCategories)
        .where(
          and(
            inArray(repositoryCategories.repositoryId, repoBatch),
            ne(repositoryCategories.source, 'manual'),
          ),
        );

      for (const insertBatch of chunk(rows, ASSIGNMENT_CHUNK)) {
        await tx
          .insert(repositoryCategories)
          .values(insertBatch)
          .onConflictDoUpdate({
            target: [repositoryCategories.repositoryId, repositoryCategories.categoryId],
            set: {
              isPrimary: sql`excluded.is_primary`,
              confidence: sql`excluded.confidence`,
              source: sql`excluded.source`,
              evidence: sql`excluded.evidence`,
              assignedAt: sql`now()`,
            },
            // Belt and braces: manual rows are already filtered out above, but
            // this makes it impossible for a future edit here to clobber one.
            setWhere: sql`repository_categories.source <> 'manual'`,
          });
      }
    });

    stats.assignmentsWritten += rows.length;
  }

  /**
   * Stamp every repo we ATTEMPTED, including the ones nothing could be assigned
   * to. This is what stops an unplaceable repo — the LLM answering
   * `is_ai_related: false`, or the rules finding nothing — from keeping a NULL
   * ordering key, sorting first on the next run, and being paid for again and
   * again. Uses `pending`, not `touched`: the point is the attempt, not the
   * outcome.
   */
  const attempted = pending.map((item) => item.candidate.id);
  for (const batch of chunk(attempted, WRITE_CHUNK)) {
    await db
      .update(repositories)
      .set({ classifiedAt: new Date() })
      .where(inArray(repositories.id, batch));
  }

  log(
    `rules ${stats.ruleClassified}, llm ${stats.llmClassified}, ` +
      `failed ${stats.llmFailed}, unclassified ${stats.unclassified}, ` +
      `rows ${stats.assignmentsWritten}`,
  );
  return stats;
}

function pushRuleAssignments(
  out: Assignment[],
  item: { candidate: Candidate; fp: string; manual: Set<number> },
  result: ReturnType<typeof classifyByRules>,
  categoryIdBySlug: ReadonlyMap<string, number>,
): void {
  if (!result.primary) return;
  const primaryId = categoryIdBySlug.get(result.primary);
  if (primaryId === undefined) return;

  const top = result.scores[0];
  // The matched topics/keywords go into the row so a wrong label can be
  // explained without re-running the classifier.
  const evidence = [item.fp, ...(top?.matched ?? []).slice(0, 8)];

  if (!item.manual.has(primaryId)) {
    out.push({
      repositoryId: item.candidate.id,
      categoryId: primaryId,
      isPrimary: true,
      confidence: result.confidence,
      source: 'rule',
      evidence,
    });
  }

  for (const slug of result.secondary.slice(0, MAX_SECONDARY)) {
    const id = categoryIdBySlug.get(slug);
    if (id === undefined || id === primaryId || item.manual.has(id)) continue;
    const scored = result.scores.find((entry) => entry.slug === slug);
    out.push({
      repositoryId: item.candidate.id,
      categoryId: id,
      isPrimary: false,
      confidence: Number((result.confidence * 0.6).toFixed(3)),
      source: 'rule',
      evidence: [item.fp, ...(scored?.matched ?? []).slice(0, 6)],
    });
  }
}

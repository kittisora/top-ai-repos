import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALL_TOPICS,
  CATEGORIES,
  CATEGORY_BY_SLUG,
  GROUPS,
  categoriesInGroup,
  classifyByRules,
  scoreCategories,
} from './taxonomy.ts';

describe('taxonomy integrity', () => {
  it('has unique category slugs', () => {
    const slugs = CATEGORIES.map((c) => c.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it('assigns every category to a real group', () => {
    const groups = new Set(GROUPS.map((g) => g.slug));
    for (const category of CATEGORIES) {
      assert.ok(groups.has(category.group), `${category.slug} -> ${category.group}`);
    }
  });

  it('places every category in exactly one group bucket', () => {
    const total = GROUPS.reduce((n, g) => n + categoriesInGroup(g.slug).length, 0);
    assert.equal(total, CATEGORIES.length);
  });

  it('gives every category topics and keywords to match on', () => {
    for (const category of CATEGORIES) {
      assert.ok(category.topics.length > 0, `${category.slug} has no topics`);
      assert.ok(category.keywords.length > 0, `${category.slug} has no keywords`);
    }
  });

  it('deduplicates the discovery topic list', () => {
    assert.equal(new Set(ALL_TOPICS).size, ALL_TOPICS.length);
    assert.ok(ALL_TOPICS.length > 50);
  });

  it('exposes a working slug lookup', () => {
    assert.equal(CATEGORY_BY_SLUG.get('agents')?.group, 'application-development');
    assert.equal(CATEGORY_BY_SLUG.get('nope'), undefined);
  });
});

describe('keyword matching respects token boundaries', () => {
  it('does not let "rag" match inside "storage"', () => {
    const scores = scoreCategories({
      name: 'storage-engine',
      description: 'A distributed storage engine with durable storage guarantees.',
    });
    assert.equal(
      scores.find((s) => s.slug === 'rag'),
      undefined,
      'substring match leaked into the rag category',
    );
  });

  it('does not let "ann" match inside "channel"', () => {
    const scores = scoreCategories({
      name: 'channel-utils',
      description: 'Channel and banner management helpers.',
    });
    const vectors = scores.find((s) => s.slug === 'vector-databases');
    assert.equal(vectors, undefined);
  });

  it('treats hyphens and spaces as interchangeable', () => {
    const hyphen = scoreCategories({ name: 'x', description: 'a fine-tuning toolkit' });
    const space = scoreCategories({ name: 'x', description: 'a fine tuning toolkit' });
    const pick = (s: ReturnType<typeof scoreCategories>) =>
      s.find((x) => x.slug === 'fine-tuning')?.score ?? 0;
    assert.ok(pick(hyphen) > 0);
    assert.equal(pick(hyphen), pick(space));
  });
});

describe('classifyByRules', () => {
  it('lets author-declared topics dominate prose', () => {
    const result = classifyByRules({
      name: 'thing',
      description: 'A library.',
      topics: ['vector-database', 'similarity-search'],
    });
    assert.equal(result.primary, 'vector-databases');
    assert.ok(result.confidence > 0.5);
  });

  it('classifies a clear agent framework', () => {
    const result = classifyByRules({
      name: 'crewai',
      description:
        'Framework for orchestrating role-playing, autonomous AI agents with tool calling.',
      topics: ['ai-agents', 'agent-framework', 'multi-agent'],
    });
    assert.equal(result.primary, 'agents');
    assert.ok(result.confidence > 0.7, `confidence was ${result.confidence}`);
  });

  it('classifies an inference server', () => {
    const result = classifyByRules({
      name: 'vllm',
      description:
        'A high-throughput and memory-efficient inference engine for LLMs with paged attention and continuous batching.',
      topics: ['llm-inference', 'inference-engine', 'model-serving'],
    });
    assert.equal(result.primary, 'inference-serving');
  });

  it('returns no category when nothing matches', () => {
    const result = classifyByRules({
      name: 'dotfiles',
      description: 'My personal shell configuration.',
    });
    assert.equal(result.primary, null);
    assert.equal(result.confidence, 0);
    assert.deepEqual(result.secondary, []);
  });

  it('reports low confidence when two categories tie, so the LLM can arbitrate', () => {
    // Genuinely ambiguous: equal topic evidence for two different categories.
    const result = classifyByRules({
      name: 'toolkit',
      description: 'A toolkit.',
      topics: ['rag', 'ai-agent'],
    });
    assert.ok(result.primary !== null);
    assert.ok(
      result.confidence < 0.5,
      `ambiguous repo should escalate, got confidence ${result.confidence}`,
    );
  });

  it('records evidence for every match', () => {
    const result = classifyByRules({
      name: 'x',
      description: 'retrieval-augmented generation pipeline',
      topics: ['rag'],
    });
    const top = result.scores[0];
    assert.ok(top.matched.includes('topic:rag'));
    assert.ok(top.matched.some((m) => m.startsWith('desc:')));
  });

  it('caps README influence so a long README cannot outvote a topic', () => {
    const spam = 'awesome list curated list tutorial course roadmap paper list '.repeat(200);
    const result = classifyByRules({
      name: 'vllm',
      description: 'High-throughput inference engine for LLMs.',
      topics: ['llm-inference', 'inference-engine'],
      readme: spam,
    });
    assert.equal(result.primary, 'inference-serving');
  });

  it('only promotes secondaries that are close to the winner', () => {
    const result = classifyByRules({
      name: 'llama.cpp',
      description:
        'LLM inference engine in C/C++ with quantization support for running models locally.',
      topics: ['llm-inference', 'inference-engine', 'quantization'],
    });
    assert.equal(result.primary, 'inference-serving');
    for (const slug of result.secondary) {
      const winner = result.scores[0].score;
      const score = result.scores.find((s) => s.slug === slug)!.score;
      assert.ok(score >= Math.max(6, winner * 0.45));
    }
  });
});

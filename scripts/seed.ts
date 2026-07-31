import 'dotenv/config';

import { sql } from 'drizzle-orm';

import { categories, db } from '@/db';
import { CATEGORIES, GROUPS } from '@/lib/taxonomy';
import { main } from './cli';

/**
 * Load the taxonomy into the `categories` table.
 *
 * Groups have no table of their own — they live as `group_slug` on each
 * category — so seeding is a single upsert keyed on the slug. Slugs are the
 * contract between the taxonomy module, the database and the URLs, so a
 * category is updated in place rather than replaced: deleting and re-inserting
 * would cascade away every repository_categories row on every deploy.
 */
await main(async () => {
  const groupOrder = new Map(GROUPS.map((group, index) => [group.slug, index]));

  const rows = CATEGORIES.map((category, index) => ({
    slug: category.slug,
    name: category.name,
    groupSlug: category.group,
    description: category.description,
    // Groups sort first, then declaration order inside the group — which is
    // the order a human curated them in, not alphabetical.
    sortOrder: (groupOrder.get(category.group) ?? 99) * 1_000 + index,
  }));

  await db
    .insert(categories)
    .values(rows)
    .onConflictDoUpdate({
      target: categories.slug,
      set: {
        name: sql`excluded.name`,
        groupSlug: sql`excluded.group_slug`,
        description: sql`excluded.description`,
        sortOrder: sql`excluded.sort_order`,
      },
    });

  console.log(`seeded ${rows.length} categories across ${GROUPS.length} groups`);
  for (const group of GROUPS) {
    const count = CATEGORIES.filter((category) => category.group === group.slug).length;
    console.log(`  ${group.slug.padEnd(24)} ${count}`);
  }
});

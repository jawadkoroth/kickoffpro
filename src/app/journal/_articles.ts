/**
 * KickoffPro — Journal article registry.
 *
 * The journal is intentionally a small, hand-curated set of pieces.
 * No CMS, no markdown loader, no auto-generated archive views. Add
 * an article by:
 *
 *   1. Appending an entry to `articles` below.
 *   2. Creating a corresponding React component at
 *      `src/app/journal/articles/<slug>.tsx` that exports a default
 *      function returning the article body JSX.
 *
 * This is deliberate friction. The brief is explicit: this is not a
 * content farm. Four to eight pieces per year, treated like
 * magazine features.
 *
 * Each entry is fully typed so missing metadata is a compile error.
 *
 * Empty array on day one is correct. The /journal index renders a
 * quiet "Editorial — coming." state when there are no articles.
 */

export interface JournalArticle {
  slug: string;
  title: string;
  /** Short editorial dek (≤180 chars). Surfaced in metadata + index. */
  dek: string;
  /** ISO 8601 timestamp. */
  publishedAt: string;
  /** ISO 8601 timestamp. Optional — defaults to `publishedAt`. */
  updatedAt?: string;
  /** Reading-time estimate in minutes (rounded). */
  readingMinutes: number;
  /** Hero image path under /public, or null for a typographic hero. */
  hero: string | null;
  /** Author display name. Defaults to the brand at render time. */
  author?: string;
  /** Drafts are listed in the registry but excluded from public lists/sitemap. */
  draft?: boolean;
}

export const articles: JournalArticle[] = [
  // Add real pieces here. Do not seed placeholder content.
];

export function getArticle(slug: string): JournalArticle | undefined {
  return articles.find((a) => a.slug === slug && !a.draft);
}

export function publishedArticles(): JournalArticle[] {
  return articles
    .filter((a) => !a.draft)
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
}

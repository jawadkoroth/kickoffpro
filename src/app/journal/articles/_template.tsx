/**
 * KickoffPro — Journal article template.
 *
 * This file is the canonical example of how to author a journal
 * article body. It is NOT registered in `_articles.ts` and is
 * therefore never publicly reachable. Its second job is to give
 * Turbopack a concrete file to anchor the dynamic-import pattern in
 * `../[slug]/page.tsx`, so production builds emit no resolution
 * warnings.
 *
 * To publish a real piece:
 *
 *   1. Copy this file to `<your-slug>.tsx` in this directory.
 *   2. Replace the body. Plain HTML elements only — `<h2>`, `<p>`,
 *      `<blockquote>`, `<figure>`, `<hr>`. The article stylesheet
 *      handles every typographic decision; do not import CSS here.
 *   3. Add an entry to `articles` in `../_articles.ts` matching the
 *      filename slug. The registry validates the shape at build.
 *   4. Add a hero image under /public/journal/<slug>/ if needed.
 *
 * Style guidance (echoes the brand brief):
 *
 *   - 800–1500 words is the editorial sweet spot.
 *   - One <h2> per ~600 words. Resist the urge to subhead.
 *   - No numbered lists, no bullet "tips," no listicle structure.
 *   - One pull-quote (<blockquote>) per piece, no more.
 *   - Drop cap on the opening paragraph is automatic via CSS.
 */

export default function TemplateArticle() {
  return null;
}

import { normalizeSlug, getUniqueSlug } from '../src/lib/slug.ts';

// Simple assertion helper
function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}: expected "${expected}", got "${actual}"`);
    process.exit(1);
  }
}

async function runTests() {
  console.log('=== RUNNING SLUG UTILITY TESTS ===\n');

  // Test Case 1: en-dash slug normalization
  assertEqual(
    normalizeSlug('Argentina-Premium-Dot-Knit-Jersey–2026'),
    'argentina-premium-dot-knit-jersey-2026',
    'en-dash slug normalization'
  );

  // Test Case 2: em-dash slug normalization
  assertEqual(
    normalizeSlug('Argentina-Premium-Dot-Knit-Jersey—2026'),
    'argentina-premium-dot-knit-jersey-2026',
    'em-dash slug normalization'
  );

  // Test Case 3: Spaces and casing normalization
  assertEqual(
    normalizeSlug('   Argentina Premium Dot Knit Jersey   '),
    'argentina-premium-dot-knit-jersey',
    'Spaces and casing normalization'
  );

  // Test Case 4: Non-alphanumeric character cleanup
  assertEqual(
    normalizeSlug('Argentina & Brazil @ 2026!'),
    'argentina-brazil-2026',
    'Non-alphanumeric character cleanup'
  );

  // Test Case 5: Duplicate slug suffix generation (mocking Supabase client)
  let calls = 0;
  const mockSupabaseConflict = {
    from: () => ({
      select: () => ({
        eq: (col, val) => ({
          neq: (col2, val2) => ({
            maybeSingle: async () => {
              calls++;
              if (calls === 1) {
                // First call: simulate a conflict exists for "argentina-jersey-2026"
                return { data: { id: 'existing-id' }, error: null };
              } else if (calls === 2) {
                // Second call: simulate a conflict exists for "argentina-jersey-2026-2"
                return { data: { id: 'existing-id-2' }, error: null };
              }
              // Third call: unique slug found
              return { data: null, error: null };
            }
          })
        })
      })
    })
  };

  const uniqueSlug = await getUniqueSlug('Argentina-Jersey-2026', 'new-id', mockSupabaseConflict);
  assertEqual(uniqueSlug, 'argentina-jersey-2026-3', 'Duplicate slug suffix generation (resolved conflicts up to -3)');

  // Test Case 6: Legacy URL redirect logic mock
  const simulateRedirectCheck = (incomingSlug, productRowSlug) => {
    const normalizedIncoming = normalizeSlug(incomingSlug);
    if (normalizedIncoming === productRowSlug && incomingSlug !== productRowSlug) {
      return { redirect: true, canonicalUrl: `/product/${productRowSlug}` };
    }
    return { redirect: false };
  };

  const redirectResult1 = simulateRedirectCheck(
    'Argentina-Premium-Dot-Knit-Jersey–2026', // with en-dash
    'argentina-premium-dot-knit-jersey-2026'
  );
  assertEqual(redirectResult1.redirect, true, 'Redirect trigger on en-dash');
  assertEqual(redirectResult1.canonicalUrl, '/product/argentina-premium-dot-knit-jersey-2026', 'Redirect target matches canonical');

  const redirectResult2 = simulateRedirectCheck(
    'argentina-premium-dot-knit-jersey-2026', // canonical
    'argentina-premium-dot-knit-jersey-2026'
  );
  assertEqual(redirectResult2.redirect, false, 'No redirect on exact canonical match');

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

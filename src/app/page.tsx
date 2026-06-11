import type { Metadata } from 'next';
import LandingClient from './LandingClient';
import { JsonLd } from '@/components/seo/JsonLd';
import { organizationLd, webSiteLd } from '@/lib/seo/jsonLd';
import { BRAND, SITE_URL } from '@/lib/seo/site';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import DatabaseErrorPanel from '@/components/DatabaseErrorPanel';
import { handleSupabaseQueryResult, QueryResultError } from '@/lib/supabase/query-helper';

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name} — Affordable Football Jerseys, India` },
  description: BRAND.description,
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    url: SITE_URL,
    title: `${BRAND.name} — Affordable Football Jerseys, India`,
    description: BRAND.description,
    type: 'website',
  },
};

interface Product {
  id: string;
  slug: string;
  name: string;
  price_paise: number;
  sale_price_paise: number | null;
  images: unknown;
  is_active: boolean;
  created_at: string;
  category: string | null;
  homepage_feature_image: string | null;
  homepage_feature_enabled: boolean;
}

export const revalidate = 60; // Revalidate every minute

export default async function LandingPage() {
  let products: Product[] = [];
  let dbError: QueryResultError | null = null;

  try {
    const supabase = await createServerSupabaseClient();
    const response = await supabase
      .from('products')
      .select('id, slug, name, price_paise, sale_price_paise, images, is_active, created_at, category, homepage_feature_image, homepage_feature_enabled')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(100);

    const result = handleSupabaseQueryResult(response, 'homepage.products_fetch');
    if (result.error) {
      dbError = result.error;
    } else {
      products = (result.data ?? []) as Product[];
    }
  } catch (err) {
    if (err && (err instanceof Error && (err.message.includes('Dynamic server usage') || (err as any).digest === 'DYNAMIC_SERVER_USAGE'))) {
      throw err;
    }
    console.error('[HOMEPAGE_PRODUCTS_FETCH_EXCEPTION]', err);
    dbError = {
      message: err instanceof Error ? err.message : String(err),
      correlationId: `exc-${Math.random().toString(36).substring(2, 9).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
    };
  }

  if (dbError) {
    return <DatabaseErrorPanel error={dbError} title="Failed to load homepage products" />;
  }

  // Parse images helper
  const parsedProducts = products.map(p => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    price_paise: p.price_paise,
    sale_price_paise: p.sale_price_paise,
    images: Array.isArray(p.images) ? (p.images as string[]) : [],
    category: p.category || undefined,
    created_at: p.created_at,
    totalStock: 10, // Mock total stock for UI since we don't query variants table here
    homepage_feature_image: p.homepage_feature_image || null,
    homepage_feature_enabled: p.homepage_feature_enabled || false
  }));

  return (
    <>
      <JsonLd data={organizationLd()} />
      <JsonLd data={webSiteLd()} />
      <LandingClient products={parsedProducts} />
    </>
  );
}

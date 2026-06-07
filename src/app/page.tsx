import type { Metadata } from 'next';
import LandingClient from './LandingClient';
import { JsonLd } from '@/components/seo/JsonLd';
import { organizationLd, webSiteLd } from '@/lib/seo/jsonLd';
import { BRAND, SITE_URL } from '@/lib/seo/site';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
}

export default async function LandingPage() {
  let products: Product[] = [];
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase
      .from('products')
      .select('id, slug, name, price_paise, sale_price_paise, images, is_active, created_at, category')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(8);
    products = (data ?? []) as Product[];
  } catch (err) {
    console.error('[HOMEPAGE_PRODUCTS_FETCH]', err);
  }

  // Parse images helper
  const parsedProducts = products.map(p => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    price_paise: p.price_paise,
    sale_price_paise: p.sale_price_paise,
    images: Array.isArray(p.images) ? (p.images as string[]) : [],
    category: p.category,
    created_at: p.created_at,
  }));

  return (
    <>
      <JsonLd data={organizationLd()} />
      <JsonLd data={webSiteLd()} />
      <LandingClient products={parsedProducts} />
    </>
  );
}

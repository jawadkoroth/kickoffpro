import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { resolveAudience, getAudienceCounts, type AudienceMode } from '@/lib/broadcast/audience';
import { sendSingleBroadcastEmail } from '@/lib/email/sendBroadcastEmail';
import { enqueue } from '@/lib/jobs/queue';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gateAdmin() {
  const ssr = await createServerSupabaseClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();

  if (!user) return { ok: false as const, status: 401, message: 'Unauthorized', user: null };

  const admin = createAdminClient();
  const { data: adminUser } = await admin
    .from('admin_users')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!adminUser) return { ok: false as const, status: 403, message: 'Not admin', user: null };

  return { ok: true as const, admin, user };
}

export async function GET() {
  const gate = await gateAdmin();
  if (!gate.ok) return apiError(gate.status, gate.message);

  const supabase = gate.admin;

  try {
    const [campaignsRes, counts] = await Promise.all([
      supabase
        .from('email_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50),
      getAudienceCounts(supabase),
    ]);

    if (campaignsRes.error) {
      logEvent('broadcast.list_error', { error: campaignsRes.error.message });
      return apiError(500, 'Failed to fetch campaigns list');
    }

    return apiSuccess({
      campaigns: campaignsRes.data || [],
      audienceCounts: counts,
      adminEmail: gate.user.email || '',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent('broadcast.get_unhandled', { error: msg });
    return apiError(500, 'Failed to load broadcast data');
  }
}

export async function POST(req: NextRequest) {
  const gate = await gateAdmin();
  if (!gate.ok) return apiError(gate.status, gate.message);

  const supabase = gate.admin;
  const user = gate.user;

  let body: {
    action?: string;
    audience_mode?: AudienceMode;
    name?: string;
    subject?: string;
    preview_text?: string;
    body_html?: string;
    cta_label?: string;
    cta_url?: string;
  };

  try {
    body = await req.json();
  } catch {
    return apiError(400, 'Invalid JSON body');
  }

  const action = body.action || 'preview_count';

  // 1. Preview recipient count
  if (action === 'preview_count') {
    const mode = (body.audience_mode || 'all') as AudienceMode;
    const result = await resolveAudience(supabase, mode);
    return apiSuccess({ count: result.count, mode: result.mode });
  }

  // 2. Send instant test email to logged-in admin
  if (action === 'test_send') {
    const adminEmail = user.email;
    if (!adminEmail) {
      return apiError(400, 'No authenticated admin email found to send test');
    }

    const subject = (body.subject || '').trim();
    const bodyHtml = (body.body_html || '').trim();
    if (!subject || !bodyHtml) {
      return apiError(400, 'Subject and email body are required for test send');
    }

    try {
      const res = await sendSingleBroadcastEmail({
        to: adminEmail,
        subject,
        previewText: body.preview_text || null,
        bodyHtml,
        ctaLabel: body.cta_label || null,
        ctaUrl: body.cta_url || null,
        isTest: true,
      });

      logEvent('broadcast.test_sent', { admin: adminEmail, resend_id: res.id });
      return apiSuccess({
        message: `Test email sent successfully to ${adminEmail}`,
        resendId: res.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logEvent('broadcast.test_failed', { admin: adminEmail, error: msg });
      return apiError(500, `Failed to send test email: ${msg}`);
    }
  }

  // 3. Queue full broadcast campaign
  if (action === 'send_campaign') {
    const name = (body.name || '').trim();
    const subject = (body.subject || '').trim();
    const bodyHtml = (body.body_html || '').trim();
    const audienceMode = (body.audience_mode || 'all') as AudienceMode;

    if (!name || !subject || !bodyHtml) {
      return apiError(400, 'Campaign Name, Subject, and Content body are required');
    }

    // Resolve audience
    const audience = await resolveAudience(supabase, audienceMode);
    if (audience.count === 0) {
      return apiError(400, 'No active, non-suppressed recipients found for this audience.');
    }

    // Insert campaign record
    const { data: campaign, error: insertError } = await supabase
      .from('email_campaigns')
      .insert({
        name,
        subject,
        preview_text: body.preview_text || null,
        body_html: bodyHtml,
        cta_label: body.cta_label || null,
        cta_url: body.cta_url || null,
        audience_mode: audienceMode,
        status: 'queued',
        total_recipients: audience.count,
        sent_count: 0,
        failed_count: 0,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (insertError || !campaign) {
      logEvent('broadcast.insert_failed', { error: insertError?.message });
      return apiError(500, 'Failed to initialize broadcast campaign');
    }

    const campaignId = campaign.id;

    // Split into rate-safe chunks of 25 emails
    const CHUNK_SIZE = 25;
    const emails = audience.emails;
    const chunks: string[][] = [];
    for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
      chunks.push(emails.slice(i, i + CHUNK_SIZE));
    }

    // Enqueue each chunk with small stagger
    for (let i = 0; i < chunks.length; i++) {
      const isLastChunk = i === chunks.length - 1;
      const delayMs = i * 4000; // 4s stagger between chunks
      const runAt = new Date(Date.now() + delayMs);

      await enqueue(
        {
          kind: 'email.broadcast_chunk',
          payload: {
            campaignId,
            emails: chunks[i],
            subject,
            previewText: body.preview_text || null,
            bodyHtml,
            ctaLabel: body.cta_label || null,
            ctaUrl: body.cta_url || null,
            chunkIndex: i,
            totalChunks: chunks.length,
            isLastChunk,
          },
          runAt,
          maxAttempts: 3,
        },
        supabase,
      );
    }

    logEvent('broadcast.campaign_queued', {
      campaign_id: campaignId,
      total_recipients: audience.count,
      total_chunks: chunks.length,
      mode: audienceMode,
    });

    return apiSuccess({
      message: `Broadcast campaign "${name}" enqueued successfully for ${audience.count} recipients.`,
      campaignId,
      totalRecipients: audience.count,
      totalChunks: chunks.length,
    });
  }

  return apiError(400, `Unknown action: ${action}`);
}

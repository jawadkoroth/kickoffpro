import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { resolveAudience, getAudienceCounts, type AudienceMode } from '@/lib/broadcast/audience';
import { sendSingleBroadcastEmail } from '@/lib/email/sendBroadcastEmail';
import { enqueue, triggerImmediateQueueProcessing } from '@/lib/jobs/queue';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_MODES: AudienceMode[] = ['all', 'newsletter', 'customers', 'opted_in_buyers'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      getAudienceCounts(),
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
    campaign_id?: string;
    audience_mode?: AudienceMode;
    name?: string;
    subject?: string;
    preview_text?: string;
    body_html?: string;
    cta_label?: string;
    cta_url?: string;
    test_email?: string;
  };

  try {
    body = await req.json();
  } catch {
    return apiError(400, 'Invalid JSON body');
  }

  const action = body.action || 'preview_count';

  // 1. Preview recipient count
  if (action === 'preview_count') {
    const mode = VALID_MODES.includes(body.audience_mode as AudienceMode)
      ? (body.audience_mode as AudienceMode)
      : 'all';
    const emails = await resolveAudience(mode);
    return apiSuccess({ count: emails.length, mode });
  }

  // 2. Send instant test email (custom test_email or logged-in admin email)
  if (action === 'test_send') {
    const targetEmail = (body.test_email || user.email || '').trim().toLowerCase();
    if (!targetEmail || !EMAIL_RE.test(targetEmail)) {
      return apiError(400, 'Valid test recipient email address is required');
    }

    const subject = (body.subject || '').trim();
    const bodyHtml = (body.body_html || '').trim();
    if (!subject || !bodyHtml) {
      return apiError(400, 'Subject and email body are required for test send');
    }

    try {
      const res = await sendSingleBroadcastEmail({
        to: targetEmail,
        subject,
        previewText: body.preview_text || null,
        bodyHtml,
        ctaLabel: body.cta_label || null,
        ctaUrl: body.cta_url || null,
        isTest: true,
      });

      logEvent('broadcast.test_sent', {
        admin: user.email || user.id,
        recipient: targetEmail,
        resend_id: res.id,
      });
      return apiSuccess({
        message: `Test email sent successfully to ${targetEmail}`,
        resendId: res.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logEvent('broadcast.test_failed', { recipient: targetEmail, error: msg });
      return apiError(500, `Failed to send test email: ${msg}`);
    }
  }

  // 3. Cancel active queued/sending campaign
  if (action === 'cancel_campaign') {
    const campaignId = (body.campaign_id || '').trim();
    if (!campaignId) {
      return apiError(400, 'campaign_id is required');
    }

    const { data: cancelled, error: cancelErr } = await supabase
      .from('email_campaigns')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', campaignId)
      .in('status', ['queued', 'sending'])
      .select('id, name')
      .maybeSingle();

    if (cancelErr) {
      return apiError(500, 'Failed to cancel campaign');
    }
    if (!cancelled) {
      return apiError(400, 'Campaign is not in a cancellable state');
    }

    // Retire still-queued chunk jobs for this campaign so worker skips them cleanly
    await supabase
      .from('job_queue')
      .update({ status: 'dead', last_error: 'Campaign cancelled by admin' })
      .eq('kind', 'email.broadcast_chunk')
      .eq('status', 'queued')
      .contains('payload', { campaignId });

    logEvent('broadcast.campaign_cancelled', {
      campaign_id: campaignId,
      admin: user.email || user.id,
    });

    return apiSuccess({
      message: `Campaign "${cancelled.name}" cancelled cleanly.`,
      campaignId,
    });
  }

  // 4. Queue full broadcast campaign
  if (action === 'send_campaign') {
    const name = (body.name || '').trim();
    const subject = (body.subject || '').trim();
    const bodyHtml = (body.body_html || '').trim();
    const audienceMode = VALID_MODES.includes(body.audience_mode as AudienceMode)
      ? (body.audience_mode as AudienceMode)
      : 'all';

    if (!name || !subject || !bodyHtml) {
      return apiError(400, 'Campaign Name, Subject, and Content body are required');
    }

    const emails = await resolveAudience(audienceMode);
    if (emails.length === 0) {
      return apiError(400, 'No active, non-suppressed recipients found for this audience.');
    }

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
        total_recipients: emails.length,
        sent_count: 0,
        failed_count: 0,
        suppressed_count: 0,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (insertError || !campaign) {
      logEvent('broadcast.insert_failed', { error: insertError?.message });
      return apiError(500, 'Failed to initialize broadcast campaign');
    }

    const campaignId = campaign.id;

    // Split into rate-safe chunks of 25 emails with deterministic idempotency keys
    const CHUNK_SIZE = 25;
    const chunks: string[][] = [];
    for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
      chunks.push(emails.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i++) {
      const isLastChunk = i === chunks.length - 1;
      const delayMs = i * 4000;
      const runAt = new Date(Date.now() + delayMs);

      await enqueue(
        {
          kind: 'email.broadcast_chunk',
          idempotencyKey: `email.broadcast.${campaignId}.chunk.${i}`,
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

    // Trigger immediate processing for the first chunk while remaining chunks follow via worker
    triggerImmediateQueueProcessing();

    logEvent('broadcast.campaign_queued', {
      campaign_id: campaignId,
      total_recipients: emails.length,
      total_chunks: chunks.length,
      mode: audienceMode,
    });

    return apiSuccess({
      message: `Broadcast campaign "${name}" enqueued successfully for ${emails.length} recipients.`,
      campaignId,
      totalRecipients: emails.length,
      totalChunks: chunks.length,
    });
  }

  return apiError(400, `Unknown action: ${action}`);
}

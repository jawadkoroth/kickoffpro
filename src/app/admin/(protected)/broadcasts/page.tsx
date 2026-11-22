'use client';

import { useState, useEffect } from 'react';
import { renderBroadcastEmail } from '@/lib/email/templates/broadcastEmail';

interface Campaign {
  id: string;
  name: string;
  subject: string;
  preview_text: string | null;
  body_html: string;
  cta_label: string | null;
  cta_url: string | null;
  audience_mode: 'all' | 'newsletter' | 'customers';
  status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
}

interface AudienceCounts {
  all: number;
  newsletter: number;
  customers: number;
}

const DEFAULT_SAMPLE_BODY = `<p style="margin:0 0 16px;font-size:16px;">Hey Football Fans,</p>
<p style="margin:0 0 16px;">We just unlocked an exclusive secret offer on our latest premium kits and retro drops. For the next 48 hours, enjoy complimentary express shipping across India on all club & international jerseys.</p>
<p style="margin:0 0 16px;">Stocks are strictly limited per size. Claim yours before your favorite kit sells out.</p>`;

export default function AdminBroadcastsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [counts, setCounts] = useState<AudienceCounts>({ all: 0, newsletter: 0, customers: 0 });
  const [adminEmail, setAdminEmail] = useState('');
  const [loading, setLoading] = useState(true);

  // Form State
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [audienceMode, setAudienceMode] = useState<'all' | 'newsletter' | 'customers'>('all');
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_SAMPLE_BODY);
  const [ctaLabel, setCtaLabel] = useState('Explore Kits Now');
  const [ctaUrl, setCtaUrl] = useState('https://kickoffpro.in');

  // Preview & Modal State
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [isTestSending, setIsTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchMessage, setLaunchMessage] = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchBroadcastData = async () => {
    try {
      const res = await fetch('/api/admin/broadcast');
      const data = await res.json();
      if (data.success) {
        setCampaigns(data.data.campaigns || []);
        setCounts(data.data.audienceCounts || { all: 0, newsletter: 0, customers: 0 });
        if (data.data.adminEmail) setAdminEmail(data.data.adminEmail);
      }
    } catch (err) {
      console.error('[LOAD_BROADCAST_ERROR]', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBroadcastData();
    // Poll every 12s if there are pending campaigns
    const interval = setInterval(() => {
      fetchBroadcastData();
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  const handleSendTest = async () => {
    if (!subject.trim() || !bodyHtml.trim()) {
      setTestResult({ ok: false, msg: 'Subject and body content are required for a test email.' });
      return;
    }

    setIsTestSending(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test_send',
          subject,
          preview_text: previewText,
          body_html: bodyHtml,
          cta_label: ctaLabel,
          cta_url: ctaUrl,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({ ok: true, msg: data.data.message || `Test sent to ${adminEmail}` });
      } else {
        setTestResult({ ok: false, msg: data.error || 'Failed to send test email.' });
      }
    } catch {
      setTestResult({ ok: false, msg: 'Network error sending test email.' });
    } finally {
      setIsTestSending(false);
    }
  };

  const handleLaunchCampaign = async () => {
    if (!name.trim() || !subject.trim() || !bodyHtml.trim()) {
      alert('Please fill out Campaign Name, Subject, and Email Body.');
      return;
    }

    setIsLaunching(true);
    setLaunchMessage(null);

    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_campaign',
          name,
          subject,
          preview_text: previewText,
          body_html: bodyHtml,
          cta_label: ctaLabel,
          cta_url: ctaUrl,
          audience_mode: audienceMode,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setLaunchMessage({ ok: true, msg: data.data.message });
        setIsConfirmOpen(false);
        // Reset inputs
        setName('');
        setSubject('');
        setPreviewText('');
        fetchBroadcastData();
      } else {
        setLaunchMessage({ ok: false, msg: data.error || 'Failed to enqueue campaign.' });
      }
    } catch {
      setLaunchMessage({ ok: false, msg: 'Network error queuing campaign.' });
    } finally {
      setIsLaunching(false);
    }
  };

  const previewHtml = renderBroadcastEmail({
    subject: subject || 'Exclusive KickoffPro Announcement',
    previewText: previewText || 'Special offer inside',
    bodyHtml: bodyHtml || '<p>Your message will appear here...</p>',
    ctaLabel: ctaLabel || null,
    ctaUrl: ctaUrl || null,
    unsubscribeUrl: 'https://kickoffpro.in/unsubscribe',
  });

  const selectedCount = counts[audienceMode] ?? 0;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, color: '#FFFFFF' }}>
            Offers &amp; Broadcasts
          </h1>
          <p style={{ color: '#9CA3AF', margin: '6px 0 0', fontSize: '0.875rem' }}>
            Create and send marketing drops, private discount broadcasts, and restock alerts with safe suppression tracking.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ background: '#1A1D24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '8px 16px', fontSize: '0.8125rem', color: '#9CA3AF' }}>
            Sending as: <strong style={{ color: '#FFC928' }}>{adminEmail || 'admin'}</strong>
          </div>
        </div>
      </div>

      {launchMessage && (
        <div
          style={{
            marginBottom: 'var(--space-6)',
            padding: '12px 18px',
            borderRadius: '8px',
            background: launchMessage.ok ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            border: `1px solid ${launchMessage.ok ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: launchMessage.ok ? '#22c55e' : '#ef4444',
            fontSize: '0.875rem',
          }}
        >
          {launchMessage.msg}
        </div>
      )}

      {/* Main Campaign Builder Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
        {/* Left Column: Form Editor */}
        <div className="card" style={{ padding: 'var(--space-6)', background: '#12141A', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: '#FFFFFF' }}>Campaign Composer</h2>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setActiveTab('editor')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  background: activeTab === 'editor' ? '#FFC928' : 'rgba(255,255,255,0.06)',
                  color: activeTab === 'editor' ? '#0B0B0C' : '#9CA3AF',
                }}
              >
                Editor
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  background: activeTab === 'preview' ? '#FFC928' : 'rgba(255,255,255,0.06)',
                  color: activeTab === 'preview' ? '#0B0B0C' : '#9CA3AF',
                }}
              >
                Live Preview
              </button>
            </div>
          </div>

          {activeTab === 'editor' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Campaign Internal Name */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#D1D5DB', marginBottom: '6px' }}>
                  Campaign Name (Internal Reference)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Black Friday 25% Off VIP Broadcast"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', background: '#0B0B0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#FFF', fontSize: '0.875rem' }}
                />
              </div>

              {/* Subject & Preview Text */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#D1D5DB', marginBottom: '6px' }}>
                    Email Subject Line *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ⚡ Flash Drop: Official Kit Restock Inside"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', background: '#0B0B0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#FFF', fontSize: '0.875rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#D1D5DB', marginBottom: '6px' }}>
                    Preview Text (Preheader)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Complimentary express shipping for 48 hours"
                    value={previewText}
                    onChange={(e) => setPreviewText(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', background: '#0B0B0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#FFF', fontSize: '0.875rem' }}
                  />
                </div>
              </div>

              {/* Target Audience Selector */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#D1D5DB', marginBottom: '6px' }}>
                  Target Audience
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {[
                    { id: 'all', title: 'All Subscribers & Buyers', count: counts.all },
                    { id: 'newsletter', title: 'Newsletter Only', count: counts.newsletter },
                    { id: 'customers', title: 'Past Buyers Only', count: counts.customers },
                  ].map((aud) => {
                    const active = audienceMode === aud.id;
                    return (
                      <button
                        key={aud.id}
                        type="button"
                        onClick={() => setAudienceMode(aud.id as 'all' | 'newsletter' | 'customers')}
                        style={{
                          padding: '12px 10px',
                          borderRadius: '8px',
                          border: `1px solid ${active ? '#FFC928' : 'rgba(255,255,255,0.08)'}`,
                          background: active ? 'rgba(255, 201, 40, 0.08)' : '#0E1015',
                          textAlign: 'left',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: active ? '#FFC928' : '#9CA3AF' }}>
                          {aud.title}
                        </div>
                        <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#FFF', marginTop: '4px' }}>
                          {loading ? '…' : `${aud.count} recipients`}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: '6px', fontSize: '0.75rem', color: '#6B7280' }}>
                  * Automatically deduplicated case-insensitively and filtered against marketing suppressions / unsubscribes.
                </div>
              </div>

              {/* HTML Content Body */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#D1D5DB' }}>
                    Email Body HTML / Paragraphs *
                  </label>
                  <button
                    type="button"
                    onClick={() => setBodyHtml(DEFAULT_SAMPLE_BODY)}
                    style={{ background: 'none', border: 'none', color: '#FFC928', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Reset to template
                  </button>
                </div>
                <textarea
                  rows={7}
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  style={{ width: '100%', padding: '12px 14px', background: '#0B0B0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#E5E7EB', fontSize: '0.875rem', fontFamily: 'monospace', lineHeight: 1.5 }}
                />
              </div>

              {/* CTA Label & URL */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#D1D5DB', marginBottom: '6px' }}>
                    Button Label (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Shop Offer Now"
                    value={ctaLabel}
                    onChange={(e) => setCtaLabel(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', background: '#0B0B0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#FFF', fontSize: '0.875rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#D1D5DB', marginBottom: '6px' }}>
                    Button Destination URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://kickoffpro.in/category/kits"
                    value={ctaUrl}
                    onChange={(e) => setCtaUrl(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', background: '#0B0B0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#FFF', fontSize: '0.875rem' }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleSendTest}
                  disabled={isTestSending}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#FFFFFF',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: isTestSending ? 'not-allowed' : 'pointer',
                    opacity: isTestSending ? 0.6 : 1,
                  }}
                >
                  {isTestSending ? 'Sending Test...' : 'Send Test Email to Me'}
                </button>

                <button
                  type="button"
                  onClick={() => setIsConfirmOpen(true)}
                  disabled={selectedCount === 0}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '8px',
                    background: '#FFC928',
                    border: 'none',
                    color: '#0B0B0C',
                    fontSize: '0.875rem',
                    fontWeight: 700,
                    cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                    opacity: selectedCount === 0 ? 0.5 : 1,
                  }}
                >
                  Schedule Broadcast ({selectedCount})
                </button>
              </div>

              {testResult && (
                <div
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    fontSize: '0.8125rem',
                    background: testResult.ok ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    color: testResult.ok ? '#22c55e' : '#ef4444',
                  }}
                >
                  {testResult.msg}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: '12px', fontSize: '0.8125rem', color: '#9CA3AF' }}>
                Live HTML preview rendering exactly as subscribers will view it:
              </div>
              <div
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  background: '#0B0B0C',
                }}
              >
                <iframe
                  title="Email Preview"
                  srcDoc={previewHtml}
                  style={{ width: '100%', height: '520px', border: 'none', background: '#0B0B0C' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Mini Preview & Quick Tips */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Quick Audience Overview */}
          <div className="card" style={{ padding: 'var(--space-6)', background: '#12141A', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px', color: '#FFF' }}>
              Delivery &amp; Safety Compliance
            </h3>
            <ul style={{ margin: 0, paddingLeft: '18px', color: '#9CA3AF', fontSize: '0.8125rem', lineHeight: 1.6 }}>
              <li><strong>Paced Dispatch:</strong> Broadcasts are chunked into rate-safe batches via background queue worker.</li>
              <li><strong>Automatic Suppression:</strong> Customers who unsubscribed are automatically excluded.</li>
              <li><strong>One-Click Unsubscribe:</strong> Full RFC 8058 compliant headers (`List-Unsubscribe=One-Click`) are attached to every message to protect domain sender reputation.</li>
              <li><strong>Zero Interruption:</strong> High-priority order receipts take precedence over promotional broadcasts in `job_queue`.</li>
            </ul>
          </div>

          {/* Inline Quick Frame */}
          {activeTab === 'editor' && (
            <div className="card" style={{ padding: 'var(--space-4)', background: '#12141A', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#9CA3AF', marginBottom: '8px' }}>
                Card Preview Snapshot
              </div>
              <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', overflow: 'hidden' }}>
                <iframe
                  title="Mini Preview"
                  srcDoc={previewHtml}
                  style={{ width: '100%', height: '360px', border: 'none', background: '#0B0B0C' }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {isConfirmOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              maxWidth: '480px',
              width: '100%',
              background: '#16181F',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '16px',
              padding: '28px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            }}
          >
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#FFF', margin: '0 0 12px' }}>
              Confirm Broadcast Launch
            </h3>
            <p style={{ color: '#D1D5DB', fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 16px' }}>
              You are about to launch <strong style={{ color: '#FFC928' }}>&ldquo;{name || 'Untitled Campaign'}&rdquo;</strong> to <strong style={{ color: '#FFF' }}>{selectedCount} recipients</strong> ({audienceMode}).
            </p>
            <div style={{ background: '#0E1015', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '12px 14px', fontSize: '0.8125rem', color: '#9CA3AF', marginBottom: '20px' }}>
              <div><strong>Subject:</strong> {subject}</div>
              {previewText && <div><strong>Preview:</strong> {previewText}</div>}
              <div><strong>Audience:</strong> {audienceMode.toUpperCase()} ({selectedCount} emails)</div>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                disabled={isLaunching}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#FFF',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLaunchCampaign}
                disabled={isLaunching}
                style={{
                  padding: '10px 22px',
                  borderRadius: '8px',
                  background: '#FFC928',
                  border: 'none',
                  color: '#0B0B0C',
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  cursor: isLaunching ? 'not-allowed' : 'pointer',
                  opacity: isLaunching ? 0.7 : 1,
                }}
              >
                {isLaunching ? 'Queuing Jobs...' : 'Confirm & Send Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign History Table */}
      <div className="card" style={{ padding: 'var(--space-6)', background: '#12141A', border: '1px solid rgba(255,255,255,0.08)' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: '0 0 var(--space-4)', color: '#FFFFFF' }}>
          Recent Campaigns &amp; Delivery History
        </h2>

        {campaigns.length === 0 ? (
          <div style={{ color: '#6B7280', fontSize: '0.875rem', textAlign: 'center', padding: '32px' }}>
            No broadcast campaigns created yet. Compose your first offer campaign above.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#9CA3AF' }}>
                  <th style={{ padding: '10px 12px' }}>Campaign Name</th>
                  <th style={{ padding: '10px 12px' }}>Subject</th>
                  <th style={{ padding: '10px 12px' }}>Audience</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th style={{ padding: '10px 12px' }}>Sent / Total</th>
                  <th style={{ padding: '10px 12px' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((camp) => {
                  const statusColors: Record<string, { bg: string; color: string }> = {
                    draft: { bg: 'rgba(156, 163, 175, 0.1)', color: '#9CA3AF' },
                    queued: { bg: 'rgba(59, 130, 246, 0.1)', color: '#60A5FA' },
                    sending: { bg: 'rgba(234, 179, 8, 0.1)', color: '#FACC15' },
                    sent: { bg: 'rgba(34, 197, 94, 0.1)', color: '#4ADE80' },
                    failed: { bg: 'rgba(239, 68, 68, 0.1)', color: '#F87171' },
                  };
                  const badge = statusColors[camp.status] || statusColors.draft;
                  return (
                    <tr key={camp.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '12px', fontWeight: 600, color: '#FFF' }}>
                        {camp.name}
                      </td>
                      <td style={{ padding: '12px', color: '#D1D5DB' }}>
                        {camp.subject}
                      </td>
                      <td style={{ padding: '12px', color: '#9CA3AF', textTransform: 'uppercase', fontSize: '0.75rem', fontWeight: 700 }}>
                        {camp.audience_mode}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '4px', background: badge.bg, color: badge.color, fontSize: '0.75rem', fontWeight: 700, textTransform: 'capitalize' }}>
                          {camp.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: '#D1D5DB' }}>
                        <strong>{camp.sent_count}</strong> / {camp.total_recipients}
                        {camp.failed_count > 0 && (
                          <span style={{ color: '#EF4444', fontSize: '0.75rem', marginLeft: '6px' }}>
                            ({camp.failed_count} failed)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px', color: '#6B7280', fontSize: '0.8125rem' }}>
                        {new Date(camp.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

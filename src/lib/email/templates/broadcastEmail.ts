export interface BroadcastRenderOptions {
  subject: string;
  previewText?: string | null;
  bodyHtml: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  unsubscribeUrl?: string | null;
  siteUrl?: string | null;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Pure HTML template renderer for KickoffPro broadcast and marketing emails.
 * Zero Node.js runtime dependencies — safe to use in client components and server code.
 */
export function renderBroadcastEmail(opts: BroadcastRenderOptions): string {
  const { subject, previewText, bodyHtml, ctaLabel, ctaUrl } = opts;
  const homeUrl = opts.siteUrl || 'https://kickoffpro.in';
  const unsubUrl = opts.unsubscribeUrl || `${homeUrl}/unsubscribe`;

  const preheaderBlock = previewText
    ? `
      <!-- Hidden Preheader Text -->
      <div style="display:none;font-size:1px;color:#0B0B0C;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
        ${escapeHtml(previewText)}
        &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
      </div>`
    : '';

  const ctaBlock =
    ctaLabel && ctaUrl
      ? `
        <div style="text-align:center;margin:32px 0 20px;">
          <a href="${escapeAttr(ctaUrl)}"
             style="display:inline-block;padding:14px 32px;background:#FFC928;color:#0B0B0C;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;border-radius:999px;box-shadow:0 4px 14px rgba(255,201,40,0.25);">
            ${escapeHtml(ctaLabel)}
          </a>
        </div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0B0B0C;color:#F5F5F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  ${preheaderBlock}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0B0B0C;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;background:#141416;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
          <!-- Brand Header -->
          <tr>
            <td style="padding:28px 32px 20px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
              <a href="${escapeAttr(homeUrl)}" style="text-decoration:none;display:inline-block;">
                <span style="font-size:20px;font-weight:900;letter-spacing:0.06em;color:#FFFFFF;">
                  KICKOFF<span style="color:#FFC928;">PRO</span>
                </span>
              </a>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:32px;color:#E5E7EB;font-size:15px;line-height:1.65;">
              ${bodyHtml}
              ${ctaBlock}
            </td>
          </tr>

          <!-- Footer & Unsubscribe -->
          <tr>
            <td style="padding:24px 32px 32px;background:#0E0E10;border-top:1px solid rgba(255,255,255,0.06);text-align:center;color:#6B7280;font-size:12px;line-height:1.6;">
              <p style="margin:0 0 10px;">
                You are receiving this exclusive announcement because you are a registered customer or subscriber of KickoffPro.
              </p>
              <p style="margin:0 0 10px;">
                © ${new Date().getFullYear()} KickoffPro. All rights reserved.
              </p>
              <p style="margin:0;">
                <a href="${escapeAttr(unsubUrl)}" style="color:#9CA3AF;text-decoration:underline;">
                  Unsubscribe from marketing broadcasts
                </a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

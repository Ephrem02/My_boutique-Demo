// Builds the email from the already-rendered plain-text subject/body. The
// HTML version is a fixed layout with every character of content escaped,
// so neither template text nor data values (product names, notes...) can
// inject markup, links or scripts.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function appLink() {
  const url = process.env.APP_BASE_URL;
  return url && /^https?:\/\/[^\s"'<>]+$/.test(url) ? url : null;
}

function buildEmail({ subject, bodyText }) {
  const link = appLink();
  const footer = link
    ? `Open the shop app to see details: ${link}`
    : 'Open the shop app to see details.';
  const text = `${bodyText}\n\n--\n${footer}\nThis is an automated message from your shop management system.`;

  const paragraphs = escapeHtml(bodyText).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const linkHtml = link ? `<a href="${escapeHtml(link)}" style="color:#2563eb">Open the shop app</a>` : 'Open the shop app';
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;background:#f9fafb;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">
<h2 style="font-size:18px;margin:0 0 16px">${escapeHtml(subject)}</h2>
${paragraphs}
<p style="margin:20px 0 0;font-size:13px;color:#6b7280">${linkHtml} to see details.<br>This is an automated message from your shop management system.</p>
</div></body></html>`;
  return { subject, text, html };
}

module.exports = { buildEmail, escapeHtml };

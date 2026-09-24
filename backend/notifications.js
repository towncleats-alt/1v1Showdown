/**
 * Notifications — email (Nodemailer SMTP) + WhatsApp deep-link builder.
 *
 * Email: uses any SMTP provider — Gmail app-password, Outlook, or custom.
 *        Set SMTP_* vars in .env. If not configured, notifications are silently skipped.
 * WhatsApp: builds a wa.me pre-filled message URL. The admin clicks it on their phone
 *           to send manually, OR on the day it is logged for record-keeping.
 *
 * Nothing here crashes the server. Every failure is caught and logged.
 */

import nodemailer from 'nodemailer';

// ─── SMTP transporter (lazy-init, only when config is present) ────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) return null; // SMTP not configured — silent skip

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
  });

  return _transporter;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sanitize(str) {
  return String(str ?? '').replace(/[<>"'&]/g, '').trim().slice(0, 200);
}

function waLink(phone, message) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Called immediately after a player registers.
 * Sends:
 *  1. Welcome email to the player
 *  2. Admin notification email
 *  3. Returns a WhatsApp link so the admin can send a manual welcome message
 */
export async function notifyPlayerRegistered(player) {
  const name    = sanitize(player.name);
  const gmail   = sanitize(player.gmail);
  const phone   = sanitize(player.whatsapp || player.cellPhone);
  const venue   = 'Padel Pavilion, Faisalabad';
  const date    = 'Sunday, Oct 11, 2026';
  const time    = '4:00 PM – 10:00 PM';
  const adminWa = process.env.ADMIN_WHATSAPP || '923045534884';
  const adminEmail = process.env.SEED_ADMIN_EMAIL || '';

  // 1 ── Welcome email to player ────────────────────────────────────────────
  const playerEmailBody = `
<!DOCTYPE html>
<html>
<body style="background:#080d0b;color:#f4fff8;font-family:'DM Sans',sans-serif;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#0f1915;border:1px solid #1f332b;border-radius:16px;padding:32px;">
    <img src="cid:logo" alt="1 ON 1 Showdown" style="height:48px;margin-bottom:16px;">
    <h2 style="color:#b7ff35;font-size:22px;margin:0 0 8px;">You're In, ${name}! 🏆</h2>
    <p style="color:#bad2c7;font-size:14px;line-height:1.7;">
      Your registration for the <strong style="color:#fff;">1 ON 1 Showdown Faisalabad</strong> has been received.
      Our team will review your entry and confirm your spot shortly.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px;">
      <tr><td style="color:#8fa39a;padding:6px 0;">Date</td><td style="color:#fff;font-weight:700;">${date}</td></tr>
      <tr><td style="color:#8fa39a;padding:6px 0;">Time</td><td style="color:#fff;font-weight:700;">${time}</td></tr>
      <tr><td style="color:#8fa39a;padding:6px 0;">Venue</td><td style="color:#fff;font-weight:700;">${venue}</td></tr>
      <tr><td style="color:#8fa39a;padding:6px 0;">Entry Fee</td><td style="color:#b7ff35;font-weight:700;">PKR 1,000</td></tr>
    </table>
    <p style="color:#fde047;font-size:13px;font-weight:700;">⚠️ Be on the pitch 30 minutes before your match. Late arrival forfeits tries.</p>
    <p style="color:#8fa39a;font-size:12px;margin-top:20px;">
      Questions? WhatsApp us: <a href="https://wa.me/${adminWa}" style="color:#b7ff35;">+92 304 5534884</a>
    </p>
    <hr style="border-color:#1f332b;margin:24px 0;">
    <p style="color:#4d5e56;font-size:11px;">
      Your data is stored securely and never shared with third parties. See our Privacy Policy on the tournament website.
    </p>
  </div>
</body>
</html>`.trim();

  // 2 ── Admin notification email ────────────────────────────────────────────
  const adminEmailBody = `
<!DOCTYPE html>
<html>
<body style="background:#080d0b;color:#f4fff8;font-family:sans-serif;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#0f1915;border:1px solid #1f332b;border-radius:12px;padding:24px;">
    <h3 style="color:#b7ff35;margin:0 0 12px;">🆕 New Player Registration</h3>
    <table style="font-size:13px;width:100%;border-collapse:collapse;">
      <tr><td style="color:#8fa39a;padding:4px 0;width:110px;">Name</td><td style="color:#fff;font-weight:700;">${name}</td></tr>
      <tr><td style="color:#8fa39a;padding:4px 0;">Gmail</td><td style="color:#fff;">${gmail}</td></tr>
      <tr><td style="color:#8fa39a;padding:4px 0;">WhatsApp</td><td style="color:#fff;">${phone}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:12px;color:#8fa39a;">Log in to the admin panel to review and approve this player.</p>
  </div>
</body>
</html>`.trim();

  // 3 ── WhatsApp welcome message (admin sends manually) ────────────────────
  const waMessage =
    `[1 ON 1 SHOWDOWN] Hi ${name}! 🏆 Your registration for the 1 v 1 Showdown Faisalabad ` +
    `(${date}, ${venue}) has been received. ` +
    `Our team will confirm your spot and entry fee (PKR 1,000) shortly. ` +
    `Report 30 minutes before your match or time will be deducted. ` +
    `For help: wa.me/${adminWa}`;

  const playerWaLink = waLink(phone, waMessage);

  // ── Fire emails (never crash the caller) ──────────────────────────────────
  const transport = getTransporter();
  if (transport) {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    // Player welcome
    if (gmail && gmail.includes('@')) {
      transport.sendMail({
        from: `"1 ON 1 Showdown" <${from}>`,
        to: gmail,
        subject: `✅ You're registered – 1 ON 1 Showdown Faisalabad`,
        html: playerEmailBody,
      }).catch(err => console.warn('[notifications] Player email failed:', err.message));
    }
    // Admin copy
    if (adminEmail && adminEmail.includes('@')) {
      transport.sendMail({
        from: `"1 ON 1 Showdown" <${from}>`,
        to: adminEmail,
        subject: `🆕 New Registration: ${name}`,
        html: adminEmailBody,
      }).catch(err => console.warn('[notifications] Admin email failed:', err.message));
    }
  } else {
    console.info('[notifications] SMTP not configured — emails skipped.');
  }

  return { playerWaLink };
}

/**
 * Called when admin schedules a match for a player.
 * Returns a WhatsApp link to notify the player.
 */
export function buildMatchReminderLink(player, match, opponent) {
  const name  = sanitize(player.name);
  const phone = sanitize(player.whatsapp || player.cellPhone);
  const time  = sanitize(match.time || match.match_time || '18:00');
  const round = sanitize(match.round || 'Round 1');
  const opp   = sanitize(opponent);
  const adminWa = process.env.ADMIN_WHATSAPP || '923045534884';

  const msg =
    `[1 ON 1 SHOWDOWN] Hi ${name}! Your ${round} match vs ${opp} ` +
    `is at ${time} on Oct 11, 2026 at Padel Pavilion, Faisalabad. ` +
    `⚠️ MANDATORY: Report 30 min early or tries will be deducted. ` +
    `Questions? wa.me/${adminWa}`;

  return waLink(phone, msg);
}

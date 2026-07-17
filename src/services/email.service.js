const SibApiV3Sdk = require('sib-api-v3-sdk');
const { DEFAULTS } = require('../constants');
const { createLogger } = require('../utils/logger');

const log = createLogger('email');

const client = SibApiV3Sdk.ApiClient.instance;
client.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

function clientBaseUrl() {
  return process.env.CLIENT_URL || DEFAULTS.CLIENT_URL;
}

function buildLink(path, token) {
  const base = clientBaseUrl().replace(/\/+$/, '');
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

function schoolBranding() {
  try {
    const { getCachedSchoolBranding } = require('./governanceConfig.service');
    return getCachedSchoolBranding();
  } catch {
    return {
      name: process.env.SCHOOL_NAME || process.env.EMAIL_FROM_NAME || 'School ERP',
      address: process.env.SCHOOL_ADDRESS || '',
      phone: process.env.SCHOOL_PHONE || '',
      email: process.env.SCHOOL_EMAIL || '',
      website: process.env.SCHOOL_WEBSITE || ''
    };
  }
}

// Teal theme matching the app (primary #0d9488 / bright #14b8a6 / deep #05191d).
const THEME = {
  deep: '#05191d',
  strong: '#0f766e',
  bright: '#14b8a6',
  primary: '#0d9488',
  soft: '#f0fdfa',
  text: '#1e293b',
  muted: '#64748b',
  border: '#e2e8f0'
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Wraps email content in a branded, responsive layout with a teal header
 * carrying the school name, a white content card, and a footer with contacts.
 */
function renderEmail({ heading, intro, bodyHtml = '', cta, note }) {
  const s = schoolBranding();
  const schoolName = escapeHtml(s.name);
  const contactParts = [s.phone, s.email, s.website].filter(Boolean).map(escapeHtml);
  const ctaHtml = cta
    ? `<tr><td style="padding:8px 0 4px;">
        <a href="${cta.url}" style="display:inline-block;background:linear-gradient(135deg,${THEME.primary},${THEME.bright});color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:10px;box-shadow:0 6px 16px rgba(13,148,136,.28);">${escapeHtml(cta.label)}</a>
      </td></tr>`
    : '';
  const noteHtml = note
    ? `<tr><td style="padding-top:14px;font-size:12px;color:${THEME.muted};line-height:1.6;">${note}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#eef2f5;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:${THEME.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f5;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08);">
        <tr>
          <td style="background:linear-gradient(135deg,${THEME.deep} 0%,${THEME.strong} 55%,${THEME.bright} 100%);padding:26px 32px;">
            <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:.5px;text-transform:uppercase;">${schoolName}</div>
            ${s.address ? `<div style="font-size:12px;color:#99f6e4;margin-top:6px;">${escapeHtml(s.address)}</div>` : ''}
          </td>
        </tr>
        <tr><td style="height:4px;background:${THEME.bright};"></td></tr>
        <tr>
          <td style="padding:30px 32px 26px;">
            <h1 style="margin:0 0 12px;font-size:20px;color:${THEME.strong};">${escapeHtml(heading)}</h1>
            ${intro ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:${THEME.text};">${intro}</p>` : ''}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${bodyHtml ? `<tr><td style="padding-bottom:6px;">${bodyHtml}</td></tr>` : ''}
              ${ctaHtml}
              ${noteHtml}
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:${THEME.soft};padding:18px 32px;border-top:1px solid ${THEME.border};">
            <div style="font-size:13px;font-weight:700;color:${THEME.strong};">${schoolName}</div>
            ${contactParts.length ? `<div style="font-size:11px;color:${THEME.muted};margin-top:4px;">${contactParts.join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</div>` : ''}
            <div style="font-size:11px;color:${THEME.muted};margin-top:8px;">This is an automated message from ${schoolName}. Please do not reply to this email.</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function deliver({ to, subject, text, html }) {
  try {
    const email = new SibApiV3Sdk.SendSmtpEmail();

    email.sender = {
      name: process.env.EMAIL_FROM_NAME || 'School ERP',
      email: process.env.EMAIL_USER
    };

    email.to = [
      {
        email: to
      }
    ];

    email.subject = subject;
    email.textContent = text;

    email.htmlContent =
      html ||
      `<pre style="font-family:Arial,sans-serif;font-size:14px;">${text}</pre>`;

    await apiInstance.sendTransacEmail(email);

    return {
      delivered: true
    };
  } catch (error) {
    log.error('Brevo email failed', {
      to,
      subject,
      error: error.response?.body || error.message
    });

    return {
      delivered: false,
      error: error.response?.body || error.message
    };
  }
}

async function sendVerificationEmail({ to, name, token }) {
  const link = buildLink('/verify-email', token);
  const schoolName = schoolBranding().name;

  const result = await deliver({
    to,
    subject: `Verify your ${schoolName} account`,
    text: `Hello ${name || ''},

Please verify your email using the link below:

${link}

This link will expire soon.

If you did not create this account, you can ignore this email.`,
    html: renderEmail({
      heading: 'Verify your account',
      intro: `Hello ${escapeHtml(name) || 'there'}, welcome to <strong>${escapeHtml(schoolName)}</strong>. Please confirm your email address to activate your account.`,
      cta: { url: link, label: 'Verify Account' },
      note: `If the button doesn't work, copy and paste this link into your browser:<br><a href="${link}" style="color:${THEME.primary};word-break:break-all;">${link}</a><br><br>If you did not create this account, you can safely ignore this email.`
    })
  });

  return { ...result, link };
}

async function sendPasswordResetEmail({ to, name, token }) {
  const link = buildLink('/reset-password', token);
  const schoolName = schoolBranding().name;

  const result = await deliver({
    to,
    subject: `Reset your ${schoolName} password`,
    text: `Hello ${name || ''},

A password reset was requested.

Reset your password here:

${link}

If you didn't request this, simply ignore this email.`,
    html: renderEmail({
      heading: 'Reset your password',
      intro: `Hello ${escapeHtml(name) || 'there'}, we received a request to reset the password for your <strong>${escapeHtml(schoolName)}</strong> account.`,
      cta: { url: link, label: 'Reset Password' },
      note: `If the button doesn't work, copy and paste this link into your browser:<br><a href="${link}" style="color:${THEME.primary};word-break:break-all;">${link}</a><br><br>If you didn't request this, simply ignore this email — your password will stay the same.`
    })
  });

  return { ...result, link };
}

async function sendPasswordResetOtp({ to, name, otp, expiryMinutes }) {
  const schoolName = schoolBranding().name;
  const otpBox = `
    <div style="text-align:center;padding:4px 0 8px;">
      <div style="display:inline-block;background:${THEME.soft};border:1px dashed ${THEME.bright};border-radius:12px;padding:16px 28px;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${THEME.muted};margin-bottom:6px;">Your verification code</div>
        <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:${THEME.strong};">${escapeHtml(otp)}</div>
      </div>
    </div>`;

  return deliver({
    to,
    subject: `Your ${schoolName} password reset code`,
    text: `Hello ${name || ''},

Your OTP is:

${otp}

This OTP expires in ${expiryMinutes} minutes.`,
    html: renderEmail({
      heading: 'Password reset code',
      intro: `Hello ${escapeHtml(name) || 'there'}, use the one-time code below to reset your <strong>${escapeHtml(schoolName)}</strong> password.`,
      bodyHtml: otpBox,
      note: `This code expires in <strong>${escapeHtml(expiryMinutes)} minutes</strong>. Never share it with anyone. If you didn't request a reset, please ignore this email.`
    })
  });
}

async function sendStudentCredentials({
  to,
  name,
  username,
  temporaryPassword
}) {
  if (!to) {
    return {
      delivered: false,
      skipped: true
    };
  }

  const schoolName = schoolBranding().name;
  const loginUrl = clientBaseUrl().replace(/\/+$/, '');
  const credsBox = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${THEME.soft};border:1px solid ${THEME.border};border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.5px;width:45%;border-bottom:1px solid ${THEME.border};">Username</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:${THEME.text};border-bottom:1px solid ${THEME.border};">${escapeHtml(username)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.5px;">Temporary password</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:${THEME.strong};">${escapeHtml(temporaryPassword)}</td>
      </tr>
    </table>`;

  return deliver({
    to,
    subject: `Your ${schoolName} student login`,
    text: `Hello ${name || ''},

Your account has been created.

Username: ${username}

Temporary Password: ${temporaryPassword}

You will be prompted to change your password after logging in.`,
    html: renderEmail({
      heading: `Welcome to ${schoolName}`,
      intro: `Hello ${escapeHtml(name) || 'there'}, your student account has been created. Use the credentials below to sign in.`,
      bodyHtml: credsBox,
      cta: { url: loginUrl, label: 'Go to Login' },
      note: 'For your security, you will be asked to set a new password the first time you log in.'
    })
  });
}

async function sendFeePaymentReminder({
  to,
  parentName,
  studentName,
  admissionNumber,
  amount,
  riskCategory,
  latePaymentProbability,
  bodyText
}) {
  const schoolName = schoolBranding().name || 'School';
  const amountLabel = `₹${Number(amount || 0).toLocaleString('en-IN')}`;
  const detailsBox = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${THEME.soft};border:1px solid ${THEME.border};border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.5px;width:42%;border-bottom:1px solid ${THEME.border};">Student</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:${THEME.text};border-bottom:1px solid ${THEME.border};">${escapeHtml(studentName)}${admissionNumber ? ` (${escapeHtml(admissionNumber)})` : ''}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid ${THEME.border};">Outstanding</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:${THEME.strong};border-bottom:1px solid ${THEME.border};">${escapeHtml(amountLabel)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.5px;">Risk signal</td>
        <td style="padding:12px 16px;font-size:14px;font-weight:600;color:${THEME.text};">${escapeHtml(String(riskCategory || 'medium').toUpperCase())} · Late payment likelihood ${escapeHtml(String(latePaymentProbability || 0))}%</td>
      </tr>
    </table>`;

  return deliver({
    to,
    subject: `Fee payment reminder — ${studentName || 'Student'} | ${schoolName}`,
    text: bodyText || `Dear ${parentName || 'Parent'}, please clear pending fees of ${amountLabel} for ${studentName}.`,
    html: renderEmail({
      heading: 'Fee payment reminder',
      intro: `Dear ${escapeHtml(parentName) || 'Parent / Guardian'}, this is a reminder regarding pending school fees.`,
      bodyHtml: detailsBox,
      cta: { url: clientBaseUrl().replace(/\/+$/, ''), label: 'Open Parent Portal' },
      note: 'Please ignore this message if payment has already been made. For help, contact the school office.'
    })
  });
}

async function sendAdmissionLeadNotification({
  to,
  parentName,
  childName,
  leadCode,
  stage,
  applyingClass,
  feeTotal,
  message
}) {
  const schoolName = schoolBranding().name || 'School';
  const feeLabel = feeTotal != null ? `₹${Number(feeTotal).toLocaleString('en-IN')}` : '—';
  const detailsBox = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${THEME.soft};border:1px solid ${THEME.border};border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:${THEME.muted};text-transform:uppercase;width:40%;border-bottom:1px solid ${THEME.border};">Inquiry</td>
        <td style="padding:12px 16px;font-weight:700;border-bottom:1px solid ${THEME.border};">${escapeHtml(leadCode || '')}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:${THEME.muted};text-transform:uppercase;border-bottom:1px solid ${THEME.border};">Child</td>
        <td style="padding:12px 16px;font-weight:700;border-bottom:1px solid ${THEME.border};">${escapeHtml(childName || '')}${applyingClass ? ` · Class ${escapeHtml(applyingClass)}` : ''}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:${THEME.muted};text-transform:uppercase;border-bottom:1px solid ${THEME.border};">Stage</td>
        <td style="padding:12px 16px;font-weight:600;border-bottom:1px solid ${THEME.border};">${escapeHtml(String(stage || '').replace(/_/g, ' '))}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:${THEME.muted};text-transform:uppercase;">Fee estimate</td>
        <td style="padding:12px 16px;font-weight:700;color:${THEME.strong};">${escapeHtml(feeLabel)}</td>
      </tr>
    </table>
    ${message ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:${THEME.text};">${escapeHtml(message)}</p>` : ''}`;

  return deliver({
    to,
    subject: `Admission update — ${childName || 'your child'} | ${schoolName}`,
    text: `Dear ${parentName || 'Parent'}, your admission inquiry ${leadCode} is now at stage: ${stage}.`,
    html: renderEmail({
      heading: 'Admission inquiry update',
      intro: `Dear ${escapeHtml(parentName) || 'Parent / Guardian'}, here is an update on your admission inquiry with ${escapeHtml(schoolName)}.`,
      bodyHtml: detailsBox,
      cta: { url: clientBaseUrl().replace(/\/+$/, ''), label: 'Visit school portal' },
      note: 'Reply to this email or visit the school office for the next steps.'
    })
  });
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordResetOtp,
  sendStudentCredentials,
  sendFeePaymentReminder,
  sendAdmissionLeadNotification
};
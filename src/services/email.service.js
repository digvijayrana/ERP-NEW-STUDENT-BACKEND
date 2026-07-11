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

  const result = await deliver({
    to,
    subject: 'Verify your School ERP account',
    text: `Hello ${name || ''},

Please verify your email using the link below:

${link}

This link will expire soon.

If you did not create this account, you can ignore this email.`,
    html: `
      <h2>Verify your School ERP Account</h2>
      <p>Hello ${name || ''},</p>

      <p>Please click the button below to verify your account.</p>

      <a href="${link}"
         style="background:#2563eb;color:#fff;padding:12px 22px;text-decoration:none;border-radius:6px;">
         Verify Account
      </a>

      <p style="margin-top:20px;">Or copy this link:</p>

      <p>${link}</p>
    `
  });

  return { ...result, link };
}

async function sendPasswordResetEmail({ to, name, token }) {
  const link = buildLink('/reset-password', token);

  const result = await deliver({
    to,
    subject: 'Reset your School ERP password',
    text: `Hello ${name || ''},

A password reset was requested.

Reset your password here:

${link}

If you didn't request this, simply ignore this email.`,
    html: `
      <h2>Password Reset</h2>

      <p>Hello ${name || ''},</p>

      <p>Click below to reset your password.</p>

      <a href="${link}"
         style="background:#dc2626;color:#fff;padding:12px 22px;text-decoration:none;border-radius:6px;">
         Reset Password
      </a>

      <p style="margin-top:20px;">Or copy this link:</p>

      <p>${link}</p>
    `
  });

  return { ...result, link };
}

async function sendPasswordResetOtp({ to, name, otp, expiryMinutes }) {
  return deliver({
    to,
    subject: 'Your School ERP Password Reset OTP',
    text: `Hello ${name || ''},

Your OTP is:

${otp}

This OTP expires in ${expiryMinutes} minutes.`,
    html: `
      <h2>Password Reset OTP</h2>

      <p>Hello ${name || ''},</p>

      <p>Your verification code is:</p>

      <h1 style="letter-spacing:8px;color:#2563eb;">
        ${otp}
      </h1>

      <p>This OTP expires in ${expiryMinutes} minutes.</p>
    `
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

  return deliver({
    to,
    subject: 'Your School ERP Student Login',
    text: `Hello ${name || ''},

Your account has been created.

Username: ${username}

Temporary Password: ${temporaryPassword}

You will be prompted to change your password after logging in.`,
    html: `
      <h2>Welcome to School ERP</h2>

      <p>Hello ${name || ''},</p>

      <table cellpadding="8">
        <tr>
          <td><strong>Username</strong></td>
          <td>${username}</td>
        </tr>

        <tr>
          <td><strong>Temporary Password</strong></td>
          <td>${temporaryPassword}</td>
        </tr>
      </table>

      <p>Please change your password after your first login.</p>
    `
  });
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordResetOtp,
  sendStudentCredentials
};
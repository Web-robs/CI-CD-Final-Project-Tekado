const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE = 'false',
  EMAIL_FROM,
} = process.env;

function isEmailConfigured() {
  return SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && EMAIL_FROM;
}

function buildTransporter() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

async function sendVerificationEmail(to, code) {
  if (!isEmailConfigured()) {
    return { sent: false, skipped: true, reason: 'Email not configured' };
  }

  try {
    const transporter = buildTransporter();
    const info = await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject: 'Your Tekado verification code',
      text: `Your verification code is: ${code}`,
      html: `<p>Your verification code is:</p><h2>${code}</h2><p>This code will expire soon. If you did not request it, please ignore this email.</p>`,
    });

    return { sent: true, messageId: info?.messageId };
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = {
  sendVerificationEmail,
  isEmailConfigured,
};

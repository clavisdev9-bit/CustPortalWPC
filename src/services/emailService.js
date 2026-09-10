const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;
let consoleFallback = false;

// Without SMTP_HOST configured, emails are printed to the server log instead of sent -- this
// keeps local dev working without a real mailbox, while still exercising the exact same
// call sites (forgot password, account activation) that will send for real once SMTP is set.
function getTransporter() {
  if (transporter) return transporter;
  if (env.smtp.host) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  } else {
    consoleFallback = true;
    transporter = {
      sendMail: async (message) => {
        console.log('--- EMAIL (SMTP not configured; printing instead) ---');
        console.log(`To: ${message.to}\nSubject: ${message.subject}\n\n${message.text || message.html}`);
        console.log('------------------------------------------------------');
        return { messageId: 'console-fallback' };
      },
    };
  }
  return transporter;
}

async function send({ to, subject, html, text }) {
  return getTransporter().sendMail({ from: env.smtp.from, to, subject, html, text });
}

function isConsoleFallback() {
  getTransporter();
  return consoleFallback;
}

module.exports = { send, isConsoleFallback };
